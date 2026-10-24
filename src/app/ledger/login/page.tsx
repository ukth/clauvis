import { redirect } from "next/navigation";
import { getLedgerSession } from "@/lib/ledger-auth";
import { LoginForm } from "./login-form";

export default async function LedgerLoginPage() {
  if (await getLedgerSession()) redirect("/ledger");
  return <LoginForm />;
}
