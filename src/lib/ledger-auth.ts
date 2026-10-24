import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { users, webLoginRequests, webSessions } from "./db/schema";

export const SESSION_COOKIE = "clauvis_session";
export const REQUEST_COOKIE = "clauvis_login_request";
export const SESSION_SECONDS = 365 * 24 * 60 * 60;
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

export type LedgerSession = { id: string; userId: string; name: string };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isToken(token: string | undefined): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

export function summarizeUserAgent(value: string): string {
  const device = /iPad/i.test(value) ? "iPad" : /iPhone/i.test(value) ? "iPhone"
    : /Android/i.test(value) ? "Android" : /Windows/i.test(value) ? "Windows"
    : /Macintosh/i.test(value) ? "Mac" : "기타 기기";
  const browser = /Edg/i.test(value) ? "Edge" : /Firefox|FxiOS/i.test(value) ? "Firefox"
    : /Chrome|CriOS/i.test(value) ? "Chrome" : /Safari/i.test(value) ? "Safari" : "브라우저";
  return `${device} · ${browser}`;
}

export async function getLedgerSession(): Promise<LedgerSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isToken(token)) return null;
  const [session] = await db.select({ id: webSessions.id, userId: webSessions.userId, name: users.name })
    .from(webSessions).innerJoin(users, eq(users.id, webSessions.userId))
    .where(and(eq(webSessions.tokenHash, hashToken(token)), gt(webSessions.expiresAt, new Date())))
    .limit(1);
  return session ?? null;
}

export async function requireLedgerSession(): Promise<LedgerSession> {
  const session = await getLedgerSession();
  if (!session) throw new Error("로그인이 필요합니다.");
  return session;
}

export async function findPairingRequest(pairCode: string): Promise<typeof webLoginRequests.$inferSelect | null> {
  if (!/^\d{6}$/.test(pairCode)) return null;
  const rows = await db.select().from(webLoginRequests).where(and(
    eq(webLoginRequests.pairCode, pairCode),
    isNull(webLoginRequests.consumedAt),
    gt(webLoginRequests.expiresAt, new Date()),
  )).limit(2);
  return rows.length === 1 && !rows[0].approvedAt ? rows[0] : null;
}

/** The caller must verify Telegram's private chat and sender before calling. */
export async function decidePairingRequest(id: string, userId: string, approve: boolean): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return false;
  const now = new Date();
  const rows = await db.update(webLoginRequests)
    .set(approve ? { userId, approvedAt: now } : { consumedAt: now })
    .where(and(
      eq(webLoginRequests.id, id), isNull(webLoginRequests.approvedAt),
      isNull(webLoginRequests.consumedAt), gt(webLoginRequests.expiresAt, now),
      // Defense in depth if an older database lacks the unique partial index.
      sql`(SELECT count(*) FROM web_login_requests AS active
        WHERE active.pair_code = ${webLoginRequests.pairCode}
        AND active.consumed_at IS NULL AND active.expires_at > ${now}) = 1`,
    )).returning({ id: webLoginRequests.id });
  return rows.length === 1;
}

/** One SQL statement: an insert failure also rolls back request consumption. */
export async function consumePairingRequest(secret: string): Promise<string | null> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  const result = await db.execute<{ id: string }>(sql`
    WITH consumed AS (
      UPDATE web_login_requests SET consumed_at = now()
      WHERE secret_hash = ${hashToken(secret)} AND consumed_at IS NULL
        AND approved_at IS NOT NULL AND user_id IS NOT NULL AND expires_at > now()
      RETURNING user_id, user_agent
    )
    INSERT INTO web_sessions (user_id, token_hash, user_agent, expires_at)
      SELECT user_id, ${hashToken(token)}, user_agent, ${expiresAt.toISOString()}::timestamptz
      FROM consumed
    RETURNING id
  `);
  return result.rows.length === 1 ? token : null;
}

export async function revokeAllLedgerSessions(userId: string): Promise<void> {
  // Revoke approved-but-unconsumed requests too, so polling cannot restore access.
  await db.update(webLoginRequests).set({ consumedAt: new Date() })
    .where(and(eq(webLoginRequests.userId, userId), isNull(webLoginRequests.consumedAt)));
  // A fresh statement snapshot also sees sessions inserted by an in-flight consume
  // that held a request lock before the UPDATE above completed.
  await db.delete(webSessions).where(eq(webSessions.userId, userId));
}
