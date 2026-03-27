import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sendMessage, sendTyping, esc } from "@/lib/telegram";
import { runAgent, saveMessage } from "@/lib/agent";
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

export async function POST(request: NextRequest) {
  // Webhook secret 검증
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
        esc("API Key:") + "\n`" + esc(user.apiKey) + "`\n" +
        esc("⚠️ 이 키를 다른 곳에 공유하지 마세요.") + "\n\n" +
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
      esc("API Key:") + "\n`" + esc(user.apiKey) + "`\n" +
      esc("⚠️ 이 키를 다른 곳에 공유하지 마세요.")
    );
    return NextResponse.json({ ok: true });
  }

  try {
    // Save user message to chat history
    await saveMessage(user.id, "user", text);

    // Show typing indicator
    await sendTyping(chatId);

    // Run the agent
    const response = await runAgent(text, user.id);

    // Save bot response to chat history
    await saveMessage(user.id, "assistant", response);

    // Send response via Telegram (agent formats in MarkdownV2)
    await sendMessage(chatId, response);
  } catch (error) {
    console.error("Error processing message:", error);
    await sendMessage(chatId, esc("처리 중 오류가 발생했어요. 다시 시도해주세요."));
  }

  return NextResponse.json({ ok: true });
}
