"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightStartOnRectangleIcon, ComputerDesktopIcon, DevicePhoneMobileIcon, ShieldExclamationIcon } from "@heroicons/react/24/outline";
import { logout, logoutAllSessions, logoutSession } from "../../auth-actions";

type Device = { id: string; device: string; lastSeen: string; createdAt: string; current: boolean };

export function DeviceList({ sessions }: { sessions: Device[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const signOut = async (device: Device) => {
    if (!window.confirm(`${device.device}에서 로그아웃할까요?`)) return;
    setBusy(device.id);
    const result = await logoutSession(device.id).catch(() => null);
    setBusy(null);
    if (!result?.ok) {
      setError(result?.error ?? "로그아웃하지 못했어요.");
      return;
    }
    router.refresh();
  };

  return (
    <>
      {sessions.map((device) => {
        const Icon = /iPhone|iPad|Android/.test(device.device) ? DevicePhoneMobileIcon : ComputerDesktopIcon;
        return (
          <div key={device.id} className="flex items-center gap-3 px-4 py-3.5">
            <Icon aria-hidden="true" className="size-[18px] text-[#8A93AD]" />
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">{device.device}</span>
              <span className="text-xs text-[#8A93AD]">
                {device.current ? `이 기기 · ${device.createdAt} 로그인` : `마지막 사용 ${device.lastSeen}`}
              </span>
            </div>
            {device.current ? (
              <span className="text-xs text-[#4C7BF3]">현재</span>
            ) : (
              <button type="button" disabled={busy === device.id} onClick={() => signOut(device)} className="text-xs text-[#8A93AD] underline-offset-2 hover:underline disabled:opacity-50">
                로그아웃
              </button>
            )}
          </div>
        );
      })}
      {error ? <p role="alert" className="px-4 py-3 text-sm text-[#F06A6A]">{error}</p> : null}
    </>
  );
}

export function AccountActions() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const leave = () => {
    router.replace("/ledger/login");
    router.refresh();
  };

  const signOutHere = async () => {
    const result = await logout().catch(() => null);
    if (!result?.ok) return setError(result?.error ?? "로그아웃하지 못했어요.");
    leave();
  };

  const signOutAll = async () => {
    if (!window.confirm("모든 기기에서 로그아웃할까요? 이 기기도 다시 로그인해야 해요.")) return;
    const result = await logoutAllSessions().catch(() => null);
    if (!result?.ok) return setError(result?.error ?? "로그아웃하지 못했어요.");
    leave();
  };

  return (
    <>
      <button type="button" onClick={signOutHere} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <ArrowRightStartOnRectangleIcon aria-hidden="true" className="size-[18px] text-[#8A93AD]" />
        <span className="text-sm font-medium">이 기기 로그아웃</span>
      </button>
      <button type="button" onClick={signOutAll} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <ShieldExclamationIcon aria-hidden="true" className="size-[18px] text-[#F06A6A]" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-[#F06A6A]">모든 기기 로그아웃</span>
          <span className="text-xs text-[#8A93AD]">텔레그램 /logout_all 과 같음</span>
        </span>
      </button>
      {error ? <p role="alert" className="px-4 py-3 text-sm text-[#F06A6A]">{error}</p> : null}
    </>
  );
}
