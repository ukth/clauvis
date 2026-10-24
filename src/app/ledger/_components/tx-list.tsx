"use client";

import { useState } from "react";
import { PencilSquareIcon, SparklesIcon } from "@heroicons/react/24/outline";
import type { LedgerTransaction } from "@/lib/ledger-web";
import { cardOf, kstTime, txAmount, won } from "./format";
import { TxSheet } from "./tx-sheet";

export type TxGroup = { key: string; label?: string; total?: number; transactions: LedgerTransaction[] };

function CategoryTag({ tx }: { tx: LedgerTransaction }) {
  const ai = tx.categorySource === "ai";
  return (
    <span className={`flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-px text-[11px] font-medium ${ai ? "bg-[#4C7BF3]/12 text-[#4C7BF3]" : "bg-[#1A2342] text-[#EEF1F8]"}`}>
      {ai ? <SparklesIcon aria-label="AI 분류" className="size-2.5" /> : null}
      {tx.category ?? "미분류"}
    </span>
  );
}

function TxRow({ tx, onOpen, detailed }: { tx: LedgerTransaction; onOpen: () => void; detailed: boolean }) {
  return (
    <button type="button" onClick={onOpen} className={`flex w-full flex-col gap-2 px-3.5 py-3 text-left ${tx.excluded ? "opacity-50" : ""}`}>
      <div className="flex w-full items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-xs tabular-nums text-[#8A93AD]">#{tx.number}</span>
            <span className="truncate text-[15px] font-medium">{tx.merchant}</span>
          </p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-[#8A93AD]">
            <CategoryTag tx={tx} />
            <span className="truncate">{cardOf(tx)} · {kstTime(tx.occurredAt)}</span>
          </p>
        </div>
        <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${tx.status === "cancelled" ? "text-[#3FB98A]" : ""} ${tx.excluded ? "line-through" : ""} ${tx.status === "declined" ? "text-[#8A93AD] line-through" : ""}`}>
          {txAmount(tx)}
        </span>
      </div>
      {detailed && tx.items?.length ? (
        <div className="flex w-full flex-col gap-1.5 rounded-[10px] bg-[#0A0F1E] px-3 py-2.5">
          {tx.items.map((item, index) => (
            <div key={index} className="flex justify-between gap-2 text-xs text-[#8A93AD]">
              <span>{item.name}</span>
              {item.price != null ? <span className="shrink-0 tabular-nums">{won(item.price)}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {tx.memo ? (
        <p className="flex items-center gap-1.5 text-xs text-[#F2A93B]">
          <PencilSquareIcon aria-hidden="true" className="size-3" /> {tx.memo}
        </p>
      ) : null}
      {tx.status === "declined" ? <p className="text-[11px] text-[#F06A6A]">승인 거절</p> : null}
      {tx.excluded ? <p className="text-[11px] text-[#8A93AD]">제외됨 · 합계에서 빠짐{tx.excludeReason ? ` (${tx.excludeReason})` : ""}</p> : null}
    </button>
  );
}

/** Grouped transaction rows; tapping a row opens the 05 detail sheet. */
export function TxList({ groups, detailed = true }: { groups: TxGroup[]; detailed?: boolean }) {
  const [open, setOpen] = useState<LedgerTransaction | null>(null);
  return (
    <>
      <div className="flex flex-col gap-[18px]">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2">
            {group.label ? (
              <header className="flex justify-between text-[13px] text-[#8A93AD]">
                <h3 className="font-semibold">{group.label}</h3>
                {group.total != null ? <span className="tabular-nums">-{won(group.total)}</span> : null}
              </header>
            ) : null}
            <ul className="overflow-hidden rounded-2xl bg-[#121A30]">
              {group.transactions.map((tx, index) => (
                <li key={tx.id} className={index ? "border-t border-[#243055]" : ""}>
                  <TxRow tx={tx} detailed={detailed} onOpen={() => setOpen(tx)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {open ? <TxSheet key={open.id} tx={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
