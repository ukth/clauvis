"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowTurnDownRightIcon, ArrowUpIcon, ArrowUturnLeftIcon, CheckCircleIcon,
  ClockIcon, MagnifyingGlassIcon, PaperClipIcon, ReceiptPercentIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import type { LedgerAgentAction } from "@/lib/agent";
import type { ChatAttachment, ChatItem } from "@/lib/ledger-chat";
import { listAttachable, sendLedgerChat, undoLedgerAction, type PickerFilter, type PickerItem } from "../../chat-actions";
import { BottomSheet } from "../../_components/tx-sheet";
import { kstDate, kstTime, won } from "../../_components/format";

type Message = ChatItem & { actions?: LedgerAgentAction[]; pending?: boolean; error?: boolean };

const SUGGESTIONS = ["어제 쓴 거 요약해줘", "계좌이체 추가할게", "분류 틀린 거 찾아줘"];

function AttachmentCard({ attachment, inverted }: { attachment: ChatAttachment; inverted?: boolean }) {
  const [merchant, ...rest] = attachment.label.split(" · ");
  const amount = rest.find((part) => /원$|[A-Z]{3}$/.test(part));
  const meta = rest.filter((part) => part !== amount).join(" · ");
  return (
    <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${inverted ? "bg-white/10" : "bg-[#1A2342]"}`}>
      <ReceiptPercentIcon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold">#{attachment.number} {merchant}</span>
        <span className="truncate text-[11px] opacity-70">{meta}</span>
      </div>
      {amount ? <span className="shrink-0 text-[13px] font-semibold tabular-nums">{amount}</span> : null}
    </div>
  );
}

function describe(action: LedgerAgentAction): { title: string; detail: string | null } {
  const head = `#${action.number} ${action.merchant}`;
  if (action.kind === "add") return { title: `${head} · 추가됨`, detail: null };
  if (action.kind === "delete") return { title: `${head} · 삭제됨`, detail: null };
  const { before, after } = action;
  const parts: string[] = [];
  if (before.excluded !== after.excluded) parts.push(after.excluded ? "합계에서 제외" : "합계에 다시 포함");
  if (before.category !== after.category) parts.push(`분류 ${before.category ?? "미분류"} → ${after.category ?? "미분류"}`);
  if (before.memo !== after.memo) parts.push(after.memo ? `메모: ${after.memo}` : "메모 삭제");
  return { title: `${head} · ${after.excluded && !before.excluded ? "제외됨" : "수정됨"}`, detail: parts.join(" · ") || null };
}

function ActionCard({ action }: { action: LedgerAgentAction }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const { title, detail } = describe(action);
  const undoable = action.kind !== "delete";

  const undo = async () => {
    setState("busy");
    setError(null);
    const result = await undoLedgerAction(action).catch(() => null);
    if (result?.ok) setState("done");
    else {
      setState("idle");
      setError(result?.error ?? "되돌리지 못했어요.");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-[#0A0F1E] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
          <CheckCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-[#3FB98A]" />
          <span className="truncate">{title}</span>
        </span>
        {action.amount != null ? (
          <span className={`shrink-0 text-[13px] tabular-nums text-[#8A93AD] ${action.kind === "edit" && action.after.excluded ? "line-through" : ""}`}>
            -{won(Math.abs(action.amount))}
          </span>
        ) : null}
      </div>
      {detail ? <p className="text-xs text-[#F2A93B]">{detail}</p> : null}
      {undoable ? (
        state === "done" ? (
          <p className="text-xs text-[#8A93AD]">되돌렸어요.</p>
        ) : (
          <button type="button" onClick={undo} disabled={state === "busy"} className="flex w-fit items-center gap-1 rounded-lg border border-[#243055] px-2.5 py-1.5 text-xs font-medium disabled:opacity-50">
            <ArrowUturnLeftIcon aria-hidden="true" className="size-3" /> 되돌리기
          </button>
        )
      ) : null}
      {error ? <p role="alert" className="text-xs text-[#F06A6A]">{error}</p> : null}
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className={`flex max-w-[82%] flex-col gap-2 rounded-2xl rounded-br-[4px] bg-[#4C7BF3] p-3 text-white ${message.pending ? "opacity-70" : ""}`}>
          {message.attachment ? <AttachmentCard attachment={message.attachment} inverted /> : null}
          <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className={`flex max-w-[88%] flex-col gap-2.5 rounded-2xl rounded-bl-[4px] p-3 ${message.error ? "bg-[#F06A6A]/10 text-[#F06A6A]" : "bg-[#121A30]"}`}>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
      {message.actions?.map((action, index) => <ActionCard key={index} action={action} />)}
    </div>
  );
}

function Picker({ onPick, onClose }: { onPick: (item: PickerItem) => void; onClose: () => void }) {
  const [filter, setFilter] = useState<PickerFilter>("recent");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PickerItem[] | null>(null);
  const [selected, setSelected] = useState<PickerItem | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      listAttachable(filter, query).then((rows) => active && setItems(rows)).catch(() => active && setItems([]));
    }, query ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filter, query]);

  const filters: { value: PickerFilter; label: string }[] = [
    { value: "recent", label: "최근" }, { value: "yesterday", label: "어제" },
    { value: "month", label: "이번 달" }, { value: "uncategorized", label: "분류 없음" },
  ];

  return (
    <BottomSheet onClose={onClose} label="거래 첨부">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">거래 첨부</h2>
          <button type="button" onClick={onClose} className="text-sm text-[#8A93AD]">닫기</button>
        </div>
        <label className="flex h-11 items-center gap-2 rounded-xl border border-[#243055] bg-[#0A0F1E] px-3.5">
          <MagnifyingGlassIcon aria-hidden="true" className="size-4 text-[#8A93AD]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="가맹점, 금액, #번호로 검색" className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#5B6584]" />
        </label>
        <div className="flex gap-2">
          {filters.map((f) => (
            <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
              className={`rounded-[14px] px-3 py-1.5 text-xs ${filter === f.value ? "bg-[#4C7BF3] font-semibold text-white" : "bg-[#1A2342]"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <ul className="max-h-[42dvh] overflow-y-auto rounded-[14px] bg-[#0A0F1E]">
          {items === null ? <li className="p-4 text-center text-sm text-[#8A93AD]">불러오는 중…</li> : null}
          {items?.length === 0 ? <li className="p-4 text-center text-sm text-[#8A93AD]">거래가 없어요.</li> : null}
          {items?.map((item, index) => {
            const on = selected?.number === item.number;
            return (
              <li key={item.number} className={index ? "border-t border-[#243055]" : ""}>
                <button type="button" onClick={() => setSelected(item)} aria-pressed={on} className={`flex w-full items-center gap-3 px-3.5 py-3 text-left ${on ? "bg-[#4C7BF3]/10" : ""}`}>
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${on ? "bg-[#4C7BF3]" : "border-2 border-[#243055]"}`}>
                    {on ? <CheckCircleIcon aria-hidden="true" className="size-4 text-white" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">#{item.number} {item.merchant}</span>
                    <span className="text-xs text-[#8A93AD]">{item.category ?? "미분류"} · {kstDate(item.occurredAt).slice(5).replace("-", "/")} {kstTime(item.occurredAt)}</span>
                  </span>
                  {item.amount != null ? <span className="shrink-0 text-sm font-semibold tabular-nums">-{won(Math.abs(item.amount))}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" disabled={!selected} onClick={() => selected && onPick(selected)} className="h-[52px] rounded-[14px] bg-[#4C7BF3] text-base font-bold text-white disabled:opacity-40">
          {selected ? `#${selected.number} 첨부하기` : "거래를 골라 주세요"}
        </button>
      </div>
    </BottomSheet>
  );
}

export function ChatView({ history, initialAttachment }: { history: ChatItem[]; initialAttachment: ChatAttachment | null }) {
  const [messages, setMessages] = useState<Message[]>(history);
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachment | null>(initialAttachment);
  const [openedFrom] = useState(initialAttachment?.number ?? null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const localSeq = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async (raw: string) => {
    const body = raw.trim();
    if (!body || sending) return;
    const attached = attachment;
    localSeq.current += 1;
    const localId = `local-${localSeq.current}`;
    setSending(true);
    setText("");
    setAttachment(null);
    setMessages((prev) => [...prev, { id: localId, role: "user", text: body, attachment: attached, createdAt: new Date().toISOString(), pending: true }]);
    const result = await sendLedgerChat({ text: body, attachNumber: attached?.number ?? null }).catch(() => null);
    setMessages((prev) => [
      ...prev.map((m) => (m.id === localId ? { ...m, pending: false } : m)),
      result?.ok
        ? { id: `${localId}-reply`, role: "assistant", text: result.reply, attachment: null, createdAt: new Date().toISOString(), actions: result.actions }
        : { id: `${localId}-error`, role: "assistant", text: result?.error ?? "답변을 받지 못했어요. 잠시 후 다시 시도해 주세요.", attachment: null, createdAt: new Date().toISOString(), error: true },
    ]);
    if (!result?.ok) {
      // Keep the draft so the user can retry without retyping
      setText(body);
      setAttachment(attached);
    }
    setSending(false);
  };

  return (
    <main className="flex min-h-[calc(100dvh-96px)] flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[#243055] bg-[#0A0F1E]/95 px-5 pb-3 pt-[max(16px,env(safe-area-inset-top))] backdrop-blur">
        <div>
          <h1 className="text-xl font-bold">Clauvis</h1>
          <p className="text-xs text-[#8A93AD]">텔레그램과 같은 대화 기록</p>
        </div>
        <ClockIcon aria-hidden="true" className="size-5 text-[#8A93AD]" />
      </header>

      <div className="flex flex-1 flex-col justify-end gap-3.5 px-4 py-5 pb-[190px]">
        {messages.length === 0 ? <p className="py-10 text-center text-sm text-[#8A93AD]">무엇이든 물어보세요. 예) 이번 달 배달 얼마 썼어?</p> : null}
        {messages.map((message) => <Bubble key={message.id} message={message} />)}
        {sending ? <p className="text-xs text-[#8A93AD]">답변을 쓰는 중…</p> : null}
        {openedFrom != null && !sending ? (
          <p className="flex items-center justify-center gap-1 self-center rounded-[10px] bg-[#1A2342] px-2.5 py-1 text-[11px] text-[#8A93AD]">
            <ArrowTurnDownRightIcon aria-hidden="true" className="size-3" /> 내역 #{openedFrom}에서 열림
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 px-4">
        <div className="mx-auto flex max-w-[448px] flex-col gap-2 bg-[#0A0F1E] pt-2">
          {attachment ? (
            <div className="flex items-center gap-2 rounded-[14px] border border-[#4C7BF3] bg-[#1A2342] p-1 pl-1">
              <div className="flex-1"><AttachmentCard attachment={attachment} /></div>
              <button type="button" aria-label="첨부 빼기" onClick={() => setAttachment(null)} className="mr-1.5 flex size-[26px] items-center justify-center rounded-full bg-[#243055]">
                <XMarkIcon className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={sending} onClick={() => send(s)} className="shrink-0 rounded-[14px] border border-[#243055] bg-[#121A30] px-2.5 py-1.5 text-xs disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(event) => { event.preventDefault(); void send(text); }} className={`flex h-[50px] items-center gap-2.5 rounded-[25px] border bg-[#121A30] pl-4 pr-1.5 ${text ? "border-[#4C7BF3]" : "border-[#243055]"}`}>
            <button type="button" aria-label="거래 첨부" onClick={() => setPicking(true)} className="text-[#8A93AD]">
              <PaperClipIcon className="size-[18px]" />
            </button>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
              placeholder={attachment ? "이 거래에 대해 말해 주세요" : "메시지 · 예) 엄마한테 30만원 이체함"}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#5B6584]"
              enterKeyHint="send"
            />
            <button type="submit" aria-label="보내기" disabled={!text.trim() || sending} className="flex size-[38px] items-center justify-center rounded-full bg-[#4C7BF3] text-white disabled:bg-[#1A2342] disabled:text-[#8A93AD]">
              <ArrowUpIcon className="size-[18px]" />
            </button>
          </form>
        </div>
      </div>

      {picking ? (
        <Picker onClose={() => setPicking(false)} onPick={(item) => { setAttachment({ number: item.number, label: item.label }); setPicking(false); }} />
      ) : null}
    </main>
  );
}
