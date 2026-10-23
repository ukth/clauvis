import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { transactions, users } from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { isValidMonth, kstMonthString, listTransactions, MANUAL_CARD_ORG, reserveTransactionNumbers } from "@/lib/ledger";

const MAX_BATCH = 500;

const itemSchema = z.object({
  name: z.string().min(1).max(300),
  qty: z.number().nullable().optional(),
  price: z.number().nullable().optional(),
});

const txSchema = z.object({
  // "manual:" ids and cardOrg "manual" are reserved for Telegram/MCP entries (deletable);
  // synced rows must not be able to claim or overwrite them.
  externalId: z
    .string()
    .min(1)
    .max(200)
    .refine((v) => !v.startsWith("manual:"), "externalId prefix 'manual:' is reserved"),
  occurredAt: z.coerce.date(),
  amount: z.number().int().min(-2147483648).max(2147483647).nullable().optional(),
  currency: z.string().min(1).max(10).optional(),
  originalAmount: z
    .union([z.string().max(50), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v == null ? null : String(v))),
  merchant: z.string().min(1).max(200),
  cardOrg: z
    .string()
    .min(1)
    .max(50)
    .refine((v) => v !== MANUAL_CARD_ORG, "cardOrg 'manual' is reserved"),
  cardName: z.string().max(100).nullable().optional(),
  installmentMonths: z.number().int().min(0).max(60).optional(),
  status: z.enum(["approved", "cancelled", "declined"]).optional(),
  category: z.string().max(50).nullable().optional(),
  items: z.array(itemSchema).max(200).nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
});

const bodySchema = z.object({
  transactions: z.array(txSchema).max(MAX_BATCH),
});

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month") ?? kstMonthString();
  if (!isValidMonth(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }
  const limitParam = Number(searchParams.get("limit") ?? 200);
  const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 200;

  const result = await listTransactions(userId, { month, limit });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues.slice(0, 20) },
      { status: 400 }
    );
  }

  // Dedupe by externalId within the batch (last one wins) so the upsert never hits the same row twice
  const byExternalId = new Map(parsed.data.transactions.map((tx) => [tx.externalId, tx]));
  const incoming = [...byExternalId.values()].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
  );

  let inserted = 0;
  let updated = 0;

  if (incoming.length > 0) {
    const existing = await db
      .select({ externalId: transactions.externalId })
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        inArray(transactions.externalId, incoming.map((tx) => tx.externalId)),
      ));
    const existingIds = new Set(existing.map((r) => r.externalId));

    // Reserve #numbers for new rows atomically via users.ledger_seq (single statement, safe under concurrent POSTs).
    // transactions is a new table, so ledger_seq starting at 0 needs no backfill.
    const newCount = incoming.filter((tx) => !existingIds.has(tx.externalId)).length;
    let nextNumber = newCount > 0 ? await reserveTransactionNumbers(userId, newCount) : 0;
    const now = new Date();
    const values = incoming.map((tx) => ({
      userId,
      // Existing rows hit the externalId conflict and keep their number (number is not in the update set)
      number: existingIds.has(tx.externalId) ? 0 : nextNumber++,
      occurredAt: tx.occurredAt,
      amount: tx.amount ?? null,
      currency: tx.currency ?? "KRW",
      originalAmount: tx.originalAmount ?? null,
      merchant: tx.merchant,
      cardOrg: tx.cardOrg,
      cardName: tx.cardName ?? null,
      installmentMonths: tx.installmentMonths ?? 0,
      status: tx.status ?? "approved",
      category: tx.category ?? null,
      items: tx.items ?? null,
      memo: tx.memo ?? null,
      externalId: tx.externalId,
      updatedAt: now,
    }));

    await db
      .insert(transactions)
      .values(values)
      .onConflictDoUpdate({
        target: [transactions.userId, transactions.externalId],
        set: {
          occurredAt: sql`excluded.occurred_at`,
          amount: sql`coalesce(excluded.amount, ${transactions.amount})`,
          currency: sql`excluded.currency`,
          originalAmount: sql`coalesce(excluded.original_amount, ${transactions.originalAmount})`,
          merchant: sql`excluded.merchant`,
          cardOrg: sql`excluded.card_org`,
          cardName: sql`coalesce(excluded.card_name, ${transactions.cardName})`,
          installmentMonths: sql`excluded.installment_months`,
          status: sql`excluded.status`,
          // Keep user-set values: category only fills when empty, memo is never overwritten once set
          category: sql`coalesce(${transactions.category}, excluded.category)`,
          items: sql`coalesce(excluded.items, ${transactions.items})`,
          memo: sql`coalesce(${transactions.memo}, excluded.memo)`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    updated = existingIds.size;
    inserted = incoming.length - updated;
  }

  await db.update(users).set({ ledgerSyncedAt: new Date() }).where(eq(users.id, userId));

  console.log(`[LEDGER] sync user=${userId.slice(0, 4)} inserted=${inserted} updated=${updated}`);
  return NextResponse.json({ inserted, updated });
}
