import "server-only";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "./db";
import { transactions, users, webSessions, type TransactionItem } from "./db/schema";
import { requireLedgerSession } from "./ledger-auth";
import {
  approvedCount, getTransactionsInRange, isCategory, isExcluded, isValidMonth,
  kstDateString, kstDayOfMonth, kstMonthRange, kstMonthString,
  kstMonthToDateRanges, previousMonth, SHINHAN_THRESHOLD, signedAmount,
  summarizeMonth, summarizeRange, sumNet,
  type Category, type SummaryBucket, type Transaction,
} from "./ledger";

export interface LedgerTransaction {
  id: string;
  number: number;
  occurredAt: string;
  amount: number | null;
  currency: string;
  originalAmount: string | null;
  merchant: string;
  cardOrg: string;
  cardName: string | null;
  installmentMonths: number;
  status: string;
  category: string | null;
  categorySource: "rule" | "ai" | "user" | null;
  items: TransactionItem[] | null;
  memo: string | null;
  excluded: boolean;
  excludedAt: string | null;
  excludeReason: string | null;
}

export interface LedgerCardPerformance extends SummaryBucket {
  target: number | null;
  remaining: number | null;
  benefit: string | null;
}

export interface LedgerHome {
  month: string;
  total: number;
  count: number;
  comparison: {
    currentTotal: number;
    previousTotal: number;
    changePct: number | null;
  };
  categories: SummaryBucket[];
  dailyTotals: { date: string; total: number; count: number }[];
  cards: LedgerCardPerformance[];
  recentTransactions: LedgerTransaction[];
  lastSyncedAt: string | null;
}

export interface LedgerTransactionFilters {
  month: string;
  category?: Category | "미분류";
  cardName?: string;
  search?: string;
  includeExcluded?: boolean;
}

export interface LedgerTransactionList {
  month: string;
  transactions: LedgerTransaction[];
  total: number;
  count: number;
}

export interface LedgerTrends {
  months: { month: string; total: number; count: number }[];
  projectedMonthTotal: number;
  categories: { category: string; currentTotal: number; previousTotal: number }[];
  frequentMerchants: SummaryBucket[];
}

export interface LedgerSettings {
  sessions: {
    id: string;
    userAgent: string | null;
    lastSeenAt: string;
    expiresAt: string;
    createdAt: string;
    current: boolean;
  }[];
  lastSyncedAt: string | null;
  aiClassificationAvailable: boolean;
}

async function authorize(userId: string) {
  const session = await requireLedgerSession();
  if (session.userId !== userId) throw new Error("접근 권한이 없습니다.");
  return session;
}

function validateMonth(month: string): void {
  if (typeof month !== "string" || !isValidMonth(month)) {
    throw new Error("월은 YYYY-MM 형식이어야 합니다.");
  }
}

function toTransaction(row: Transaction): LedgerTransaction {
  return {
    id: row.id,
    number: row.number,
    occurredAt: row.occurredAt.toISOString(),
    amount: row.amount,
    currency: row.currency,
    originalAmount: row.originalAmount,
    merchant: row.merchant,
    cardOrg: row.cardOrg,
    cardName: row.cardName,
    installmentMonths: row.installmentMonths,
    status: row.status,
    category: row.category,
    categorySource: row.categorySource,
    items: row.items,
    memo: row.memo,
    excluded: isExcluded(row),
    excludedAt: row.excludedAt?.toISOString() ?? null,
    excludeReason: row.excludeReason,
  };
}

function newestFirst(a: Transaction, b: Transaction): number {
  return b.occurredAt.getTime() - a.occurredAt.getTime() || b.number - a.number;
}

function daysInMonth(month: string): number {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

/** Keep the goal card visible even before its first charge of the month. */
function withShinhanGoal(cards: LedgerCardPerformance[]): LedgerCardPerformance[] {
  if (cards.some((card) => card.target !== null)) return cards;
  return [...cards, {
    key: "신한 T&Life", total: 0, count: 0,
    target: SHINHAN_THRESHOLD, remaining: SHINHAN_THRESHOLD, benefit: "통신비 21,000원 할인",
  }];
}

export async function getLedgerHome(userId: string, month = kstMonthString()): Promise<LedgerHome> {
  await authorize(userId);
  validateMonth(month);
  const now = new Date();
  const ranges = month === kstMonthString(now)
    ? kstMonthToDateRanges(now)
    : { current: kstMonthRange(month), previous: kstMonthRange(previousMonth(month)) };
  const [summary, rows, current, previous, [user]] = await Promise.all([
    summarizeMonth(userId, month),
    getTransactionsInRange(userId, kstMonthRange(month)),
    summarizeRange(userId, ranges.current),
    summarizeRange(userId, ranges.previous),
    db.select({ lastSyncedAt: users.ledgerSyncedAt }).from(users).where(eq(users.id, userId)),
  ]);
  const dailyTotals = Array.from({ length: daysInMonth(month) }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, "0")}`, total: 0, count: 0,
  }));
  for (const row of rows) {
    const day = dailyTotals[kstDayOfMonth(row.occurredAt) - 1];
    day.total += signedAmount(row);
    if (row.status === "approved" && !isExcluded(row)) day.count += 1;
  }
  return {
    month,
    total: summary.total,
    count: summary.count,
    comparison: {
      currentTotal: current.total,
      previousTotal: previous.total,
      changePct: previous.total > 0
        ? Math.round((current.total - previous.total) / previous.total * 1000) / 10 : null,
    },
    categories: summary.byCategory,
    dailyTotals,
    cards: withShinhanGoal(summary.byCard.map((card) => {
      const eligible = rows.some((row) => (row.cardName || row.cardOrg) === card.key
        && /신한|shinhan/i.test(`${row.cardOrg} ${row.cardName ?? ""}`)
        && /t\s*[&＆]?\s*life|t\s*라이프/i.test(row.cardName ?? ""));
      return {
        ...card,
        target: eligible ? SHINHAN_THRESHOLD : null,
        remaining: eligible ? Math.max(0, SHINHAN_THRESHOLD - card.total) : null,
        benefit: eligible ? "통신비 21,000원 할인" : null,
      };
    })),
    recentTransactions: rows.sort(newestFirst).slice(0, 3).map(toTransaction),
    lastSyncedAt: user?.lastSyncedAt?.toISOString() ?? null,
  };
}

export async function getLedgerTransactions(
  userId: string, filters: LedgerTransactionFilters,
): Promise<LedgerTransactionList> {
  await authorize(userId);
  if (!filters || typeof filters !== "object") throw new Error("조회 조건이 올바르지 않습니다.");
  validateMonth(filters.month);
  if (filters.category !== undefined && filters.category !== "미분류"
    && (typeof filters.category !== "string" || !isCategory(filters.category))) {
    throw new Error("올바른 카테고리를 선택해 주세요.");
  }
  if ((filters.cardName !== undefined && typeof filters.cardName !== "string")
    || (filters.search !== undefined && (typeof filters.search !== "string" || filters.search.length > 200))
    || (filters.includeExcluded !== undefined && typeof filters.includeExcluded !== "boolean")) {
    throw new Error("조회 조건이 올바르지 않습니다.");
  }
  // The existing list helper caps results at 200; range queries preserve complete monthly data.
  const rows = await getTransactionsInRange(userId, kstMonthRange(filters.month));
  const search = filters.search?.trim().toLocaleLowerCase("ko-KR") ?? "";
  const amountSearch = search.replace(/[,\s원]/g, "");
  const filtered = rows.filter((row) => {
    if (!filters.includeExcluded && isExcluded(row)) return false;
    if (filters.category && (row.category || "미분류") !== filters.category) return false;
    if (filters.cardName && (row.cardName || row.cardOrg) !== filters.cardName) return false;
    return !search || row.merchant.toLocaleLowerCase("ko-KR").includes(search)
      || (/^#\d+$/.test(search) && row.number === Number(search.slice(1)))
      || (/^-?\d+$/.test(amountSearch) && row.amount === Number(amountSearch));
  });
  return {
    month: filters.month,
    transactions: filtered.sort(newestFirst).map(toTransaction),
    total: sumNet(filtered),
    count: filtered.length,
  };
}

export async function getLedgerTrends(userId: string): Promise<LedgerTrends> {
  await authorize(userId);
  const now = new Date();
  const month = kstMonthString(now);
  const months = [month];
  for (let index = 1; index < 6; index += 1) months.unshift(previousMonth(months[0]));
  const [rows, current, previous] = await Promise.all([
    getTransactionsInRange(userId, { start: kstMonthRange(months[0]).start, end: now }),
    summarizeMonth(userId, month),
    summarizeMonth(userId, previousMonth(month)),
  ]);
  const currentRows = rows.filter((row) => kstMonthString(row.occurredAt) === month);
  const categories = new Set([...current.byCategory, ...previous.byCategory].map((bucket) => bucket.key));
  const merchants = new Map<string, SummaryBucket>();
  for (const row of rows) {
    if (isExcluded(row) || !["approved", "cancelled"].includes(row.status)) continue;
    const bucket = merchants.get(row.merchant) ?? { key: row.merchant, total: 0, count: 0 };
    bucket.total += signedAmount(row);
    if (row.status === "approved") bucket.count += 1;
    merchants.set(row.merchant, bucket);
  }
  return {
    months: months.map((value) => {
      const monthRows = rows.filter((row) => kstDateString(row.occurredAt).startsWith(value));
      return { month: value, total: sumNet(monthRows), count: approvedCount(monthRows) };
    }),
    projectedMonthTotal: Math.round(sumNet(currentRows) / kstDayOfMonth(now) * daysInMonth(month)),
    categories: [...categories].map((category) => ({
      category,
      currentTotal: current.byCategory.find((bucket) => bucket.key === category)?.total ?? 0,
      previousTotal: previous.byCategory.find((bucket) => bucket.key === category)?.total ?? 0,
    })),
    frequentMerchants: [...merchants.values()].filter((bucket) => bucket.count > 0)
      .sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 5),
  };
}

export async function getLedgerSettings(userId: string): Promise<LedgerSettings> {
  const session = await authorize(userId);
  const [sessions, [user]] = await Promise.all([
    db.select({
      id: webSessions.id, userAgent: webSessions.userAgent, lastSeenAt: webSessions.lastSeenAt,
      expiresAt: webSessions.expiresAt, createdAt: webSessions.createdAt,
    }).from(webSessions).where(and(eq(webSessions.userId, userId), gt(webSessions.expiresAt, new Date())))
      .orderBy(desc(webSessions.lastSeenAt)),
    db.select({
      lastSyncedAt: users.ledgerSyncedAt,
      aiClassificationAvailable: sql<boolean>`${users.encryptedAnthropicKey} is not null and ${users.encryptedAnthropicKey} <> ''`,
    }).from(users).where(eq(users.id, userId)),
  ]);
  return {
    sessions: sessions.map((row) => ({
      id: row.id, userAgent: row.userAgent, current: row.id === session.id,
      lastSeenAt: row.lastSeenAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
    lastSyncedAt: user?.lastSyncedAt?.toISOString() ?? null,
    aiClassificationAvailable: user?.aiClassificationAvailable ?? false,
  };
}

export async function getLedgerTransaction(userId: string, number: number): Promise<LedgerTransaction | null> {
  await authorize(userId);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("거래 번호가 올바르지 않습니다.");
  const [row] = await db.select().from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.number, number))).limit(1);
  return row ? toTransaction(row) : null;
}
