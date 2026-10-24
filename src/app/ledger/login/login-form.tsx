"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, PaperAirplaneIcon, WalletIcon } from "@heroicons/react/24/outline";
import { createLoginRequest, pollLoginRequest } from "../auth-actions";

type LoginRequest = { pairCode: string; expiresAt: string };

export function LoginForm() {
  const router = useRouter();
  const [request, setRequest] = useState<LoginRequest | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [creating, setCreating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const creatingRef = useRef(false);

  const createRequest = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(null);
    setRequest(null);
    try {
      const result = await createLoginRequest();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRequest({ pairCode: result.pairCode, expiresAt: result.expiresAt });
      setRemaining(Math.max(0, Math.ceil((Date.parse(result.expiresAt) - Date.now()) / 1000)));
    } catch {
      setError("연결하지 못했어요. 잠시 후 새 코드를 받아 주세요.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void createRequest(), 0);
    return () => window.clearTimeout(timer);
  }, [createRequest]);

  useEffect(() => {
    if (!request) return;
    let active = true;
    let polling = false;
    let expired = false;
    const expiresAt = Date.parse(request.expiresAt);

    const updateRemaining = () => {
      const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(expired ? 0 : seconds);
      return seconds;
    };

    const poll = async () => {
      if (!active || document.visibilityState !== "visible" || polling || expired) return;
      if (updateRemaining() === 0) return;
      polling = true;
      try {
        const result = await pollLoginRequest();
        if (!active) return;
        if (!result.ok) {
          setError(result.error);
        } else if (result.status === "authenticated") {
          active = false;
          router.replace("/ledger");
          router.refresh();
        } else if (result.status === "expired") {
          expired = true;
          setRemaining(0);
          setError(null);
        } else {
          setError(null);
        }
      } catch {
        if (active) setError("연결을 확인하고 있어요. 잠시 후 자동으로 다시 시도해요.");
      } finally {
        polling = false;
      }
    };

    const tick = window.setInterval(updateRemaining, 1000);
    const timer = window.setInterval(() => void poll(), 2500);
    const onVisibility = () => void poll();
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      active = false;
      window.clearInterval(tick);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [request, router]);

  const ready = request !== null && remaining > 0 && !creating;
  const code = request?.pairCode;
  const timer = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[438px] flex-col px-6 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(72px,env(safe-area-inset-top))] sm:justify-center sm:py-16">
      <header className="text-center">
        <div className="mx-auto flex size-[74px] items-center justify-center rounded-[20px] border border-[#273459] bg-[#1C2541] text-[#4C7BF3]">
          <WalletIcon aria-hidden="true" className="size-8" strokeWidth={2} />
        </div>
        <h1 className="mt-4 text-[26px] font-bold tracking-tight">Clauvis 가계부</h1>
        <p className="mt-3 text-sm leading-6 text-[#929BB5]">텔레그램으로 본인 확인 후 로그인합니다</p>
      </header>

      <section aria-label="로그인 코드" className="mt-8 rounded-[22px] border border-[#273459] bg-[#121A30] px-4 py-6 text-center">
        <h2 className="text-sm font-normal text-[#929BB5]">이 기기의 로그인 코드</h2>
        <p aria-label={code ? `로그인 코드 ${code.split("").join(" ")}` : "코드 준비 중"} className="my-4 whitespace-pre text-[46px] font-bold leading-[1.3] tracking-[0.12em] tabular-nums">
          {code ? `${code.slice(0, 3)} ${code.slice(3)}` : "··· ···"}
        </p>
        <p className="flex items-center justify-center gap-2 text-sm text-[#929BB5]">
          <ClockIcon aria-hidden="true" className="size-4" />
          {creating ? "코드를 준비하고 있어요" : ready ? `${timer} 후 만료` : "코드가 만료되었어요"}
        </p>
      </section>

      <a
        href={ready ? `https://t.me/clauvis_ai_bot?start=web_${code}` : undefined}
        aria-disabled={!ready}
        tabIndex={ready ? 0 : -1}
        className="mt-8 flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-[#4C7BF3] px-4 py-4 text-base font-bold text-white transition-colors hover:bg-[#5C88FF] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#82A3FF] aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <PaperAirplaneIcon aria-hidden="true" className="size-6 -rotate-45" />
        텔레그램에서 승인하기
      </a>

      <p role="status" className="mt-8 flex items-center justify-center gap-2 text-center text-[13px] leading-6 text-[#929BB5]">
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${ready ? "bg-[#F7AF34]" : "bg-[#929BB5]"}`} />
        {creating ? "안전한 로그인을 준비하고 있어요" : ready ? "승인 기다리는 중 · 승인되면 자동으로 열려요" : "새 코드를 받아 다시 승인해 주세요"}
      </p>
      {error && <p role="alert" className="mt-3 text-center text-sm leading-6 text-[#FFB4AB]">{error}</p>}

      <aside className="mt-8 rounded-2xl bg-[#1C2541] p-4">
        <h2 className="text-sm font-semibold">버튼이 안 열리면</h2>
        <p className="mt-2 text-[13px] leading-6 text-[#929BB5]">
          텔레그램 Clauvis 봇에 <code className="font-sans select-all">/web {code ?? "••••••"}</code> 을 보내세요
        </p>
      </aside>

      <button type="button" disabled={creating || ready} onClick={() => void createRequest()} className="mx-auto mt-6 min-h-11 rounded-lg px-5 text-sm font-medium text-[#4C7BF3] hover:text-[#82A3FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#82A3FF] disabled:opacity-50">
        {creating ? "코드 준비 중…" : "새 코드 받기"}
      </button>
    </main>
  );
}
