import { ArrowPathIcon, EnvelopeIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { getLedgerSettings } from "@/lib/ledger-web";
import { summarizeUserAgent } from "@/lib/ledger-auth";
import { requestTime, requirePageSession } from "../../_components/session";
import { relativeTime } from "../../_components/format";
import { AccountActions, DeviceList } from "./settings-client";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-[#8A93AD]">{title}</h2>
      <div className="divide-y divide-[#243055] overflow-hidden rounded-2xl bg-[#121A30]">{children}</div>
    </section>
  );
}

function Row({ icon, title, sub, right, iconClass = "text-[#8A93AD]" }: { icon: React.ReactNode; title: string; sub?: string; right?: string; iconClass?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className={iconClass}>{icon}</span>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {sub ? <span className="text-xs text-[#8A93AD]">{sub}</span> : null}
      </div>
      {right ? <span className="text-xs text-[#8A93AD]">{right}</span> : null}
    </div>
  );
}

export default async function SettingsPage() {
  const session = await requirePageSession();
  const settings = await getLedgerSettings(session.userId);
  const now = requestTime();
  const fresh = settings.lastSyncedAt != null && now - Date.parse(settings.lastSyncedAt) < 48 * 3_600_000;

  return (
    <main className="flex flex-col gap-6 px-5 pt-[max(16px,env(safe-area-inset-top))]">
      <h1 className="pt-2 text-[28px] font-bold">설정</h1>
      <Group title="동기화">
        <Row icon={<ArrowPathIcon className="size-[18px]" />} iconClass={fresh ? "text-[#3FB98A]" : "text-[#F2A93B]"}
          title="카드 문자 · 쿠팡 주문 메일" sub="맥에서 Claude 세션을 열 때 1시간마다" right={relativeTime(settings.lastSyncedAt, now)} />
        <Row icon={<EnvelopeIcon className="size-[18px]" />} title="쿠팡 품목 연결" sub="같은 금액·시각의 카드 결제에 자동으로 붙음" />
        <Row icon={<SparklesIcon className="size-[18px]" />} title="AI 자동 분류" sub="Haiku · 직접 고친 분류는 유지"
          right={settings.aiClassificationAvailable ? "켜짐" : "API 키 필요"} />
      </Group>
      <Group title="로그인된 기기">
        <DeviceList sessions={settings.sessions.map((s) => ({
          id: s.id,
          device: s.userAgent ? summarizeUserAgent(s.userAgent) : "알 수 없는 기기",
          lastSeen: relativeTime(s.lastSeenAt, now),
          createdAt: s.createdAt.slice(0, 10),
          current: s.current,
        }))} />
      </Group>
      <Group title="계정">
        <AccountActions />
      </Group>
    </main>
  );
}
