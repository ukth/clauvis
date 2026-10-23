import { db } from "./db";
import { transactions } from "./db/schema";
import { eq, and, gte, lt, desc, asc } from "drizzle-orm";

// --- KST date helpers ---

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

export const SHINHAN_THRESHOLD = 300_000;

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
  input: { memo?: string | null; category?: string | null }
): Promise<Transaction | null> {
  const updateData: { memo?: string | null; category?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (input.memo !== undefined) updateData.memo = input.memo;
  if (input.category !== undefined) updateData.category = input.category;

  const [updated] = await db
    .update(transactions)
    .set(updateData)
    .where(and(eq(transactions.userId, userId), eq(transactions.number, number)))
    .returning();
  return updated ?? null;
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

/** Signed KRW contribution of a transaction: approved adds, cancelled subtracts, declined/unknown ignored. */
export function signedAmount(tx: Transaction): number {
  if (tx.amount == null) return 0;
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
    if (tx.status === "approved") bucket.count += 1;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function sumNet(rows: Transaction[]): number {
  return rows.reduce((acc, tx) => acc + signedAmount(tx), 0);
}

export async function summarizeMonth(userId: string, month: string): Promise<MonthSummary> {
  const prevMonth = previousMonth(month);
  const [rows, prevRows] = await Promise.all([
    getTransactionsInRange(userId, kstMonthRange(month)),
    getTransactionsInRange(userId, kstMonthRange(prevMonth)),
  ]);

  const counted = rows.filter((tx) => tx.status === "approved" || tx.status === "cancelled");
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
  return `#${tx.number} ${when} ${tx.merchant} ${formatTxAmount(tx)}${installment} [${cardLabel(tx)}]${status}${category}${memo}`;
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
