"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDownIcon, MagnifyingGlassIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { CATEGORY_LIST, monthLabel, shiftMonth } from "../../_components/format";
import { AddTxSheet } from "./add-tx-sheet";

type Props = {
  month: string;
  category: string | null;
  card: string | null;
  query: string;
  includeExcluded: boolean;
  cards: string[];
  current: string;
};

function Chip({ label, active, value, options, onChange }: {
  label: string; active: boolean; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return (
    <label className={`relative flex shrink-0 items-center gap-1 rounded-2xl px-3 py-[7px] text-[13px] ${active ? "bg-[#4C7BF3] font-semibold text-white" : "border border-[#243055] bg-[#121A30]"}`}>
      {label}
      <ChevronDownIcon aria-hidden="true" className={`size-3 ${active ? "text-white" : "text-[#8A93AD]"}`} />
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="absolute inset-0 cursor-pointer opacity-0">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function ListFilters({ month, category, card, query, includeExcluded, cards, current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [searching, setSearching] = useState(query !== "");
  const [text, setText] = useState(query);
  const [adding, setAdding] = useState(false);

  const go = (patch: Partial<Record<"month" | "category" | "card" | "q" | "excluded", string | null>>) => {
    const next = { month, category, card, q: query || null, excluded: includeExcluded ? "1" : null, ...patch };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(current, -i));

  return (
    <>
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-[28px] font-bold">내역</h1>
        <div className="flex gap-4">
          <button type="button" aria-label="검색" onClick={() => setSearching((v) => !v)} className="text-[#8A93AD]">
            <MagnifyingGlassIcon className="size-[22px]" />
          </button>
          <button type="button" aria-label="직접 추가" onClick={() => setAdding(true)} className="text-[#4C7BF3]">
            <PlusIcon className="size-[22px]" />
          </button>
        </div>
      </header>

      {searching ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: text.trim() || null });
          }}
          className="flex h-11 items-center gap-2 rounded-xl border border-[#243055] bg-[#121A30] px-3.5"
        >
          <MagnifyingGlassIcon aria-hidden="true" className="size-4 text-[#8A93AD]" />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="가맹점, 금액, #번호로 검색"
            enterKeyHint="search"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#5B6584]"
          />
          {text ? (
            <button type="button" aria-label="검색어 지우기" onClick={() => { setText(""); go({ q: null }); }}>
              <XMarkIcon className="size-4 text-[#8A93AD]" />
            </button>
          ) : null}
        </form>
      ) : null}

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
        <Chip label={monthLabel(month).replace(/^\d+년 /, "")} active value={month} onChange={(v) => go({ month: v })}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
        <Chip label={category ?? "전체 카테고리"} active={category !== null} value={category ?? ""} onChange={(v) => go({ category: v || null })}
          options={[{ value: "", label: "전체 카테고리" }, ...CATEGORY_LIST.map((c) => ({ value: c, label: c })), { value: "미분류", label: "미분류" }]} />
        <Chip label={card ?? "전체 카드"} active={card !== null} value={card ?? ""} onChange={(v) => go({ card: v || null })}
          options={[{ value: "", label: "전체 카드" }, ...cards.map((c) => ({ value: c, label: c }))]} />
        <button type="button" onClick={() => go({ excluded: includeExcluded ? null : "1" })}
          className={`shrink-0 rounded-2xl px-3 py-[7px] text-[13px] ${includeExcluded ? "bg-[#4C7BF3] font-semibold text-white" : "border border-[#243055] bg-[#121A30]"}`}>
          제외 포함
        </button>
      </div>
      {adding ? <AddTxSheet onClose={() => setAdding(false)} /> : null}
    </>
  );
}
