import { db } from ".";
import { todos, ideas, workLogs } from "./schema";
import { eq, sql } from "drizzle-orm";

export async function getNextTodoNumber(userId: string): Promise<number> {
  const [result] = await db
    .select({ maxNum: sql<number>`coalesce(max(${todos.number}), 0)` })
    .from(todos)
    .where(eq(todos.userId, userId));
  return (result?.maxNum ?? 0) + 1;
}

export async function getNextIdeaNumber(userId: string): Promise<number> {
  const [result] = await db
    .select({ maxNum: sql<number>`coalesce(max(${ideas.number}), 0)` })
    .from(ideas)
    .where(eq(ideas.userId, userId));
  return (result?.maxNum ?? 0) + 1;
}

export async function getNextWorkLogNumber(userId: string): Promise<number> {
  const [result] = await db
    .select({ maxNum: sql<number>`coalesce(max(${workLogs.number}), 0)` })
    .from(workLogs)
    .where(eq(workLogs.userId, userId));
  return (result?.maxNum ?? 0) + 1;
}
