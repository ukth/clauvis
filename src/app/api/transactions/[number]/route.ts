import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { CATEGORIES, updateTransactionMemo } from "@/lib/ledger";

const patchSchema = z
  .object({
    memo: z.string().max(1000).nullable().optional(),
    category: z.enum(CATEGORIES).nullable().optional(),
    excluded: z.boolean().optional(),
    excludeReason: z.string().max(200).nullable().optional(),
  })
  .refine((v) => v.memo !== undefined || v.category !== undefined || v.excluded !== undefined, {
    message: "memo, category, or excluded is required",
  })
  .refine((v) => v.excludeReason === undefined || v.excluded === true, {
    message: "excludeReason requires excluded: true",
  });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  const userId = getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { number: numberParam } = await params;
  const number = Number(numberParam);
  if (!Number.isInteger(number) || number < 1) {
    return NextResponse.json({ error: "Invalid transaction number" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const updated = await updateTransactionMemo(userId, number, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
