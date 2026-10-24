"use server";

import { revalidatePath } from "next/cache";
import { getLedgerSession } from "@/lib/ledger-auth";
import {
  addManualTransaction, deleteManualTransaction, isCategory, parseIsoWithOffset,
  updateTransactionMemo, type Category, type ManualMethod,
} from "@/lib/ledger";

export type LedgerMutationResult =
  | { ok: true; number: number }
  | { ok: false; code: "unauthorized" | "invalid_input" | "not_found" | "not_manual" | "duplicate" | "failed"; error: string };

export interface UpdateLedgerTransactionInput {
  number: number;
  category?: Category;
  memo?: string | null;
  excluded?: boolean;
  excludeReason?: string | null;
}

export interface AddLedgerManualTransactionInput {
  amount: number;
  merchant: string;
  method?: ManualMethod;
  occurredAt?: string;
  category?: Category;
  memo?: string | null;
}

function invalid(error: string): LedgerMutationResult {
  return { ok: false, code: "invalid_input", error };
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}

function validText(value: unknown, limit: number): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === "string" && value.length <= limit);
}

export async function updateLedgerTransaction(input: UpdateLedgerTransactionInput): Promise<LedgerMutationResult> {
  try {
    const session = await getLedgerSession();
    if (!session) return { ok: false, code: "unauthorized", error: "로그인이 필요합니다." };
    if (!input || typeof input !== "object" || !validNumber(input.number)) {
      return invalid("거래 번호가 올바르지 않습니다.");
    }
    if (input.category !== undefined && (typeof input.category !== "string" || !isCategory(input.category))) {
      return invalid("올바른 카테고리를 선택해 주세요.");
    }
    if (!validText(input.memo, 2000) || !validText(input.excludeReason, 500)
      || (input.excluded !== undefined && typeof input.excluded !== "boolean")) {
      return invalid("메모는 2,000자, 제외 사유는 500자 이내로 입력해 주세요.");
    }
    if (input.category === undefined && input.memo === undefined && input.excluded === undefined) {
      return invalid("변경할 항목이 없습니다.");
    }
    const row = await updateTransactionMemo(session.userId, input.number, {
      category: input.category,
      memo: input.memo,
      excluded: input.excluded,
      excludeReason: input.excludeReason,
    });
    if (!row) return { ok: false, code: "not_found", error: "거래를 찾을 수 없습니다." };
    revalidatePath("/ledger", "layout");
    return { ok: true, number: row.number };
  } catch {
    return { ok: false, code: "failed", error: "거래를 수정하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function addLedgerManualTransaction(input: AddLedgerManualTransactionInput): Promise<LedgerMutationResult> {
  try {
    const session = await getLedgerSession();
    if (!session) return { ok: false, code: "unauthorized", error: "로그인이 필요합니다." };
    if (!input || typeof input !== "object" || !validNumber(input.amount)) {
      return invalid("금액은 1원 이상 2,147,483,647원 이하의 정수로 입력해 주세요.");
    }
    if (typeof input.merchant !== "string" || !input.merchant.trim() || input.merchant.length > 200) {
      return invalid("가맹점 이름은 1~200자로 입력해 주세요.");
    }
    if (input.method !== undefined && !["transfer", "cash", "card", "other"].includes(input.method)) {
      return invalid("결제 수단이 올바르지 않습니다.");
    }
    if (input.category !== undefined && (typeof input.category !== "string" || !isCategory(input.category))) {
      return invalid("올바른 카테고리를 선택해 주세요.");
    }
    if (!validText(input.memo, 2000)) return invalid("메모는 2,000자 이내로 입력해 주세요.");
    const occurredAt = input.occurredAt === undefined ? undefined
      : typeof input.occurredAt === "string" ? parseIsoWithOffset(input.occurredAt) : null;
    if (occurredAt === null) return invalid("거래 일시는 시간대가 포함된 올바른 날짜여야 합니다.");
    const result = await addManualTransaction(session.userId, {
      amount: input.amount,
      merchant: input.merchant.trim(),
      method: input.method,
      occurredAt,
      category: input.category,
      memo: input.memo,
    });
    if (!result.ok) return { ok: false, code: "duplicate", error: "같은 시각에 동일한 거래가 이미 등록되어 있습니다." };
    revalidatePath("/ledger", "layout");
    return { ok: true, number: result.tx.number };
  } catch {
    return { ok: false, code: "failed", error: "거래를 추가하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function deleteLedgerManualTransaction(number: number): Promise<LedgerMutationResult> {
  try {
    const session = await getLedgerSession();
    if (!session) return { ok: false, code: "unauthorized", error: "로그인이 필요합니다." };
    if (!validNumber(number)) return invalid("거래 번호가 올바르지 않습니다.");
    const result = await deleteManualTransaction(session.userId, number);
    if (!result.ok) {
      return {
        ok: false,
        code: result.reason,
        error: result.reason === "not_manual" ? "수동으로 입력한 거래만 삭제할 수 있습니다." : "거래를 찾을 수 없습니다.",
      };
    }
    revalidatePath("/ledger", "layout");
    return { ok: true, number: result.tx.number };
  } catch {
    return { ok: false, code: "failed", error: "거래를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
