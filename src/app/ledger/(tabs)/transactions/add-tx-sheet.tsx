"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Category, ManualMethod } from "@/lib/ledger";
import { addLedgerManualTransaction } from "../../transaction-actions";
import { BottomSheet } from "../../_components/tx-sheet";
import { CATEGORY_LIST } from "../../_components/format";

const METHODS: { value: ManualMethod; label: string }[] = [
  { value: "transfer", label: "계좌이체" },
  { value: "cash", label: "현금" },
  { value: "card", label: "카드" },
  { value: "other", label: "기타" },
];

function nowLocalInput(): string {
  const kst = new Date(Date.now() + 9 * 3_600_000);
  return kst.toISOString().slice(0, 16);
}

export function AddTxSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [method, setMethod] = useState<ManualMethod>("transfer");
  const [when, setWhen] = useState(nowLocalInput);
  const [category, setCategory] = useState<Category | null>(null);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(amount.replace(/[,\s원]/g, ""));
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError("금액을 숫자로 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await addLedgerManualTransaction({
      amount: value,
      merchant: merchant.trim(),
      method,
      occurredAt: `${when}:00+09:00`,
      category: category ?? undefined,
      memo: memo.trim() || null,
    }).catch(() => null);
    setSaving(false);
    if (!result?.ok) {
      setError(result?.error ?? "추가하지 못했어요.");
      return;
    }
    router.refresh();
    onClose();
  };

  const field = "h-[46px] w-full rounded-xl border border-[#243055] bg-[#0A0F1E] px-3.5 text-sm outline-none placeholder:text-[#5B6584] focus:border-[#4C7BF3]";

  return (
    <BottomSheet onClose={onClose} label="내역 직접 추가">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">직접 추가</h2>
        <input className={field} inputMode="numeric" placeholder="금액 (원)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <input className={field} placeholder="내용 · 예) 엄마 용돈, 붕어빵" value={merchant} maxLength={200} onChange={(e) => setMerchant(e.target.value)} required />
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map((m) => (
            <button key={m.value} type="button" aria-pressed={method === m.value} onClick={() => setMethod(m.value)}
              className={`h-[38px] rounded-[10px] text-[13px] ${method === m.value ? "bg-[#4C7BF3] font-bold text-white" : "border border-[#243055] bg-[#1A2342]"}`}>
              {m.label}
            </button>
          ))}
        </div>
        <input className={field} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="일시" required />
        <div className="grid grid-cols-4 gap-2">
          {CATEGORY_LIST.map((c) => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}
              className={`h-[34px] rounded-[10px] text-[12px] ${category === c ? "bg-[#4C7BF3] font-bold text-white" : "border border-[#243055] bg-[#1A2342]"}`}>
              {c}
            </button>
          ))}
        </div>
        <input className={field} placeholder="메모 (선택)" value={memo} maxLength={1000} onChange={(e) => setMemo(e.target.value)} />
        {error ? <p role="alert" className="text-sm text-[#F06A6A]">{error}</p> : null}
        <button type="submit" disabled={saving} className="h-[52px] rounded-[14px] bg-[#4C7BF3] text-base font-bold text-white disabled:opacity-60">
          {saving ? "추가 중…" : "추가"}
        </button>
      </form>
    </BottomSheet>
  );
}
