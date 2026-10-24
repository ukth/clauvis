"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { runAgentDetailed, type LedgerAgentAction } from "@/lib/agent";
import { getLedgerSession } from "@/lib/ledger-auth";
import { attachmentLabel, findUserTransaction, undoAgentAction, withAttachment, type ChatAttachment } from "@/lib/ledger-chat";
import { kstMonthRange, kstMonthString, kstYesterdayRange } from "@/lib/ledger";

const MAX_MESSAGE = 2000;

export type SendChatResult =
  | { ok: true; reply: string; actions: LedgerAgentAction[]; attachment: ChatAttachment | null }
  | { ok: false; error: string; needsKey?: boolean };

export async function sendLedgerChat(input: { text: string; attachNumber?: number | null }): Promise<SendChatResult> {
  const session = await getLedgerSession();
  if (!session) return { ok: false, error: "로그인이 필요해요." };
  const text = typeof input?.text === "string" ? input.text.trim() : "";
  if (!text) return { ok: false, error: "메시지를 입력해 주세요." };
  if (text.length > MAX_MESSAGE) return { ok: false, error: `메시지는 ${MAX_MESSAGE.toLocaleString("ko-KR")}자까지 보낼 수 있어요.` };

  const [user] = await db.select({ key: users.encryptedAnthropicKey, model: users.model }).from(users).where(eq(users.id, session.userId));
  if (!user?.key) {
    return { ok: false, needsKey: true, error: "AI 비서를 쓰려면 텔레그램에서 /setkey sk-ant-... 로 Claude API 키를 등록해 주세요." };
  }

  const tx = input.attachNumber ? await findUserTransaction(session.userId, Number(input.attachNumber)) : null;
  if (input.attachNumber && !tx) return { ok: false, error: "첨부한 거래를 찾을 수 없어요." };

  try {
    const { reply, actions } = await runAgentDetailed(withAttachment(text, tx), session.userId, decrypt(user.key), user.model);
    if (actions.length) revalidatePath("/ledger", "layout");
    return { ok: true, reply, actions, attachment: tx ? { number: tx.number, label: attachmentLabel(tx) } : null };
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : undefined;
    if (status === 401) return { ok: false, needsKey: true, error: "등록된 Claude API 키가 유효하지 않아요. 텔레그램에서 /setkey 로 다시 등록해 주세요." };
    return { ok: false, error: "답변을 받지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
}

export async function undoLedgerAction(action: LedgerAgentAction): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getLedgerSession();
  if (!session) return { ok: false, error: "로그인이 필요해요." };
  try {
    const result = await undoAgentAction(session.userId, action);
    if (result.ok) revalidatePath("/ledger", "layout");
    return result;
  } catch {
    return { ok: false, error: "되돌리지 못했어요." };
  }
}

export type PickerFilter = "recent" | "yesterday" | "month" | "uncategorized";
export type PickerItem = { number: number; merchant: string; category: string | null; occurredAt: string; amount: number | null; label: string };

/** Transactions for the 📎 picker (most recent first). */
export async function listAttachable(filter: PickerFilter, query: string): Promise<PickerItem[]> {
  const session = await getLedgerSession();
  if (!session) return [];
  const conditions = [eq(transactions.userId, session.userId)];
  if (filter === "yesterday") {
    const range = kstYesterdayRange();
    conditions.push(gte(transactions.occurredAt, range.start), lt(transactions.occurredAt, range.end));
  } else if (filter === "month") {
    const range = kstMonthRange(kstMonthString());
    conditions.push(gte(transactions.occurredAt, range.start), lt(transactions.occurredAt, range.end));
  } else if (filter === "uncategorized") {
    conditions.push(isNull(transactions.category));
  }
  const rows = await db.select().from(transactions).where(and(...conditions))
    .orderBy(desc(transactions.occurredAt), desc(transactions.number)).limit(query ? 300 : 40);

  const q = typeof query === "string" ? query.trim().toLowerCase().slice(0, 100) : "";
  const digits = q.replace(/[,\s원#]/g, "");
  const matched = q
    ? rows.filter((row) => row.merchant.toLowerCase().includes(q)
      || (/^\d+$/.test(digits) && (row.number === Number(digits) || row.amount === Number(digits))))
    : rows;
  return matched.slice(0, 40).map((row) => ({
    number: row.number,
    merchant: row.merchant,
    category: row.category,
    occurredAt: row.occurredAt.toISOString(),
    amount: row.amount,
    label: attachmentLabel(row),
  }));
}
