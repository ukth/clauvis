import { db } from ".";
import { todos } from "./schema";
import { eq, sql } from "drizzle-orm";

export async function getNextTodoNumber(userId: string): Promise<number> {
  const [result] = await db
    .select({ maxNum: sql<number>`coalesce(max(${todos.number}), 0)` })
    .from(todos)
    .where(eq(todos.userId, userId));
  return (result?.maxNum ?? 0) + 1;
}
