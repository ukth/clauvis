import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { chatMessages, transactions, type CategorySource } from "./db/schema";
import { LEDGER_RECEIPT, type LedgerAgentAction, type LedgerReceipt, type LedgerTxState } from "./agent";
import { deleteManualTransaction, formatWon, kstDateString, kstTimeString, MANUAL_CARD_ORG, type Transaction } from "./ledger";

// Web chat helpers: the chat shares chat_messages with the Telegram bot. An attached transaction
// travels as a first-line tag so both the agent and a later history render can see it.

const ATTACH_TAG = /^\[첨부 #(\d+) ([^\]\n]{1,200})\]\n?/;

export type ChatAttachment = { number: number; label: string };
export type ChatItem = { id: string; role: "user" | "assistant"; text: string; attachment: ChatAttachment | null; createdAt: string; actions?: ChatActionCard[] };

/** "쿠팡 · -3,700원 · KB 쿠팡와우 · 10/24 14:59" */
export function attachmentLabel(tx: Transaction): string {
  const amount = tx.amount == null ? `${tx.originalAmount ?? "?"} ${tx.currency}` : `${tx.status === "cancelled" ? "+" : "-"}${formatWon(Math.abs(tx.amount))}`;
  const when = `${kstDateString(tx.occurredAt).slice(5).replace("-", "/")} ${kstTimeString(tx.occurredAt)}`;
  // "]" would end the tag early, so it never appears inside the label
  return [tx.merchant, amount, tx.cardName || tx.cardOrg, when].join(" · ").replace(/[\]\n]/g, " ");
}

export function withAttachment(text: string, tx: Transaction | null): string {
  return tx ? `[첨부 #${tx.number} ${attachmentLabel(tx)}]\n${text}` : text;
}

export function parseAttachment(text: string): { text: string; attachment: ChatAttachment | null } {
  const match = ATTACH_TAG.exec(text);
  if (!match) return { text, attachment: null };
  return { text: text.slice(match[0].length), attachment: { number: Number(match[1]), label: match[2] } };
}

type Block = { type: string; text?: string };

/** Readable text of a stored message; tool calls and tool results are hidden. */
function displayText(content: string, contentJson: string | null): string | null {
  if (!contentJson) return content;
  try {
    const parsed: unknown = JSON.parse(contentJson);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed)) {
      const blocks = parsed as Block[];
      if (blocks.some((b) => b.type === "tool_result")) return null;
      const text = blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n").trim();
      return text || null;
    }
  } catch {
    // Fall back to the plain content column
  }
  return content;
}

export async function loadChatHistory(userId: string, limit = 40): Promise<ChatItem[]> {
  const rows = await db
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, contentJson: chatMessages.contentJson, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit * 2);

  const items: ChatItem[] = [];
  for (const row of rows.reverse()) {
    if (row.content === LEDGER_RECEIPT) {
      const receipt = parseReceipt(row.contentJson);
      if (!receipt) continue;
      const card = toActionCard(row.id, receipt.action, receipt.undone);
      // Receipts follow the reply that produced them; show them as cards under it
      const last = items[items.length - 1];
      if (last?.role === "assistant") last.actions = [...(last.actions ?? []), card];
      else items.push({ id: row.id, role: "assistant", text: "", attachment: null, createdAt: row.createdAt.toISOString(), actions: [card] });
      continue;
    }
    const raw = displayText(row.content, row.contentJson);
    if (!raw) continue;
    const { text, attachment } = row.role === "user" ? parseAttachment(raw) : { text: raw, attachment: null };
    items.push({ id: row.id, role: row.role, text, attachment, createdAt: row.createdAt.toISOString() });
  }
  return items.slice(-limit);
}

export async function findUserTransaction(userId: string, number: number): Promise<Transaction | null> {
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const [row] = await db.select().from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.number, number))).limit(1);
  return row ?? null;
}

// --- Receipts & undo ---

/** What the client sees of a receipt (no stored row snapshot). */
export type ChatActionCard = {
  receiptId: string;
  undone: boolean;
  kind: LedgerAgentAction["kind"];
  number: number;
  merchant: string;
  amount: number | null;
  before: LedgerTxState | null;
  after: LedgerTxState | null;
};

export function toActionCard(receiptId: string, action: LedgerAgentAction, undone: boolean): ChatActionCard {
  return {
    receiptId,
    undone,
    kind: action.kind,
    number: action.number,
    merchant: action.merchant,
    amount: action.amount,
    before: action.kind === "edit" ? action.before : null,
    after: action.kind === "edit" ? action.after : null,
  };
}

function parseReceipt(contentJson: string | null): LedgerReceipt | null {
  if (!contentJson) return null;
  try {
    const parsed = JSON.parse(contentJson) as LedgerReceipt;
    return parsed?.kind === "ledger-receipt-v1" && parsed.action ? parsed : null;
  } catch {
    return null;
  }
}

export type UndoResult = { ok: true } | { ok: false; error: string };

async function revertAction(userId: string, action: LedgerAgentAction): Promise<UndoResult> {
  if (action.kind === "add") {
    const tx = await findUserTransaction(userId, action.number);
    if (!tx || tx.cardOrg !== MANUAL_CARD_ORG) return { ok: false, error: "이미 지워졌거나 되돌릴 수 없는 내역이에요." };
    const result = await deleteManualTransaction(userId, action.number);
    return result.ok ? { ok: true } : { ok: false, error: "되돌리지 못했어요." };
  }

  if (action.kind === "delete") {
    const snap = action.snapshot;
    if (snap.userId !== userId || snap.cardOrg !== MANUAL_CARD_ORG) return { ok: false, error: "되돌릴 수 없는 내역이에요." };
    // JSON turned the timestamps into strings; the same #number and externalId come back
    const inserted = await db
      .insert(transactions)
      .values({
        ...snap,
        occurredAt: new Date(snap.occurredAt),
        createdAt: new Date(snap.createdAt),
        updatedAt: new Date(),
        excludedAt: snap.excludedAt ? new Date(snap.excludedAt) : null,
      })
      .onConflictDoNothing()
      .returning({ number: transactions.number });
    return inserted.length === 1 ? { ok: true } : { ok: false, error: "같은 번호의 내역이 이미 있어서 되살리지 못했어요." };
  }

  // Edits are restored only if the row still looks exactly like the agent left it, so a later
  // manual edit is never silently overwritten (single conditional UPDATE).
  const { before, after } = action;
  const restored = await db
    .update(transactions)
    .set({
      category: before.category,
      categorySource: before.categorySource as CategorySource | null,
      memo: before.memo,
      excludedAt: before.excluded ? sql`coalesce(${transactions.excludedAt}, now())` : null,
      excludeReason: before.excludeReason,
      updatedAt: new Date(),
    })
    .where(and(
      eq(transactions.userId, userId),
      eq(transactions.number, action.number),
      sql`${transactions.category} is not distinct from ${after.category}`,
      sql`${transactions.categorySource} is not distinct from ${after.categorySource}`,
      sql`${transactions.memo} is not distinct from ${after.memo}`,
      sql`${transactions.excludeReason} is not distinct from ${after.excludeReason}`,
      after.excluded ? sql`${transactions.excludedAt} is not null` : sql`${transactions.excludedAt} is null`,
    ))
    .returning({ number: transactions.number });
  return restored.length === 1 ? { ok: true } : { ok: false, error: "그 사이 내용이 바뀌어서 되돌리지 않았어요." };
}

/**
 * Undo by receipt id. The change to revert is read from the stored receipt (never from the client),
 * and the receipt is claimed first so the same change cannot be undone twice.
 */
export async function undoReceipt(userId: string, receiptId: string): Promise<UndoResult> {
  if (!/^[0-9a-f-]{36}$/i.test(receiptId)) return { ok: false, error: "잘못된 요청이에요." };
  const receiptWhere = and(eq(chatMessages.id, receiptId), eq(chatMessages.userId, userId), eq(chatMessages.content, LEDGER_RECEIPT));
  const [claimed] = await db
    .update(chatMessages)
    .set({ contentJson: sql`jsonb_set(${chatMessages.contentJson}::jsonb, '{undone}', 'true'::jsonb)::text` })
    .where(and(receiptWhere, sql`(${chatMessages.contentJson}::jsonb ->> 'undone') = 'false'`))
    .returning({ contentJson: chatMessages.contentJson });
  const receipt = parseReceipt(claimed?.contentJson ?? null);
  if (!receipt) return { ok: false, error: "이미 되돌렸거나 찾을 수 없는 작업이에요." };

  const result = await revertAction(userId, receipt.action).catch((): UndoResult => ({ ok: false, error: "되돌리지 못했어요." }));
  if (!result.ok) {
    await db
      .update(chatMessages)
      .set({ contentJson: sql`jsonb_set(${chatMessages.contentJson}::jsonb, '{undone}', 'false'::jsonb)::text` })
      .where(receiptWhere);
    return result;
  }
  // Tell the agent (shared history) that the change was reverted; the undo itself already succeeded
  await db.insert(chatMessages).values({
    userId,
    role: "assistant",
    content: `가계부 #${receipt.action.number} ${receipt.action.merchant}: 방금 작업을 되돌렸어요.`,
  }).catch((error) => console.error("[LEDGER] undo note failed:", error));
  return { ok: true };
}
