import { redirect } from "next/navigation";
import { getLedgerSession } from "@/lib/ledger-auth";
import { formatWon, kstMonthString, summarizeMonth } from "@/lib/ledger";
import { LogoutButton, SessionRefresh } from "./session-refresh";

export default async function LedgerPage() {
  const session = await getLedgerSession();
  if (!session) redirect("/ledger/login");

  const month = kstMonthString();
  const summary = await summarizeMonth(session.userId, month);

  return (
    <main className="mx-auto max-w-lg px-6 pb-12 pt-[max(48px,env(safe-area-inset-top))]">
      <SessionRefresh />
      <p className="text-sm font-medium text-[#4C7BF3]">Clauvis 가계부</p>
      <h1 className="mt-3 text-2xl font-bold">{session.name}님, 안녕하세요</h1>
      <section aria-label="이번 달 사용 내역" className="my-8 rounded-2xl border border-[#273459] bg-[#121A30] p-6">
        <h2 className="text-sm text-[#929BB5]">{month.replace("-", "년 ")}월 사용 금액</h2>
        <p className="mt-3 text-3xl font-bold tabular-nums">{formatWon(summary.total)}</p>
        <p className="mt-2 text-sm text-[#929BB5]">총 {summary.count.toLocaleString("ko-KR")}건</p>
      </section>
      <p className="mb-6 text-sm leading-6 text-[#929BB5]">가계부가 연결되었어요. 상세 화면은 준비 중이에요.</p>
      <LogoutButton />
    </main>
  );
}
