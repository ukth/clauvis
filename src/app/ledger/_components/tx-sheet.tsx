"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CubeIcon, SparklesIcon, TrashIcon } from "@heroicons/react/24/outline";
import type { LedgerTransaction } from "@/lib/ledger-web";
import type { Category } from "@/lib/ledger";
import { deleteLedgerManualTransaction, updateLedgerTransaction } from "../transaction-actions";
import { CATEGORY_LIST, cardOf, kstDate, kstTime, txAmount, won } from "./format";

export function BottomSheet({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button type="button" aria-label="닫기" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative max-h-[88dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-[#121A30] px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-2.5"
      >
        <div className="mb-4 flex justify-center">
          <span className="h-[5px] w-10 rounded-full bg-[#243055]" />
        </div>
        {children}
      </section>
    </div>
  );
}

export function TxSheet({ tx, onClose }: { tx: LedgerTransaction; onClose: () => void }) {
  const router = useRouter();
  const [category, setCategory] = useState<string | null>(tx.category);
  const [memo, setMemo] = useState(tx.memo ?? "");
  const [excluded, setExcluded] = useState(tx.excluded);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manual = tx.cardOrg === "manual";
  const aiGuess = tx.categorySource === "ai" && category === tx.category;

  const save = async () => {
    setSaving(true);
    setError(null);
    const changes = {
      category: category !== tx.category && category ? (category as Category) : undefined,
      memo: memo.trim() !== (tx.memo ?? "") ? memo.trim() || null : undefined,
      excluded: excluded !== tx.excluded ? excluded : undefined,
    };
    if (changes.category === undefined && changes.memo === undefined && changes.excluded === undefined) {
      onClose();
      return;
    }
    try {
      const result = await updateLedgerTransaction({ number: tx.number, ...changes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`#${tx.number} ${tx.merchant} 내역을 삭제할까요?`)) return;
    setSaving(true);
    const result = await deleteLedgerManualTransaction(tx.number).catch(() => null);
    setSaving(false);
    if (!result?.ok) {
      setError(result?.error ?? "삭제하지 못했어요.");
      return;
    }
    router.refresh();
    onClose();
  };

  return (
    <BottomSheet onClose={onClose} label={`#${tx.number} ${tx.merchant} 상세`}>
      <header className="flex flex-col gap-1.5">
        <p className="text-xs text-[#8A93AD]">
          #{tx.number} · {cardOf(tx)} · {kstDate(tx.occurredAt).slice(5).replace("-", "/")} {kstTime(tx.occurredAt)}
          {tx.installmentMonths > 0 ? ` · ${tx.installmentMonths}개월 할부` : " · 일시불"}
        </p>
        <div className="flex items-center justify-between gap-3">
          <h2 className="truncate text-[22px] font-bold">{tx.merchant}</h2>
          <p className="shrink-0 text-[22px] font-bold tabular-nums">{txAmount(tx)}</p>
        </div>
      </header>

      {tx.items?.length ? (
        <div className="mt-5 flex flex-col gap-2 rounded-[14px] bg-[#0A0F1E] p-3.5">
          <p className="flex items-center gap-1.5 text-xs text-[#8A93AD]">
            <CubeIcon aria-hidden="true" className="size-3.5" /> 주문 품목
          </p>
          {tx.items.map((item, index) => (
            <div key={index} className="flex justify-between gap-3 text-[13px]">
              <span>{item.name}{item.qty && item.qty > 1 ? ` ×${item.qty}` : ""}</span>
              {item.price != null ? <span className="shrink-0 tabular-nums text-[#8A93AD]">{won(item.price)}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-[15px] font-bold">카테고리</h3>
        {aiGuess ? (
          <span className="flex items-center gap-1 rounded-lg bg-[#4C7BF3]/12 px-2 py-0.5 text-[11px] font-medium text-[#4C7BF3]">
            <SparklesIcon aria-hidden="true" className="size-3" /> AI 자동 분류 · 탭해서 수정
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {CATEGORY_LIST.map((name) => {
          const on = name === category;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => setCategory(name)}
              className={`h-[38px] rounded-[10px] text-[13px] ${on ? "bg-[#4C7BF3] font-bold text-white" : "border border-[#243055] bg-[#1A2342]"}`}
            >
              {name}
            </button>
          );
        })}
      </div>

      <label className="mt-6 block text-[15px] font-bold" htmlFor={`memo-${tx.number}`}>메모</label>
      <input
        id={`memo-${tx.number}`}
        value={memo}
        maxLength={1000}
        onChange={(event) => setMemo(event.target.value)}
        placeholder="예: 사무실 비품"
        className="mt-2.5 h-[46px] w-full rounded-xl border border-[#243055] bg-[#0A0F1E] px-3.5 text-sm outline-none placeholder:text-[#5B6584] focus:border-[#4C7BF3]"
      />

      <div className="mt-6 flex items-center gap-3 rounded-[14px] bg-[#0A0F1E] p-3.5">
        <div className="flex-1">
          <p className="text-sm font-semibold">합계에서 제외</p>
          <p className="text-xs text-[#8A93AD]">환불·대리결제 등. 기록은 남아요</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={excluded}
          aria-label="합계에서 제외"
          onClick={() => setExcluded((value) => !value)}
          className={`relative h-7 w-12 rounded-full transition-colors ${excluded ? "bg-[#4C7BF3]" : "bg-[#243055]"}`}
        >
          <span className={`absolute top-[3px] size-[22px] rounded-full bg-white transition-all ${excluded ? "left-[23px]" : "left-[3px]"}`} />
        </button>
      </div>

      {error ? <p role="alert" className="mt-4 text-sm text-[#F06A6A]">{error}</p> : null}

      <div className="mt-6 flex gap-2.5">
        {manual ? (
          <button type="button" onClick={remove} disabled={saving} aria-label="삭제" className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-[#243055] text-[#F06A6A] disabled:opacity-50">
            <TrashIcon aria-hidden="true" className="size-5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => router.push(`/ledger/chat?attach=${tx.number}`)}
          className="flex h-[52px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border border-[#243055] bg-[#1A2342] text-[15px] font-semibold"
        >
          <SparklesIcon aria-hidden="true" className="size-4 text-[#4C7BF3]" /> AI에게
        </button>
        <button type="button" onClick={save} disabled={saving} className="h-[52px] flex-1 rounded-[14px] bg-[#4C7BF3] text-base font-bold text-white disabled:opacity-60">
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </BottomSheet>
  );
}
