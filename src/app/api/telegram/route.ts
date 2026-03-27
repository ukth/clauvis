import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { todos, projects, users } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { analyzeMessage } from "@/lib/llm";
import { sendMessage, esc } from "@/lib/telegram";
import { randomBytes } from "crypto";

interface TelegramUpdate {
  message?: {
    chat: { id: number; first_name?: string; username?: string };
    text?: string;
  };
}

async function getUserByChat(chatId: number) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramChatId, String(chatId)))
    .limit(1);
  return user ?? null;
}

async function handleStart(chatId: number, apiKey: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  if (!user) {
    await sendMessage(chatId, esc("유효하지 않은 API 키예요."));
    return;
  }

  await db
    .update(users)
    .set({ telegramChatId: String(chatId) })
    .where(eq(users.id, user.id));

  await sendMessage(chatId, esc(`${user.name}님, 연동 완료! 이제 할일을 보내보세요.`));
}

async function handleList(chatId: number, userId: string, projectFilter?: string | null) {
  const conditions = [eq(todos.userId, userId), eq(todos.status, "pending")];

  if (projectFilter) {
    const project = await db
      .select()
      .from(projects)
      .where(and(eq(projects.name, projectFilter), eq(projects.userId, userId)))
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
    await sendMessage(chatId, "할일이 없어요\\! 🎉");
    return;
  }

  const grouped: Record<string, typeof result> = {};
  for (const todo of result) {
    const key = todo.projectName || "미분류";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(todo);
  }

  let message = esc(`📋 할일 ${result.length}개`) + "\n";
  let index = 1;
  for (const [project, items] of Object.entries(grouped)) {
    message += `\n*${esc(project)}* \\(${items.length}\\)\n`;
    for (const item of items) {
      const deadlineStr = item.deadline
        ? ` ⚠️ ${esc(item.deadline.toISOString().split("T")[0])}`
        : "";
      message += ` ${index}\\. ${esc(item.title)}${deadlineStr}\n`;
      index++;
    }
  }

  await sendMessage(chatId, message);
}

async function handleComplete(chatId: number, userId: string, target: string) {
  const num = parseInt(target);

  const pendingTodos = await db
    .select({ id: todos.id, title: todos.title })
    .from(todos)
    .where(and(eq(todos.userId, userId), eq(todos.status, "pending")))
    .orderBy(desc(todos.createdAt));

  if (!isNaN(num)) {
    if (num < 1 || num > pendingTodos.length) {
      await sendMessage(chatId, esc(`${num}번 할일이 없어요.`));
      return;
    }

    const todo = pendingTodos[num - 1];
    await db
      .update(todos)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(todos.id, todo.id));

    await sendMessage(
      chatId,
      `✓ ${esc(todo.title)} 완료\\!\n${esc(`남은 할일 ${pendingTodos.length - 1}개`)}`
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
      `✓ ${esc(matched.title)} 완료\\!\n${esc(`남은 할일 ${pendingTodos.length - 1}개`)}`
    );
  } else {
    await sendMessage(chatId, esc(`"${target}"에 해당하는 할일을 못 찾았어요.`));
  }
}

async function handleAdd(
  chatId: number,
  userId: string,
  content: string,
  todo: { title: string; projectName: string | null; priority: string; deadline: string | null; memo: string | null }
) {
  let projectId: string | null = null;
  if (todo.projectName) {
    const project = await db
      .select()
      .from(projects)
      .where(and(eq(projects.name, todo.projectName), eq(projects.userId, userId)))
      .limit(1);
    if (project.length > 0) {
      projectId = project[0].id;
    }
  }

  await db.insert(todos).values({
    userId,
    content,
    title: todo.title,
    memo: todo.memo,
    projectId,
    priority: todo.priority as "urgent" | "normal" | "low",
    deadline: todo.deadline ? new Date(todo.deadline) : null,
    source: "telegram",
  });

  const projectLabel = todo.projectName || "미분류";
  await sendMessage(chatId, `${esc(projectLabel)} \\> ${esc(todo.title)}\n${esc("추가했어요")}`);
}

export async function POST(request: NextRequest) {
  const update: TelegramUpdate = await request.json();
  const message = update.message;

  if (!message?.text) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  // /start <api_key> 로 기존 계정 연동
  if (text.startsWith("/start ")) {
    const apiKey = text.replace("/start ", "").trim();
    await handleStart(chatId, apiKey);
    return NextResponse.json({ ok: true });
  }

  // 유저 조회, 없으면 자동 생성
  let user = await getUserByChat(chatId);
  if (!user) {
    if (text === "/start") {
      // 신규 가입
      const apiKey = `clv_${randomBytes(24).toString("hex")}`;
      const name = message.chat.first_name || message.chat.username || "User";
      const [newUser] = await db
        .insert(users)
        .values({ name, apiKey, telegramChatId: String(chatId) })
        .returning();
      user = newUser;
      await sendMessage(
        chatId,
        esc(`환영합니다, ${user.name}님! 🎉`) +
        "\n\n" +
        esc("API Key:") + "\n`" + esc(user.apiKey) + "`\n\n" +
        esc("📌 Claude Code 연동하기:") + "\n" +
        esc("터미널에서 아래 명령어를 실행하세요:") + "\n\n" +
        "`bash \\<\\(curl \\-sL https://raw\\.githubusercontent\\.com/ukth/clauvis/main/scripts/setup\\.sh\\)`\n\n" +
        esc("이제 할일을 자유롭게 보내보세요!")
      );
      return NextResponse.json({ ok: true });
    }
    await sendMessage(chatId, esc("처음이시군요! /start 를 보내서 시작해주세요."));
    return NextResponse.json({ ok: true });
  }

  // /start 를 이미 가입된 유저가 보낸 경우 → API key 다시 보여주기
  if (text === "/start") {
    await sendMessage(
      chatId,
      esc(`${user.name}님, 이미 가입되어 있어요.`) +
      "\n\n" +
      esc("API Key:") + "\n`" + esc(user.apiKey) + "`"
    );
    return NextResponse.json({ ok: true });
  }

  try {
    const analysis = await analyzeMessage(text, user.id);

    switch (analysis.intent) {
      case "add_todo":
        if (analysis.todo) {
          await handleAdd(chatId, user.id, text, analysis.todo);
        }
        break;
      case "list":
        await handleList(chatId, user.id, analysis.listFilter);
        break;
      case "complete":
        if (analysis.completeTarget) {
          await handleComplete(chatId, user.id, analysis.completeTarget);
        }
        break;
      case "add_project":
        if (analysis.project) {
          const existing = await db
            .select()
            .from(projects)
            .where(and(eq(projects.name, analysis.project.name), eq(projects.userId, user.id)))
            .limit(1);
          if (existing.length > 0) {
            await sendMessage(chatId, esc(`"${analysis.project.name}" 프로젝트는 이미 있어요.`));
          } else {
            await db.insert(projects).values({
              userId: user.id,
              name: analysis.project.name,
              aliases: analysis.project.aliases || [],
            });
            const aliasStr = analysis.project.aliases.length > 0
              ? ` \\(alias: ${esc(analysis.project.aliases.join(", "))}\\)`
              : "";
            await sendMessage(chatId, `📁 ${esc(analysis.project.name)}${aliasStr}\n${esc("프로젝트 추가했어요")}`);
          }
        }
        break;
      case "list_projects": {
        const allProjects = await db
          .select()
          .from(projects)
          .where(eq(projects.userId, user.id));
        if (allProjects.length === 0) {
          await sendMessage(chatId, esc("등록된 프로젝트가 없어요."));
        } else {
          let msg = esc(`📁 프로젝트 ${allProjects.length}개`) + "\n\n";
          for (const p of allProjects) {
            const aliasStr = p.aliases.length > 0 ? ` \\(${esc(p.aliases.join(", "))}\\)` : "";
            msg += `• ${esc(p.name)}${aliasStr}\n`;
          }
          await sendMessage(chatId, msg);
        }
        break;
      }
      case "delete_project":
        if (analysis.deleteTarget) {
          const target = await db
            .select()
            .from(projects)
            .where(and(eq(projects.name, analysis.deleteTarget), eq(projects.userId, user.id)))
            .limit(1);
          if (target.length > 0) {
            await db.delete(projects).where(eq(projects.id, target[0].id));
            await sendMessage(chatId, `🗑 ${esc(target[0].name)} ${esc("프로젝트 삭제했어요")}`);
          } else {
            await sendMessage(chatId, esc(`"${analysis.deleteTarget}" 프로젝트를 못 찾았어요.`));
          }
        }
        break;
      case "delete_todo":
        if (analysis.deleteTarget) {
          const num = parseInt(analysis.deleteTarget);
          const pendingTodos = await db
            .select({ id: todos.id, title: todos.title })
            .from(todos)
            .where(and(eq(todos.userId, user.id), eq(todos.status, "pending")))
            .orderBy(desc(todos.createdAt));

          if (!isNaN(num) && num >= 1 && num <= pendingTodos.length) {
            const todo = pendingTodos[num - 1];
            await db.delete(todos).where(eq(todos.id, todo.id));
            await sendMessage(chatId, `🗑 ${esc(todo.title)} ${esc("삭제했어요")}`);
          } else {
            const matched = pendingTodos.find((t) =>
              t.title.toLowerCase().includes(analysis.deleteTarget!.toLowerCase())
            );
            if (matched) {
              await db.delete(todos).where(eq(todos.id, matched.id));
              await sendMessage(chatId, `🗑 ${esc(matched.title)} ${esc("삭제했어요")}`);
            } else {
              await sendMessage(chatId, esc(`"${analysis.deleteTarget}"에 해당하는 할일을 못 찾았어요.`));
            }
          }
        }
        break;
      case "chat":
      case "question":
      case "edit":
        await sendMessage(chatId, esc(analysis.reply || "네, 알겠어요!"));
        break;
    }
  } catch (error) {
    console.error("Error processing message:", error);
    await sendMessage(chatId, esc("처리 중 오류가 발생했어요. 다시 시도해주세요."));
  }

  return NextResponse.json({ ok: true });
}
