import { getLedgerTransactions, type LedgerTransactionFilters } from "@/lib/ledger-web";
import { isCategory, isValidMonth, kstDateString, kstMonthString, type Category } from "@/lib/ledger";
import { requirePageSession } from "../../_components/session";
import { cardOf, dayLabel, kstDate, won } from "../../_components/format";
import { TxList, type TxGroup } from "../../_components/tx-list";
import { ListFilters } from "./list-filters";

type Search = { month?: string; category?: string; card?: string; q?: string; excluded?: string; cancelled?: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requirePageSession();
  const params = await searchParams;
  const current = kstMonthString();
  const month = params.month && isValidMonth(params.month) && params.month <= current ? params.month : current;
  const category = params.category === "미분류" || (params.category && isCategory(params.category))
    ? (params.category as Category | "미분류") : undefined;
  const filters: LedgerTransactionFilters = {
    month,
    category,
    cardName: params.card || undefined,
    search: params.q?.slice(0, 200) || undefined,
    includeExcluded: params.excluded === "1",
    includeCancelled: params.cancelled === "1",
  };
  const [list, all] = await Promise.all([
    getLedgerTransactions(session.userId, filters),
    getLedgerTransactions(session.userId, { month, includeExcluded: true }),
  ]);
  const cards = [...new Set(all.transactions.map(cardOf))].sort();

  const today = kstDateString();
  const byDay = new Map<string, TxGroup>();
  for (const tx of list.transactions) {
    const date = kstDate(tx.occurredAt);
    const group = byDay.get(date) ?? { key: date, label: dayLabel(date, today), total: 0, transactions: [] };
    group.transactions.push(tx);
    // Same rule as signedAmount: approved adds, cancelled subtracts, regardless of the stored sign
    if (!tx.excluded && tx.amount != null) {
      const amount = Math.abs(tx.amount);
      group.total = (group.total ?? 0) + (tx.status === "approved" ? amount : tx.status === "cancelled" ? -amount : 0);
    }
    byDay.set(date, group);
  }

  return (
    <main className="flex flex-col gap-[18px] px-5 pt-[max(16px,env(safe-area-inset-top))]">
      <ListFilters month={month} category={category ?? null} card={filters.cardName ?? null} query={filters.search ?? ""} includeExcluded={filters.includeExcluded ?? false} includeCancelled={filters.includeCancelled ?? false} cards={cards} current={current} />
      <p className="flex justify-between text-[13px] text-[#8A93AD]">
        <span>{list.count}건</span>
        <span>합계 {won(list.total)}</span>
      </p>
      {byDay.size ? <TxList groups={[...byDay.values()]} /> : <p className="py-10 text-center text-sm text-[#8A93AD]">조건에 맞는 내역이 없어요.</p>}
    </main>
  );
}
