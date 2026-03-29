import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  sendMessage,
  sendTyping,
  sendMessageWithKeyboard,
  editMessageText,
  answerCallbackQuery,
  deleteMessage,
  esc,
} from "@/lib/telegram";
import { runAgent, saveMessage } from "@/lib/agent";
import { isCommand, handleCommand } from "@/lib/commands";
import { encrypt, decrypt } from "@/lib/crypto";
import { randomBytes } from "crypto";

interface TelegramUpdate {
  message?: {
    message_id: number;
    chat: { id: number; first_name?: string; username?: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    message: { message_id: number; chat: { id: number } };
    data: string;
  };
}

const HELP_KEYBOARD = [
  [
    { text: "📋 할일 관리", callback_data: "help:todo" },
    { text: "📁 프로젝트 관리", callback_data: "help:project" },
  ],
  [
    { text: "🤖 에이전트 모드", callback_data: "help:agent" },
    { text: "💡 예시", callback_data: "help:example" },
  ],
];

const HELP_SECTIONS: Record<string, string> = {
  "help:todo": `📋 할일 관리

• /add 할일 내용 #프로젝트 - 할일 추가
• /list [프로젝트] - 할일 목록
• /done 번호 - 할일 완료
• /del 번호 - 할일 삭제

번호는 /list 결과의 번호를 사용합니다.
프로젝트별 번호도 지원: /done mosun 2`,

  "help:project": `📁 프로젝트 관리

• /newproject slug [이름] - 프로젝트 생성
• /projects - 프로젝트 목록
• /delproject slug - 프로젝트 삭제

slug는 영문 소문자와 하이픈으로 지정합니다.
예: /newproject my-app 나의 앱`,

  "help:agent": `🤖 에이전트 모드

• /setkey sk-ant-... - Claude API Key 등록
• /delkey - API Key 삭제 (명령어 모드로 전환)
• /model haiku|sonnet|opus - 모델 변경

API Key를 등록하면 자연어로 할일을 관리할 수 있어요.
"내일까지 버그 수정해야돼" 같은 메시지를 보내보세요.`,

  "help:example": `💡 사용 예시

/add 이미지 버그 수정 #mosun
/add 회의 자료 정리
/list
/list mosun
/done 1
/done mosun 2
/newproject side-project 사이드 프로젝트
/model opus`,
};

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

  // Handle callback queries (inline keyboard button clicks)
  if (update.callback_query) {
    const { id, message: cbMessage, data } = update.callback_query;
    await answerCallbackQuery(id);

    const section = HELP_SECTIONS[data];
    if (section) {
      await editMessageText(
        cbMessage.chat.id,
        cbMessage.message_id,
        section,
        HELP_KEYBOARD
      );
    }
    return NextResponse.json({ ok: true });
  }

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

  // Handle /help with inline keyboard
  if (text === "/help" || text.startsWith("/help@")) {
    await sendMessageWithKeyboard(
      chatId,
      "📌 Clauvis 도움말\n\n영역을 선택하세요.",
      HELP_KEYBOARD
    );
    return NextResponse.json({ ok: true });
  }

  // Handle /setkey — encrypt and store API key, delete message for security
  if (text.startsWith("/setkey ")) {
    const apiKey = text.replace("/setkey ", "").trim();
    const deleted = await deleteMessage(chatId, message.message_id);

    if (!apiKey.startsWith("sk-ant-")) {
      await sendMessage(chatId, "유효한 Anthropic API Key를 입력해주세요.\n예: /setkey sk-ant-...", false);
      return NextResponse.json({ ok: true });
    }

    const encrypted = encrypt(apiKey);
    await db
      .update(users)
      .set({ encryptedAnthropicKey: encrypted })
      .where(eq(users.id, user.id));

    const warning = deleted ? "" : "\n\n⚠️ 메시지 삭제에 실패했어요. 보안을 위해 직접 삭제해주세요.";
    await sendMessage(chatId, `🔑 API Key가 등록되었어요. 이제 에이전트 모드를 사용할 수 있습니다!${warning}`, false);
    return NextResponse.json({ ok: true });
  }

  // Handle /delkey — remove stored API key
  if (text === "/delkey") {
    await db
      .update(users)
      .set({ encryptedAnthropicKey: null })
      .where(eq(users.id, user.id));

    await sendMessage(chatId, "🔑 API Key가 삭제되었어요. 명령어 모드로 전환됩니다.", false);
    return NextResponse.json({ ok: true });
  }

  // Handle slash commands (no LLM needed)
  if (isCommand(text)) {
    try {
      const response = await handleCommand(text, user.id);
      await sendMessage(chatId, response, false);
    } catch (error) {
      console.error("Command error:", error);
      await sendMessage(chatId, "명령어 처리 중 오류가 발생했어요.", false);
    }
    return NextResponse.json({ ok: true });
  }

  // Non-command text: check if user has registered API key for agent mode
  const encryptedKey = user.encryptedAnthropicKey;
  if (!encryptedKey) {
    await sendMessage(
      chatId,
      "에이전트 모드를 사용하려면 Claude API Key 등록이 필요해요.\n\n/setkey sk-ant-... 로 키를 등록하거나,\n/help 로 명령어 모드 사용법을 확인하세요.",
      false
    );
    return NextResponse.json({ ok: true });
  }

  try {
    // Save user message to chat history
    await saveMessage(user.id, "user", text);

    // Show typing indicator
    await sendTyping(chatId);

    // Run the agent with user's API key
    const apiKey = decrypt(encryptedKey);
    const response = await runAgent(text, user.id, apiKey, user.model);

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
