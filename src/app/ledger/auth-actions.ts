"use server";

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { webLoginRequests, webSessions } from "@/lib/db/schema";
import {
  COOKIE_OPTIONS, REQUEST_COOKIE, SESSION_COOKIE, SESSION_SECONDS,
  consumePairingRequest, getLedgerSession, hashToken, isToken,
  requireLedgerSession, revokeAllLedgerSessions, summarizeUserAgent,
} from "@/lib/ledger-auth";

type ActionError = { ok: false; error: string; unauthorized?: boolean };
type ActionSuccess = { ok: true };
type LoginRequestResult = { ok: true; pairCode: string; expiresAt: string } | ActionError;
type PollResult = { ok: true; status: "pending" | "expired" | "rejected" | "authenticated" } | ActionError;

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueConflict(error.cause);
}

export async function createLoginRequest(): Promise<LoginRequestResult> {
  try {
    const jar = await cookies();
    const existingSecret = jar.get(REQUEST_COOKIE)?.value;
    const secret = isToken(existingSecret) ? existingSecret : randomBytes(32).toString("hex");
    const secretHash = hashToken(secret);
    const now = new Date();
    const [existing] = await db.select().from(webLoginRequests).where(and(
      eq(webLoginRequests.secretHash, secretHash), isNull(webLoginRequests.consumedAt),
      gt(webLoginRequests.expiresAt, now),
    )).limit(1);
    if (existing) {
      jar.set(REQUEST_COOKIE, secret, { ...COOKIE_OPTIONS, maxAge: 600 });
      return { ok: true, pairCode: existing.pairCode, expiresAt: existing.expiresAt.toISOString() };
    }

    // Expired rows release their unique code; old rows are cleaned up lazily.
    await db.update(webLoginRequests).set({ consumedAt: now })
      .where(and(lte(webLoginRequests.expiresAt, now), isNull(webLoginRequests.consumedAt)));
    await db.delete(webLoginRequests).where(lt(webLoginRequests.expiresAt, new Date(now.getTime() - 86400000)));
    await db.delete(webSessions).where(lte(webSessions.expiresAt, now));
    const userAgent = summarizeUserAgent((await headers()).get("user-agent") ?? "");
    for (let attempt = 0; attempt < 8; attempt++) {
      const pairCode = randomInt(0, 1000000).toString().padStart(6, "0");
      const expiresAt = new Date(now.getTime() + 300000);
      try {
        // Reuse the browser secret, but rotate the request ID to invalidate old buttons.
        // Concurrent renewals replace the same row, never create two active requests.
        const values = { id: randomUUID(), secretHash, pairCode, userAgent,
          expiresAt, createdAt: now, userId: null, approvedAt: null, consumedAt: null };
        const [created] = await db.insert(webLoginRequests).values(values).onConflictDoUpdate({
          target: webLoginRequests.secretHash, set: values,
          setWhere: or(isNotNull(webLoginRequests.consumedAt), lte(webLoginRequests.expiresAt, now)),
        }).returning();
        // Another tab may already have renewed this browser's request.
        const row = created ?? (await db.select().from(webLoginRequests)
          .where(eq(webLoginRequests.secretHash, secretHash)).limit(1))[0];
        if (!row) continue;
        jar.set(REQUEST_COOKIE, secret, { ...COOKIE_OPTIONS, maxAge: 600 });
        return { ok: true, pairCode: row.pairCode, expiresAt: row.expiresAt.toISOString() };
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
      }
    }
    return { ok: false, error: "로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요." };
  } catch {
    // Never log database errors: they can include pairing codes and query parameters.
    return { ok: false, error: "로그인 요청을 만들지 못했습니다. 다시 시도해 주세요." };
  }
}

export async function pollLoginRequest(): Promise<PollResult> {
  try {
    if (await getLedgerSession()) return { ok: true, status: "authenticated" };
    const jar = await cookies();
    const secret = jar.get(REQUEST_COOKIE)?.value;
    if (!isToken(secret)) return { ok: true, status: "expired" };
    const token = await consumePairingRequest(secret);
    if (token) {
      jar.set(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_SECONDS });
      jar.delete(REQUEST_COOKIE);
      return { ok: true, status: "authenticated" };
    }
    const [row] = await db.select({
      consumedAt: webLoginRequests.consumedAt,
      rejectedAt: webLoginRequests.rejectedAt,
      expiresAt: webLoginRequests.expiresAt,
    }).from(webLoginRequests).where(eq(webLoginRequests.secretHash, hashToken(secret))).limit(1);
    if (row?.rejectedAt) return { ok: true, status: "rejected" };
    const pending = row && !row.consumedAt && row.expiresAt > new Date();
    return { ok: true, status: pending ? "pending" : "expired" };
  } catch {
    return { ok: false, error: "승인 상태를 확인하지 못했습니다. 잠시 후 다시 시도합니다." };
  }
}

export async function refreshSession(): Promise<ActionSuccess | ActionError> {
  try {
    const session = await getLedgerSession();
    if (!session) return { ok: false, error: "로그인이 필요합니다.", unauthorized: true };
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (!isToken(token)) return { ok: false, error: "로그인이 필요합니다.", unauthorized: true };
    const now = new Date();
    const updated = await db.update(webSessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000) })
      .where(and(eq(webSessions.id, session.id), eq(webSessions.tokenHash, hashToken(token)),
        gt(webSessions.expiresAt, now), lte(webSessions.lastSeenAt, new Date(now.getTime() - 86400000))))
      .returning({ id: webSessions.id });
    if (updated.length) jar.set(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: SESSION_SECONDS });
    return { ok: true };
  } catch {
    return { ok: false, error: "세션을 갱신하지 못했습니다." };
  }
}

export async function logout(): Promise<ActionSuccess | ActionError> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (isToken(token)) await db.delete(webSessions).where(eq(webSessions.tokenHash, hashToken(token)));
    jar.delete(SESSION_COOKIE);
    jar.delete(REQUEST_COOKIE);
    return { ok: true };
  } catch {
    return { ok: false, error: "로그아웃하지 못했습니다. 다시 시도해 주세요." };
  }
}

export async function logoutSession(sessionId: string): Promise<ActionSuccess | ActionError> {
  try {
    const session = await requireLedgerSession();
    if (typeof sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(sessionId)) {
      return { ok: false, error: "올바른 기기를 선택해 주세요." };
    }
    const removed = await db.delete(webSessions).where(and(
      eq(webSessions.userId, session.userId), eq(webSessions.id, sessionId),
    )).returning({ id: webSessions.id });
    if (!removed.length) return { ok: false, error: "로그인된 기기를 찾을 수 없습니다." };
    if (sessionId === session.id) (await cookies()).delete(SESSION_COOKIE);
    return { ok: true };
  } catch {
    return { ok: false, error: "기기 로그아웃에 실패했습니다. 로그인 상태를 확인해 주세요." };
  }
}

export async function logoutAllSessions(): Promise<ActionSuccess | ActionError> {
  try {
    const session = await requireLedgerSession();
    await revokeAllLedgerSessions(session.userId);
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    jar.delete(REQUEST_COOKIE);
    return { ok: true };
  } catch {
    return { ok: false, error: "전체 로그아웃에 실패했습니다. 로그인 상태를 확인해 주세요." };
  }
}
