import "server-only";

import { redirect } from "next/navigation";
import { getLedgerSession, type LedgerSession } from "@/lib/ledger-auth";

/** Request time for server-rendered relative labels ("12분 전"). Pages render once per request. */
export function requestTime(): number {
  return Date.now();
}

/** For ledger pages: the signed-in session, or a redirect to the login screen. */
export async function requirePageSession(): Promise<LedgerSession> {
  const session = await getLedgerSession();
  if (!session) redirect("/ledger/login");
  return session;
}
