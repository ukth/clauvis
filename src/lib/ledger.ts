import { db } from "./db";
import { transactions, users } from "./db/schema";
import { eq, and, gte, lt, lte, desc, asc, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

// --- KST date helpers ---

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

export const SHINHAN_THRESHOLD = 300_000;

/** Fixed spending categories. Anything else is rejected so the names never drift. */
export const CATEGORIES = [
  "외식", "배달", "카페·간식", "장보기", "생필품", "쇼핑", "교통",
  "여행", "통신비", "구독·AI", "업무", "의료", "경조사·선물", "기타",
] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export type DateRange = { start: Date; end: Date };

/** Shift a UTC instant so its UTC fields read as KST wall-clock fields. */
function toKstFields(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

/** YYYY-MM-DD of the given instant in KST. */
export function kstDateString(date: Date = new Date()): string {
  return toKstFields(date).toISOString().slice(0, 10);
}

/** YYYY-MM of the given instant in KST. */
export function kstMonthString(date: Date = new Date()): string {
  return toKstFields(date).toISOString().slice(0, 7);
}

/** Day of month (1-31) of the given instant in KST. */
export function kstDayOfMonth(date: Date = new Date()): number {
  return toKstFields(date).getUTCDate();
}

/** HH:MM of the given instant in KST. */
export function kstTimeString(date: Date): string {
  return toKstFields(date).toISOString().slice(11, 16);
}

/** [start, end) range of the KST calendar day before `now`. */
export function kstYesterdayRange(now: Date = new Date()): DateRange {
  const kst = toKstFields(now);
  const todayStartUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS;
  return { start: new Date(todayStartUtc - DAY_MS), end: new Date(todayStartUtc) };
}

/** [start, end) range of a KST month given as YYYY-MM. */
export function kstMonthRange(month: string): DateRange {
  const [year, mon] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, mon - 1, 1) - KST_OFFSET_MS),
    end: new Date(Date.UTC(year, mon, 1) - KST_OFFSET_MS),
  };
}

/** YYYY-MM of the month before the given YYYY-MM. */
export function previousMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
}

/**
 * Month-to-date range (KST) and the same elapsed span of the previous month,
 * clamped to the previous month's end (e.g. Mar 31 compares against all of Feb).
 */
export function kstMonthToDateRanges(now: Date = new Date()): { current: DateRange; previous: DateRange } {
  const month = kstMonthString(now);
  const currentStart = kstMonthRange(month).start;
  const prev = kstMonthRange(previousMonth(month));
  const elapsed = now.getTime() - currentStart.getTime();
  return {
    current: { start: currentStart, end: now },
    previous: { start: prev.start, end: new Date(Math.min(prev.start.getTime() + elapsed, prev.end.getTime())) },
  };
}

const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MIN_OCCURRED_AT = Date.UTC(2000, 0, 1);

/**
 * Parse a user/LLM-supplied ISO datetime with an explicit offset (so server-local time is never assumed).
 * Returns null if malformed or outside a sane range (before 2000-01-01 or more than a day in the future).
 */
export function parseIsoWithOffset(value: string): Date | null {
  if (!ISO_WITH_OFFSET_RE.test(value)) return null;
  const date = new Date(value);
  const time = date.getTime();
  if (isNaN(time) || time < MIN_OCCURRED_AT || time > Date.now() + DAY_MS) return null;
  return date;
}

// --- Queries ---

export type Transaction = typeof transactions.$inferSelect;

export async function getTransactionsInRange(userId: string, range: DateRange): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      gte(transactions.occurredAt, range.start),
      lt(transactions.occurredAt, range.end),
    ))
    .orderBy(asc(transactions.occurredAt), asc(transactions.number));
}

export async function listTransactions(
  userId: string,
  options: { month?: string; limit?: number } = {}
): Promise<Transaction[]> {
  const conditions = [eq(transactions.userId, userId)];
  if (options.month) {
    const range = kstMonthRange(options.month);
    conditions.push(gte(transactions.occurredAt, range.start), lt(transactions.occurredAt, range.end));
  }
  return db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredAt), desc(transactions.number))
    .limit(options.limit ?? 200);
}

export async function updateTransactionMemo(
  userId: string,
  number: number,
  input: { memo?: string | null; category?: string | null; excluded?: boolean; excludeReason?: string | null }
): Promise<Transaction | null> {
  const updateData: PgUpdateSetSource<typeof transactions> = { updatedAt: new Date() };
  if (input.memo !== undefined) updateData.memo = input.memo;
  if (input.category !== undefined) {
    updateData.category = input.category;
    updateData.categorySource = "user";
  }
  if (input.excluded === true) {
    // Keep the original exclusion time if already excluded
    updateData.excludedAt = sql`coalesce(${transactions.excludedAt}, now())`;
    // Re-excluding without a reason keeps the existing one
    if (input.excludeReason) updateData.excludeReason = input.excludeReason;
  } else if (input.excluded === false) {
    updateData.excludedAt = null;
    updateData.excludeReason = null;
  }

  const [updated] = await db
    .update(transactions)
    .set(updateData)
    .where(and(eq(transactions.userId, userId), eq(transactions.number, number)))
    .returning();
  return updated ?? null;
}

/** Exclude a transaction from all totals (survives sync). Returns null if not found. */
export async function excludeTransaction(userId: string, number: number, reason?: string | null): Promise<Transaction | null> {
  return updateTransactionMemo(userId, number, { excluded: true, excludeReason: reason ?? null });
}

/** Undo an exclusion. Returns null if not found. */
export async function includeTransaction(userId: string, number: number): Promise<Transaction | null> {
  return updateTransactionMemo(userId, number, { excluded: false });
}

/**
 * Atomically reserve `count` per-user transaction numbers via users.ledger_seq
 * (single statement, safe under concurrency on neon-http). Returns the first reserved number.
 */
export async function reserveTransactionNumbers(userId: string, count: number): Promise<number> {
  const [reserved] = await db
    .update(users)
    .set({ ledgerSeq: sql`${users.ledgerSeq} + ${count}` })
    .where(eq(users.id, userId))
    .returning({ seq: users.ledgerSeq });
  if (!reserved) throw new Error("User not found");
  return reserved.seq - count + 1;
}

// --- Manual entries ---

export const MANUAL_CARD_ORG = "manual";

const DUPLICATE_WINDOW_MS = 60 * 1000;

export const MANUAL_METHOD_LABELS = {
  transfer: "계좌이체",
  cash: "현금",
  card: "카드",
  other: "기타",
} as const;

export type ManualMethod = keyof typeof MANUAL_METHOD_LABELS;

export async function addManualTransaction(
  userId: string,
  input: {
    amount: number;
    merchant: string;
    method?: ManualMethod;
    occurredAt?: Date;
    category?: string | null;
    memo?: string | null;
  }
): Promise<{ ok: true; tx: Transaction } | { ok: false; reason: "duplicate"; existing: Transaction }> {
  const occurredAt = input.occurredAt ?? new Date();

  // Duplicate guard: same amount + merchant within ±1 minute is almost certainly a repeated entry
  const [existing] = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      eq(transactions.amount, input.amount),
      eq(transactions.merchant, input.merchant),
      gte(transactions.occurredAt, new Date(occurredAt.getTime() - DUPLICATE_WINDOW_MS)),
      lte(transactions.occurredAt, new Date(occurredAt.getTime() + DUPLICATE_WINDOW_MS)),
    ))
    .limit(1);
  if (existing) return { ok: false, reason: "duplicate", existing };

  const number = await reserveTransactionNumbers(userId, 1);
  const [created] = await db
    .insert(transactions)
    .values({
      userId,
      number,
      occurredAt,
      amount: input.amount,
      currency: "KRW",
      merchant: input.merchant,
      cardOrg: MANUAL_CARD_ORG,
      cardName: MANUAL_METHOD_LABELS[input.method ?? "transfer"],
      installmentMonths: 0,
      status: "approved",
      category: input.category ?? null,
      categorySource: input.category != null ? "user" : null,
      memo: input.memo ?? null,
      externalId: `manual:${crypto.randomUUID()}`,
    })
    .returning();
  return { ok: true, tx: created };
}

/** Delete a manually entered transaction. Synced card rows cannot be deleted (the Mac sync would re-create them). */
export async function deleteManualTransaction(
  userId: string,
  number: number
): Promise<{ ok: true; tx: Transaction } | { ok: false; reason: "not_found" | "not_manual" }> {
  const [deleted] = await db
    .delete(transactions)
    .where(and(
      eq(transactions.userId, userId),
      eq(transactions.number, number),
      eq(transactions.cardOrg, MANUAL_CARD_ORG),
    ))
    .returning();
  if (deleted) return { ok: true, tx: deleted };

  // Nothing deleted: distinguish a missing row from a synced (non-manual) one
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.number, number)))
    .limit(1);
  return { ok: false, reason: row ? "not_manual" : "not_found" };
}

// --- Summary ---

export type SummaryBucket = { key: string; total: number; count: number };

export type MonthSummary = {
  month: string;
  total: number;
  count: number;
  cancelledCount: number;
  unconvertedCount: number;
  byCategory: SummaryBucket[];
  byCard: SummaryBucket[];
  topMerchants: SummaryBucket[];
  shinhanTotal: number | null;
  previous: { month: string; total: number };
  changePct: number | null;
};

export function isExcluded(tx: Transaction): boolean {
  return tx.excludedAt != null;
}

/** Signed KRW contribution of a transaction: approved adds, cancelled subtracts; declined, unknown, and user-excluded rows count 0. */
export function signedAmount(tx: Transaction): number {
  if (tx.amount == null || isExcluded(tx)) return 0;
  if (tx.status === "approved") return Math.abs(tx.amount);
  if (tx.status === "cancelled") return -Math.abs(tx.amount);
  return 0;
}

function cardLabel(tx: Transaction): string {
  return tx.cardName || tx.cardOrg;
}

function isShinhan(tx: Transaction): boolean {
  const text = `${tx.cardOrg} ${tx.cardName ?? ""}`.toLowerCase();
  return text.includes("shinhan") || text.includes("신한");
}

function bucketize(rows: Transaction[], keyOf: (tx: Transaction) => string): SummaryBucket[] {
  const map = new Map<string, SummaryBucket>();
  for (const tx of rows) {
    const key = keyOf(tx);
    const bucket = map.get(key) ?? { key, total: 0, count: 0 };
    bucket.total += signedAmount(tx);
    if (tx.status === "approved" && !isExcluded(tx)) bucket.count += 1;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function sumNet(rows: Transaction[]): number {
  return rows.reduce((acc, tx) => acc + signedAmount(tx), 0);
}

export function approvedCount(rows: Transaction[]): number {
  return rows.filter((tx) => tx.status === "approved" && !isExcluded(tx)).length;
}

/** Net total and approved count for an arbitrary range. */
export async function summarizeRange(userId: string, range: DateRange): Promise<{ total: number; count: number }> {
  const rows = await getTransactionsInRange(userId, range);
  return { total: sumNet(rows), count: approvedCount(rows) };
}

export async function summarizeMonth(userId: string, month: string): Promise<MonthSummary> {
  const prevMonth = previousMonth(month);
  const [rows, prevRows] = await Promise.all([
    getTransactionsInRange(userId, kstMonthRange(month)),
    getTransactionsInRange(userId, kstMonthRange(prevMonth)),
  ]);

  const counted = rows.filter((tx) => (tx.status === "approved" || tx.status === "cancelled") && !isExcluded(tx));
  const total = sumNet(counted);
  const prevTotal = sumNet(prevRows);
  const shinhanRows = counted.filter(isShinhan);

  return {
    month,
    total,
    count: counted.filter((tx) => tx.status === "approved").length,
    cancelledCount: counted.filter((tx) => tx.status === "cancelled").length,
    unconvertedCount: counted.filter((tx) => tx.amount == null).length,
    byCategory: bucketize(counted, (tx) => tx.category || "미분류"),
    byCard: bucketize(counted, cardLabel),
    topMerchants: bucketize(counted, (tx) => tx.merchant).slice(0, 5),
    shinhanTotal: shinhanRows.length > 0 ? sumNet(shinhanRows) : null,
    previous: { month: prevMonth, total: prevTotal },
    changePct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null,
  };
}

// --- Formatting (plain text, Korean) ---

export function formatWon(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

function formatTxAmount(tx: Transaction): string {
  if (tx.amount != null) return formatWon(tx.amount);
  if (tx.originalAmount) return `${tx.originalAmount} ${tx.currency}`;
  return "금액 미상";
}

/** One-line transaction: `#12 14:32 스타벅스 5,600원 [현대 ZERO]`. */
export function formatTransactionLine(tx: Transaction, options: { withDate?: boolean } = {}): string {
  const when = options.withDate
    ? `${kstDateString(tx.occurredAt).slice(5)} ${kstTimeString(tx.occurredAt)}`
    : kstTimeString(tx.occurredAt);
  const installment = tx.installmentMonths > 0 ? ` (${tx.installmentMonths}개월)` : "";
  const status = tx.status === "cancelled" ? " ❌취소" : tx.status === "declined" ? " ⛔거절" : "";
  const category = tx.category ? ` {${tx.category}}` : "";
  const memo = tx.memo ? ` — ${tx.memo}` : "";
  const excluded = isExcluded(tx) ? ` (제외${tx.excludeReason ? `: ${tx.excludeReason}` : ""})` : "";
  return `#${tx.number} ${when} ${tx.merchant} ${formatTxAmount(tx)}${installment} [${cardLabel(tx)}]${status}${excluded}${category}${memo}`;
}

export function formatMonthSummary(summary: MonthSummary): string {
  const lines: string[] = [];
  lines.push(`${summary.month} 합계: ${formatWon(summary.total)} (${summary.count}건${summary.cancelledCount > 0 ? `, 취소 ${summary.cancelledCount}건` : ""})`);

  if (summary.changePct != null) {
    const sign = summary.changePct > 0 ? "+" : "";
    lines.push(`전월(${summary.previous.month}) ${formatWon(summary.previous.total)} 대비 ${sign}${summary.changePct}%`);
  } else {
    lines.push(`전월(${summary.previous.month}) 데이터 없음`);
  }
  if (summary.unconvertedCount > 0) {
    lines.push(`※ 원화 금액 미확정 해외결제 ${summary.unconvertedCount}건은 합계에서 제외`);
  }

  if (summary.byCategory.length > 0) {
    lines.push("", "📂 카테고리별");
    for (const b of summary.byCategory.slice(0, 5)) lines.push(`- ${b.key}: ${formatWon(b.total)}`);
  }
  if (summary.byCard.length > 0) {
    lines.push("", "💳 카드별");
    for (const b of summary.byCard) lines.push(`- ${b.key}: ${formatWon(b.total)}`);
  }
  if (summary.topMerchants.length > 0) {
    lines.push("", "🏪 많이 쓴 곳 TOP 5");
    summary.topMerchants.forEach((b, i) => lines.push(`${i + 1}. ${b.key}: ${formatWon(b.total)} (${b.count}회)`));
  }
  if (summary.shinhanTotal != null) {
    const met = summary.shinhanTotal >= SHINHAN_THRESHOLD;
    const gap = met ? "달성" : `${formatWon(SHINHAN_THRESHOLD - summary.shinhanTotal)} 부족`;
    lines.push("", `🎯 신한 실적: ${formatWon(summary.shinhanTotal)} / ${formatWon(SHINHAN_THRESHOLD)} (${gap})`);
  }
  return lines.join("\n");
}
