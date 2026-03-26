import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { todos, projects } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { analyzeMessage } from "@/lib/llm";
import { sendMessage, isAuthorizedUser } from "@/lib/telegram";

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

async function handleList(chatId: number, projectFilter?: string | null) {
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

async function handleComplete(chatId: number, target: string) {
  const num = parseInt(target);

  const pendingTodos = await db
    .select({ id: todos.id, title: todos.title })
    .from(todos)
    .where(eq(todos.status, "pending"))
    .orderBy(desc(todos.createdAt));

  if (!isNaN(num)) {
    if (num < 1 || num > pendingTodos.length) {
      await sendMessage(chatId, `${num}번 할일이 없어요.`);
      return;
    }

    const todo = pendingTodos[num - 1];
    await db
      .update(todos)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(todos.id, todo.id));

    await sendMessage(
      chatId,
      `✓ ${todo.title} 완료!\n남은 할일 ${pendingTodos.length - 1}개`
    );
    return;
  }

  const matched = pendingTodos.find((t) =>
    t.title.toLowerCase().includes(target.toLowerCase())
  );
  if (matched) {
    await db
      .update(todos)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(todos.id, matched.id));

    await sendMessage(
      chatId,
      `✓ ${matched.title} 완료!\n남은 할일 ${pendingTodos.length - 1}개`
    );
  } else {
    await sendMessage(chatId, `"${target}"에 해당하는 할일을 못 찾았어요.`);
  }
}

async function handleAdd(
  chatId: number,
  content: string,
  todo: { title: string; projectName: string | null; priority: string; deadline: string | null; memo: string | null }
) {
  let projectId: string | null = null;
  if (todo.projectName) {
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.name, todo.projectName))
      .limit(1);
    if (project.length > 0) {
      projectId = project[0].id;
    }
  }

  await db.insert(todos).values({
    content,
    title: todo.title,
    memo: todo.memo,
    projectId,
    priority: todo.priority as "urgent" | "normal" | "low",
    deadline: todo.deadline ? new Date(todo.deadline) : null,
    source: "telegram",
  });

  const projectLabel = todo.projectName || "미분류";
  await sendMessage(chatId, `${projectLabel} > ${todo.title}\n추가했어요`);
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

  try {
    const analysis = await analyzeMessage(text);

    switch (analysis.intent) {
      case "add_todo":
        if (analysis.todo) {
          await handleAdd(chatId, text, analysis.todo);
        }
        break;
      case "list":
        await handleList(chatId, analysis.listFilter);
        break;
      case "complete":
        if (analysis.completeTarget) {
          await handleComplete(chatId, analysis.completeTarget);
        }
        break;
      case "add_project":
        if (analysis.project) {
          const existing = await db
            .select()
            .from(projects)
            .where(eq(projects.name, analysis.project.name))
            .limit(1);
          if (existing.length > 0) {
            await sendMessage(chatId, `"${analysis.project.name}" 프로젝트는 이미 있어요.`);
          } else {
            await db.insert(projects).values({
              name: analysis.project.name,
              aliases: analysis.project.aliases || [],
            });
            const aliasStr = analysis.project.aliases.length > 0
              ? ` (alias: ${analysis.project.aliases.join(", ")})`
              : "";
            await sendMessage(chatId, `📁 ${analysis.project.name}${aliasStr}\n프로젝트 추가했어요`);
          }
        }
        break;
      case "list_projects": {
        const allProjects = await db.select().from(projects);
        if (allProjects.length === 0) {
          await sendMessage(chatId, "등록된 프로젝트가 없어요.");
        } else {
          let msg = `📁 프로젝트 ${allProjects.length}개\n\n`;
          for (const p of allProjects) {
            const aliasStr = p.aliases.length > 0 ? ` (${p.aliases.join(", ")})` : "";
            msg += `• ${p.name}${aliasStr}\n`;
          }
          await sendMessage(chatId, msg);
        }
        break;
      }
      case "chat":
      case "question":
      case "edit":
        await sendMessage(chatId, analysis.reply || "네, 알겠어요!");
        break;
    }
  } catch (error) {
    console.error("Error processing message:", error);
    await sendMessage(chatId, "처리 중 오류가 발생했어요. 다시 시도해주세요.");
  }

  return NextResponse.json({ ok: true });
}
