"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { logout, refreshSession } from "./auth-actions";

export function SessionRefresh() {
  const router = useRouter();

  useEffect(() => {
    let refreshing = false;
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      try {
        const result = await refreshSession();
        if (active && !result.ok && result.unauthorized) {
          router.replace("/ledger/login");
          router.refresh();
        }
      } catch {
        // Retry when the app returns to the foreground after a network failure.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 24 * 60 * 60 * 1000);
    const onVisibility = () => void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onVisibility);
    };
  }, [router]);

  return null;
}

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await logout();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace("/ledger/login");
      router.refresh();
    } catch {
      setError("로그아웃하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <button type="button" disabled={pending} onClick={() => void handleLogout()} className="min-h-11 rounded-xl border border-[#273459] px-5 py-2 text-sm text-[#B4BFDA] hover:bg-[#1C2541] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#82A3FF] disabled:opacity-50">
        {pending ? "로그아웃 중…" : "로그아웃"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-[#FFB4AB]">{error}</p>}
    </div>
  );
}
