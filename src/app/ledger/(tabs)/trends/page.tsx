import { getLedgerTrends } from "@/lib/ledger-web";
import { kstDayOfMonth } from "@/lib/ledger";
import { requirePageSession } from "../../_components/session";
import { manwon, won } from "../../_components/format";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 rounded-[20px] bg-[#121A30] p-[18px]">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default async function TrendsPage() {
  const session = await requirePageSession();
  const trends = await getLedgerTrends(session.userId);
  const max = Math.max(...trends.months.map((m) => m.total), 1);
  const lastIndex = trends.months.length - 1;
  const categories = trends.categories
    .filter((c) => c.currentTotal > 0 || c.previousTotal > 0)
    .sort((a, b) => b.currentTotal - a.currentTotal);

  return (
    <main className="flex flex-col gap-6 px-5 pt-[max(16px,env(safe-area-inset-top))]">
      <h1 className="pt-2 text-[28px] font-bold">추이</h1>

      <Card title="월별 지출">
        <div className="flex h-[150px] items-end gap-3.5" role="img" aria-label="최근 6개월 월별 지출">
          {trends.months.map((m, index) => {
            const on = index === lastIndex;
            return (
              <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
                <span className={`text-[10px] tabular-nums ${on ? "text-[#4C7BF3]" : "text-[#8A93AD]"}`}>{manwon(m.total)}</span>
                <span className={`w-full rounded-md ${on ? "bg-[#4C7BF3]" : "bg-[#2C3A66]"}`} style={{ height: `${Math.max(4, (Math.max(m.total, 0) / max) * 110)}px` }} />
                <span className="text-[11px] text-[#8A93AD]">{Number(m.month.slice(5))}월</span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[#F2A93B]">
          {Number(trends.months[lastIndex].month.slice(5))}월은 {kstDayOfMonth()}일까지 기준 · 월말 예상 {won(trends.projectedMonthTotal)}
        </p>
      </Card>

      <Card title="카테고리 · 지난달 대비">
        {categories.length ? (
          <ul className="flex flex-col gap-3">
            {categories.map((c) => {
              const pct = c.previousTotal > 0 ? Math.round(((c.currentTotal - c.previousTotal) / c.previousTotal) * 100) : null;
              const tone = pct == null || pct === 0 ? "bg-[#1A2342] text-[#8A93AD]" : pct > 0 ? "bg-[#F06A6A]/15 text-[#F06A6A]" : "bg-[#3FB98A]/15 text-[#3FB98A]";
              return (
                <li key={c.category} className="flex items-center gap-2.5 text-sm">
                  <span className="flex-1">{c.category}</span>
                  <span className="font-semibold tabular-nums">{won(c.currentTotal)}</span>
                  <span className={`w-[58px] rounded-lg py-0.5 text-center text-xs font-semibold tabular-nums ${tone}`}>
                    {pct == null ? (c.previousTotal === 0 && c.currentTotal > 0 ? "신규" : "—") : pct === 0 ? "—" : `${pct > 0 ? "▲" : "▼"}${Math.abs(pct)}%`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[#8A93AD]">비교할 내역이 아직 없어요.</p>
        )}
      </Card>

      <Card title="자주 쓴 곳">
        {trends.frequentMerchants.length ? (
          <ol className="flex flex-col gap-3">
            {trends.frequentMerchants.map((m, index) => (
              <li key={m.key} className="flex items-center gap-3">
                <span className="w-3 text-[13px] font-bold text-[#8A93AD]">{index + 1}</span>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{m.key}</span>
                  <span className="text-xs text-[#8A93AD]">{m.count}회 · 최근 6개월</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">{won(m.total)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-[#8A93AD]">아직 내역이 없어요.</p>
        )}
      </Card>
    </main>
  );
}
