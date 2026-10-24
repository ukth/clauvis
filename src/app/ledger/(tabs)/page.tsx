import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { getLedgerHome } from "@/lib/ledger-web";
import { isValidMonth, kstDayOfMonth, kstMonthString } from "@/lib/ledger";
import { requestTime, requirePageSession } from "../_components/session";
import { categoryColor, monthLabel, relativeTime, shiftMonth, won } from "../_components/format";
import { TxList } from "../_components/tx-list";

function SectionHeader({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-base font-bold">{title}</h2>
      {href && link ? <Link href={href} className="text-[13px] text-[#4C7BF3]">{link}</Link> : null}
    </div>
  );
}

export default async function LedgerHomePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await requirePageSession();
  const params = await searchParams;
  const current = kstMonthString();
  const month = params.month && isValidMonth(params.month) && params.month <= current ? params.month : current;
  const home = await getLedgerHome(session.userId, month);
  const now = requestTime();
  const isCurrent = month === current;
  const today = isCurrent ? kstDayOfMonth() : -1;

  const categories = home.categories.filter((c) => c.total > 0);
  const categoryTotal = categories.reduce((acc, c) => acc + c.total, 0);
  const top = categories.slice(0, 5);
  const restTotal = categories.slice(5).reduce((acc, c) => acc + c.total, 0);
  const maxDaily = Math.max(...home.dailyTotals.map((d) => d.total), 1);
  const change = home.comparison.changePct;

  return (
    <main className="flex flex-col gap-7 px-5 pt-[max(16px,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between pt-2">
        <nav aria-label="월 이동" className="flex items-center gap-2">
          <Link href={`/ledger?month=${shiftMonth(month, -1)}`} aria-label="이전 달" className="text-[#8A93AD]">
            <ChevronLeftIcon className="size-5" />
          </Link>
          <h1 className="text-xl font-bold">{monthLabel(month)}</h1>
          {isCurrent ? (
            <span className="size-5" />
          ) : (
            <Link href={`/ledger?month=${shiftMonth(month, 1)}`} aria-label="다음 달" className="text-[#8A93AD]">
              <ChevronRightIcon className="size-5" />
            </Link>
          )}
        </nav>
        <p className="flex items-center gap-1 text-xs text-[#8A93AD]">
          <span className={`size-1.5 rounded-full ${home.lastSyncedAt && now - Date.parse(home.lastSyncedAt) < 48 * 3_600_000 ? "bg-[#3FB98A]" : "bg-[#F2A93B]"}`} />
          {relativeTime(home.lastSyncedAt, now)} 동기화
        </p>
      </header>

      <section aria-label="이번 달 지출" className="flex flex-col gap-1.5">
        <p className="text-sm text-[#8A93AD]">{isCurrent ? "이번 달 지출" : `${monthLabel(month)} 지출`}</p>
        <p className="text-[38px] font-bold leading-tight tracking-tight tabular-nums">{won(home.total)}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-[#8A93AD]">
          {change != null ? (
            <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${change > 0 ? "bg-[#F06A6A]/15 text-[#F06A6A]" : "bg-[#3FB98A]/15 text-[#3FB98A]"}`}>
              {change > 0 ? "▲" : "▼"} {Math.abs(Math.round(change))}%
            </span>
          ) : null}
          <span>{isCurrent ? "지난달 같은 기간" : "지난달"} {won(home.comparison.previousTotal)}</span>
          <span>· {home.count}건</span>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-[20px] bg-[#121A30] p-[18px]">
        <SectionHeader title="카테고리" href={`/ledger/transactions?month=${month}`} link="전체" />
        {categories.length ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-md bg-[#1A2342]">
              {categories.map((c) => (
                <span key={c.key} style={{ width: `${(c.total / categoryTotal) * 100}%`, background: categoryColor(c.key) }} />
              ))}
            </div>
            <ul className="flex flex-col gap-3">
              {top.map((c) => (
                <li key={c.key}>
                  <Link href={`/ledger/transactions?month=${month}&category=${encodeURIComponent(c.key)}`} className="flex items-center gap-2.5 text-sm">
                    <span className="size-2.5 rounded-full" style={{ background: categoryColor(c.key) }} />
                    <span className="flex-1">{c.key}</span>
                    <span className="text-[13px] tabular-nums text-[#8A93AD]">{Math.round((c.total / categoryTotal) * 100)}%</span>
                    <span className="w-24 text-right font-semibold tabular-nums">{won(c.total)}</span>
                  </Link>
                </li>
              ))}
              {restTotal > 0 ? (
                <li className="flex items-center gap-2.5 text-sm text-[#8A93AD]">
                  <span className="size-2.5 rounded-full bg-[#4A5578]" />
                  <span className="flex-1">그 외 {categories.length - 5}개</span>
                  <span className="w-24 text-right tabular-nums">{won(restTotal)}</span>
                </li>
              ) : null}
            </ul>
          </>
        ) : (
          <p className="text-sm text-[#8A93AD]">아직 지출이 없어요.</p>
        )}
      </section>

      <section className="flex flex-col gap-3.5 rounded-[20px] bg-[#121A30] p-[18px]">
        <SectionHeader title="일별 지출" />
        <div className="flex h-[90px] items-end gap-[3px]" role="img" aria-label="일별 지출 막대 그래프">
          {home.dailyTotals.map((d, index) => (
            <span
              key={d.date}
              title={`${index + 1}일 ${won(d.total)}`}
              className={`flex-1 rounded-sm ${index + 1 === today ? "bg-[#4C7BF3]" : "bg-[#2C3A66]"} ${today > 0 && index + 1 > today ? "opacity-30" : ""}`}
              style={{ height: `${Math.max(3, (Math.max(d.total, 0) / maxDaily) * 90)}px` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-[#8A93AD]">
          <span>1일</span>
          <span>{Math.ceil(home.dailyTotals.length / 2)}일</span>
          <span>{home.dailyTotals.length}일</span>
        </div>
      </section>

      {home.cards.length ? (
        <section className="flex flex-col gap-3.5 rounded-[20px] bg-[#121A30] p-[18px]">
          <SectionHeader title="카드 실적" />
          {home.cards.map((card) => (
            <div key={card.key} className="flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{card.key}</span>
                <span className="text-[13px] tabular-nums text-[#8A93AD]">
                  {card.target ? `${card.total.toLocaleString("ko-KR")} / ${card.target.toLocaleString("ko-KR")}` : won(card.total)}
                </span>
              </div>
              {card.target ? (
                <>
                  <div className="h-2 overflow-hidden rounded bg-[#1A2342]">
                    <span className="block h-full rounded bg-[#4C7BF3]" style={{ width: `${Math.min(100, (card.total / card.target) * 100)}%` }} />
                  </div>
                  <p className={`text-xs ${card.remaining ? "text-[#F2A93B]" : "text-[#3FB98A]"}`}>
                    {card.remaining ? `${won(card.remaining)} 더 쓰면 ${card.benefit}` : `실적 달성 · ${card.benefit}`}
                  </p>
                </>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeader title="최근 내역" href={`/ledger/transactions?month=${month}`} link="더보기" />
        {home.recentTransactions.length ? (
          <TxList groups={[{ key: "recent", transactions: home.recentTransactions }]} detailed={false} />
        ) : (
          <p className="text-sm text-[#8A93AD]">내역이 없어요.</p>
        )}
      </section>
    </main>
  );
}
