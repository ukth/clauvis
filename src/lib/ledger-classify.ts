import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { transactions, users } from "./db/schema";
import { and, eq, inArray, isNull, ne, notInArray, or } from "drizzle-orm";
import { decrypt } from "./crypto";
import { CATEGORIES, isCategory } from "./ledger";

const CLASSIFY_MODEL = "claude-haiku-5-5";
const BATCH_LIMIT = 100;

/**
 * Fill the category of uncategorized transactions with a cheap model call.
 * Rows that already have a valid category (rule-based or user-set) are never touched,
 * so the user can correct any guess and it sticks. Rows with a legacy/unknown category
 * are treated as uncategorized. Returns the number of rows classified; never throws.
 */
export async function classifyUncategorized(userId: string): Promise<number> {
  try {
    const [user] = await db
      .select({ encryptedKey: users.encryptedAnthropicKey })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.encryptedKey) return 0;

    const rows = await db
      .select({
        number: transactions.number,
        merchant: transactions.merchant,
        amount: transactions.amount,
        cardName: transactions.cardName,
        items: transactions.items,
        memo: transactions.memo,
      })
      .from(transactions)
      .where(and(
        eq(transactions.userId, userId),
        or(isNull(transactions.categorySource), ne(transactions.categorySource, "user")),
        or(isNull(transactions.category), notInArray(transactions.category, [...CATEGORIES])),
      ))
      .limit(BATCH_LIMIT);
    if (rows.length === 0) return 0;

    const lines = rows.map((r) => {
      const items = r.items?.length ? ` items: ${r.items.map((i) => i.name).join(", ")}` : "";
      const memo = r.memo ? ` memo: ${r.memo}` : "";
      return `${r.number}\t${r.merchant}\t${r.amount ?? "?"}원\t${r.cardName ?? ""}${items}${memo}`;
    });

    const client = new Anthropic({ apiKey: decrypt(user.encryptedKey) });
    const response = await client.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 2048,
      system: [
        "You classify Korean card/bank transactions into spending categories.",
        `Allowed categories (use exactly one of these strings): ${CATEGORIES.join(", ")}.`,
        "Guide: 외식=restaurants/bars, 배달=delivery apps, 카페·간식=cafes/bakeries/convenience stores,",
        "장보기=groceries/marts, 생필품=household goods/drugstores/daiso, 쇼핑=clothes/electronics/general online shopping,",
        "교통=transit/taxi/fuel/parking, 여행=lodging/flights/travel agencies, 통신비=mobile/internet carriers (SKT, KT, LG U+, MVNOs),",
        "구독·AI=subscriptions and AI services,",
        "업무=cloud/dev/work tools, 의료=hospitals/pharmacies, 경조사·선물=gifts/condolences/transfers to family or friends for occasions,",
        "기타=anything else or unclear.",
        'Reply with ONLY a JSON object mapping each transaction number to a category, e.g. {"12":"외식","13":"교통"}.',
      ].join("\n"),
      messages: [{ role: "user", content: `number\tmerchant\tamount\tcard\n${lines.join("\n")}` }],
    });

    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return 0;
    const result: unknown = JSON.parse(json);
    if (!result || typeof result !== "object") return 0;

    const known = new Set(rows.map((r) => r.number));
    const byCategory = new Map<string, number[]>();
    for (const [key, value] of Object.entries(result)) {
      const number = Number(key);
      if (!known.has(number) || typeof value !== "string" || !isCategory(value)) continue;
      byCategory.set(value, [...(byCategory.get(value) ?? []), number]);
    }

    let classified = 0;
    for (const [category, numbers] of byCategory) {
      // Re-check the condition so a category the user set meanwhile is not overwritten
      const updated = await db
        .update(transactions)
        .set({ category, categorySource: "ai", updatedAt: new Date() })
        .where(and(
          eq(transactions.userId, userId),
          inArray(transactions.number, numbers),
          or(isNull(transactions.categorySource), ne(transactions.categorySource, "user")),
          or(isNull(transactions.category), notInArray(transactions.category, [...CATEGORIES])),
        ))
        .returning({ number: transactions.number });
      classified += updated.length;
    }
    console.log(`[LEDGER] classify user=${userId.slice(0, 4)} candidates=${rows.length} classified=${classified}`);
    return classified;
  } catch (error) {
    console.error(`[LEDGER] classify user=${userId.slice(0, 4)} failed:`, error);
    return 0;
  }
}
