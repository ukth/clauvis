import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { chatMessages, transactions, type CategorySource } from "./db/schema";
import type { LedgerAgentAction, LedgerTxState } from "./agent";
import { deleteManualTransaction, formatWon, isCategory, kstDateString, kstTimeString, MANUAL_CARD_ORG, type Transaction } from "./ledger";

// Web chat helpers: the chat shares chat_messages with the Telegram bot. An attached transaction
// travels as a first-line tag so both the agent and a later history render can see it.

const ATTACH_TAG = /^\[첨부 #(\d+) ([^\]\n]{1,200})\]\n?/;

export type ChatAttachment = { number: number; label: string };
export type ChatItem = { id: string; role: "user" | "assistant"; text: string; attachment: ChatAttachment | null; createdAt: string };

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

// --- Undo ---

const SOURCES = new Set(["rule", "ai", "user"]);

function validState(state: LedgerTxState): boolean {
  return (state.category === null || isCategory(state.category))
    && (state.categorySource === null || SOURCES.has(state.categorySource))
    && (state.memo === null || (typeof state.memo === "string" && state.memo.length <= 1000))
    && typeof state.excluded === "boolean"
    && (state.excludeReason === null || (typeof state.excludeReason === "string" && state.excludeReason.length <= 200));
}

export type UndoResult = { ok: true } | { ok: false; error: string };

/**
 * Revert an agent change. Edits are restored only if the row still looks exactly like the agent
 * left it (single conditional UPDATE), so a later manual edit is never silently overwritten.
 */
export async function undoAgentAction(userId: string, action: LedgerAgentAction): Promise<UndoResult> {
  if (!action || !Number.isSafeInteger(action.number) || action.number <= 0) return { ok: false, error: "잘못된 요청이에요." };

  if (action.kind === "add") {
    const tx = await findUserTransaction(userId, action.number);
    if (!tx || tx.cardOrg !== MANUAL_CARD_ORG) return { ok: false, error: "이미 지워졌거나 되돌릴 수 없는 내역이에요." };
    const result = await deleteManualTransaction(userId, action.number);
    return result.ok ? { ok: true } : { ok: false, error: "되돌리지 못했어요." };
  }
  if (action.kind !== "edit") return { ok: false, error: "삭제한 내역은 되돌릴 수 없어요. 다시 추가해 주세요." };
  if (!validState(action.before) || !validState(action.after)) return { ok: false, error: "잘못된 요청이에요." };

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
