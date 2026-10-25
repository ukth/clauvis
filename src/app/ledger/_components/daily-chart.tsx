"use client";

import { useState } from "react";
import { won } from "./format";

type DailyTotal = { date: string; total: number; count: number };

/** Daily spending bars; hover (mouse) or tap shows that day's total above the bar. */
export function DailyChart({ dailyTotals, today }: { dailyTotals: DailyTotal[]; today: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const maxDaily = Math.max(...dailyTotals.map((d) => d.total), 1);
  const active = selected != null ? dailyTotals[selected] : null;
  // Keep the bubble inside the card near the edges
  const position = selected != null ? ((selected + 0.5) / dailyTotals.length) * 100 : 0;
  const shift = position < 15 ? "0%" : position > 85 ? "-100%" : "-50%";

  return (
    <div className="relative pt-9" onPointerLeave={(e) => { if (e.pointerType === "mouse") setSelected(null); }}>
      {active && selected != null ? (
        <div
          className="pointer-events-none absolute top-0 whitespace-nowrap rounded-lg bg-[#1A2342] px-2 py-1 text-xs shadow-lg"
          style={{ left: `${position}%`, transform: `translateX(${shift})` }}
        >
          <span className="text-[#8A93AD]">{selected + 1}일</span>{" "}
          <span className="font-semibold tabular-nums text-[#EEF1F8]">{won(active.total)}</span>
          {active.count ? <span className="text-[#8A93AD]"> · {active.count}건</span> : null}
        </div>
      ) : null}
      <div className="flex h-[90px] items-end gap-[3px]" role="group" aria-label="일별 지출 막대 그래프">
        {dailyTotals.map((d, index) => (
          <button
            key={d.date}
            type="button"
            aria-label={`${index + 1}일 ${won(d.total)}`}
            onPointerEnter={(e) => { if (e.pointerType === "mouse") setSelected(index); }}
            onClick={() => setSelected((current) => (current === index ? null : index))}
            className={`flex h-full flex-1 items-end ${today > 0 && index + 1 > today ? "opacity-30" : ""}`}
          >
            <span
              className={`w-full rounded-sm ${index === selected ? "bg-[#7EA2FF]" : index + 1 === today ? "bg-[#4C7BF3]" : "bg-[#2C3A66]"}`}
              style={{ height: `${Math.max(3, (Math.max(d.total, 0) / maxDaily) * 90)}px` }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
