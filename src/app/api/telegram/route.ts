import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { todos, projects } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { parseNaturalLanguage } from "@/lib/llm";
import { sendMessage, isAuthorizedUser } from "@/lib/telegram";

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

async function handleList(chatId: number, projectFilter?: string) {
  const conditions = [eq(todos.status, "pending")];

  if (projectFilter) {
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.name, projectFilter))
      .limit(1);
    if (project.length > 0) {
      conditions.push(eq(todos.projectId, project[0].id));
    }
  }

  const result = await db
    .select({
      title: todos.title,
      priority: todos.priority,
      deadline: todos.deadline,
      projectName: projects.name,
    })
    .from(todos)
    .leftJoin(projects, eq(todos.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(todos.createdAt));

  if (result.length === 0) {
    await sendMessage(chatId, "할일이 없어요! 🎉");
    return;
  }

  const grouped: Record<string, typeof result> = {};
  for (const todo of result) {
    const key = todo.projectName || "미분류";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(todo);
  }

  let message = `📋 할일 ${result.length}개\n`;
  let index = 1;
  for (const [project, items] of Object.entries(grouped)) {
    message += `\n*${project}* (${items.length})\n`;
    for (const item of items) {
      const deadlineStr = item.deadline
        ? ` ⚠️ ${item.deadline.toISOString().split("T")[0]}`
        : "";
      message += ` ${index}. ${item.title}${deadlineStr}\n`;
      index++;
    }
  }

  await sendMessage(chatId, message);
}

async function handleComplete(chatId: number, input: string) {
  const match = input.match(/(\d+)\s*번?\s*(완료|끝|됐|done)/);
  if (!match) return false;

  const targetIndex = parseInt(match[1]);

  const pendingTodos = await db
    .select({ id: todos.id, title: todos.title })
    .from(todos)
    .where(eq(todos.status, "pending"))
    .orderBy(desc(todos.createdAt));

  if (targetIndex < 1 || targetIndex > pendingTodos.length) {
    await sendMessage(chatId, `${targetIndex}번 할일이 없어요.`);
    return true;
  }

  const target = pendingTodos[targetIndex - 1];
  await db
    .update(todos)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(todos.id, target.id));

  const remaining = pendingTodos.length - 1;
  await sendMessage(
    chatId,
    `✓ ${target.title} 완료!\n남은 할일 ${remaining}개`
  );
  return true;
}

async function handleAdd(chatId: number, content: string) {
  const parsed = await parseNaturalLanguage(content);

  let projectId: string | null = null;
  if (parsed.projectName) {
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.name, parsed.projectName))
      .limit(1);
    if (project.length > 0) {
      projectId = project[0].id;
    }
  }

  await db.insert(todos).values({
    content,
    title: parsed.title,
    memo: parsed.memo,
    projectId,
    priority: parsed.priority,
    deadline: parsed.deadline ? new Date(parsed.deadline) : null,
    source: "telegram",
  });

  const projectLabel = parsed.projectName || "미분류";
  await sendMessage(chatId, `${projectLabel} > ${parsed.title}\n추가했어요`);
}

export async function POST(request: NextRequest) {
  const update: TelegramUpdate = await request.json();
  const message = update.message;

  if (!message?.text) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (!isAuthorizedUser(chatId)) {
    await sendMessage(chatId, "인증되지 않은 사용자입니다.");
    return NextResponse.json({ ok: true });
  }

  const listPatterns = /^(할일|목록|리스트|list|보여줘|뭐 ?남았)/i;
  const completePatterns = /\d+\s*번?\s*(완료|끝|됐|done)/i;

  if (listPatterns.test(text)) {
    await handleList(chatId);
  } else if (completePatterns.test(text)) {
    const handled = await handleComplete(chatId, text);
    if (!handled) {
      await handleAdd(chatId, text);
    }
  } else {
    await handleAdd(chatId, text);
  }

  return NextResponse.json({ ok: true });
}
