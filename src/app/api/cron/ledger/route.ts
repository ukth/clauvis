import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { users, transactions, chatMessages } from "@/lib/db/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { sendMessage } from "@/lib/telegram";
import {
  formatMonthSummary,
  formatTransactionLine,
  formatWon,
  getTransactionsInRange,
  kstDateString,
  kstDayOfMonth,
  kstMonthString,
  kstYesterdayRange,
  previousMonth,
  sumNet,
  summarizeMonth,
} from "@/lib/ledger";

const SYNC_STALE_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Telegram limit is 4096 UTF-16 code units; keep a margin
const TELEGRAM_CHUNK_LENGTH = 4000;

type LedgerUser = { id: string; telegramChatId: string; ledgerSyncedAt: Date | null };

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Split text into chunks under the Telegram limit, breaking on line boundaries. */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    // An overlong single line is split by code points so surrogate pairs stay intact
    const pieces: string[] = [];
    let piece = "";
    for (const ch of line) {
      if (piece.length + ch.length > TELEGRAM_CHUNK_LENGTH) {
        pieces.push(piece);
        piece = "";
      }
      piece += ch;
    }
    pieces.push(piece);

    for (const p of pieces) {
      const candidate = current ? `${current}\n${p}` : p;
      if (candidate.length > TELEGRAM_CHUNK_LENGTH) {
        chunks.push(current);
        current = p;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function buildSections(user: LedgerUser, now: Date): Promise<string[]> {
  const sections: string[] = [];

  // a. Yesterday's transactions
  const yesterday = kstYesterdayRange(now);
  const rows = await getTransactionsInRange(user.id, yesterday);
  if (rows.length > 0) {
    const label = kstDateString(yesterday.start).slice(5).replace("-", "/");
    sections.push([
      `📒 어제(${label}) 카드 사용 내역`,
      "",
      ...rows.map((tx) => formatTransactionLine(tx)),
      "",
      `합계: ${formatWon(sumNet(rows))}`,
      "",
      "메모할 게 있으면 '#12 사무실 비품'처럼 답장 주세요.",
    ].join("\n"));
  }

  // b. Monthly report on the 1st (KST)
  if (kstDayOfMonth(now) === 1) {
    const month = previousMonth(kstMonthString(now));
    const summary = await summarizeMonth(user.id, month);
    sections.push(`📊 ${month} 월간 지출 리포트\n\n${formatMonthSummary(summary)}`);
  }

  // c. Stale Mac sync warning
  const syncedAt = user.ledgerSyncedAt;
  if (!syncedAt) {
    sections.push("⚠️ 맥 동기화 기록이 아직 없습니다. 동기화 스크립트를 확인해 주세요.");
  } else if (now.getTime() - syncedAt.getTime() > SYNC_STALE_MS) {
    const days = Math.floor((now.getTime() - syncedAt.getTime()) / DAY_MS);
    sections.push(`⚠️ 맥 동기화가 ${days}일째 없습니다. 맥이 켜져 있는지 확인해 주세요.`);
  }

  return sections;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = kstDateString(now);
  const targets = await db
    .select({ id: users.id, telegramChatId: users.telegramChatId, ledgerSyncedAt: users.ledgerSyncedAt })
    .from(users)
    .where(and(
      isNotNull(users.telegramChatId),
      sql`exists (select 1 from ${transactions} where ${eq(transactions.userId, users.id)})`,
    ));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets) {
    if (!target.telegramChatId) continue;
    const user: LedgerUser = { ...target, telegramChatId: target.telegramChatId };
    try {
      const sections = await buildSections(user, now);
      if (sections.length === 0) {
        skipped++;
        continue;
      }

      // Claim today's digest so a retried/duplicated cron run does not resend
      const claimed = await db
        .update(users)
        .set({ ledgerDigestDate: today })
        .where(and(eq(users.id, user.id), sql`${users.ledgerDigestDate} is distinct from ${today}`))
        .returning({ id: users.id });
      if (claimed.length === 0) {
        skipped++;
        continue;
      }

      const chatId = Number(user.telegramChatId);
      let delivered = 0;
      let undelivered = 0;
      for (const chunk of sections.flatMap(chunkText)) {
        if (!(await sendMessage(chatId, chunk, false))) {
          undelivered++;
          continue;
        }
        delivered++;
        // Store as assistant message so the agent has context when the user replies
        await db.insert(chatMessages).values({
          userId: user.id,
          role: "assistant",
          content: chunk,
          contentJson: JSON.stringify(chunk),
        });
      }

      if (delivered > 0) sent++;
      if (undelivered > 0) failed++;
      if (delivered === 0) {
        // Nothing went out: release the claim so a manual re-run today can retry
        await db.update(users).set({ ledgerDigestDate: null }).where(eq(users.id, user.id));
      }
    } catch (error) {
      failed++;
      console.error(`[CRON] ledger user=${user.id.slice(0, 4)} failed:`, error);
    }
  }

  console.log(`[CRON] ledger users=${targets.length} sent=${sent} skipped=${skipped} failed=${failed}`);
  return NextResponse.json({ users: targets.length, sent, skipped, failed });
}
