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
    { text: "📋 Todos", callback_data: "help:todo" },
    { text: "📁 Projects", callback_data: "help:project" },
  ],
  [
    { text: "🤖 Agent Mode", callback_data: "help:agent" },
    { text: "💡 Examples", callback_data: "help:example" },
  ],
];

const HELP_SECTIONS: Record<string, string> = {
  "help:todo": `📋 Todo Management

• /add content #project - Add todo
• /list [project] - List todos
• /view number - View todo detail
• /done number - Complete todo
• /del number - Delete todo

Numbers are stable IDs from /list.

💡 Lines after the first (Shift+Enter) become a memo.`,

  "help:project": `📁 Project Management

• /newproject slug [name] - Create project
• /projects - List projects
• /delproject slug - Delete project

Slug should be lowercase with hyphens.
e.g. /newproject my-app My App`,

  "help:agent": `🤖 Agent Mode

• /setkey sk-ant-... - Register Claude API Key
• /delkey - Remove API Key (switch to command mode)
• /model haiku|sonnet|opus - Change model

With an API Key, you can manage todos in natural language.
Try sending "fix the image bug by tomorrow".`,

  "help:example": `💡 Examples

/add fix image bug #mosun
/add prepare meeting notes
second line becomes memo
/list
/list mosun
/done 42
/view 42
/newproject side-project Side Project
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
    await sendMessage(chatId, esc("Invalid API key."));
    return;
  }

  await db
    .update(users)
    .set({ telegramChatId: String(chatId) })
    .where(eq(users.id, user.id));

  await sendMessage(chatId, esc(`${user.name}, linked! Start sending your todos.`));
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
        esc(`Welcome, ${user.name}! 🎉`) +
        "\n\n" +
        esc("API Key:") + "\n`" + esc(user.apiKey) + "`\n" +
        esc("⚠️ Do not share this key with anyone.") + "\n\n" +
        esc("📌 Connect to Claude Code:") + "\n" +
        esc("Run this in your terminal:") + "\n\n" +
        "`curl \\-sL https://raw\\.githubusercontent\\.com/ukth/clauvis/main/scripts/setup\\.sh \\| bash`\n\n" +
        esc("You're all set! Start sending todos.")
      );
      return NextResponse.json({ ok: true });
    }
    await sendMessage(chatId, esc("Welcome! Send /start to get started."));
    return NextResponse.json({ ok: true });
  }

  // /start 를 이미 가입된 유저가 보낸 경우 → API key 다시 보여주기
  if (text === "/start") {
    await sendMessage(
      chatId,
      esc(`${user.name}, you're already registered.`) +
      "\n\n" +
      esc("API Key:") + "\n`" + esc(user.apiKey) + "`\n" +
      esc("⚠️ Do not share this key with anyone.")
    );
    return NextResponse.json({ ok: true });
  }

  // Handle /help with inline keyboard
  if (text === "/help" || text.startsWith("/help@")) {
    await sendMessageWithKeyboard(
      chatId,
      "📌 Clauvis Help\n\nChoose a section.",
      HELP_KEYBOARD
    );
    return NextResponse.json({ ok: true });
  }

  // Handle /setkey — encrypt and store API key, delete message for security
  if (text.startsWith("/setkey ")) {
    const apiKey = text.replace("/setkey ", "").trim();
    const deleted = await deleteMessage(chatId, message.message_id);

    if (!apiKey.startsWith("sk-ant-")) {
      await sendMessage(chatId, "Please enter a valid Anthropic API Key.\ne.g. /setkey sk-ant-...", false);
      return NextResponse.json({ ok: true });
    }

    const encrypted = encrypt(apiKey);
    await db
      .update(users)
      .set({ encryptedAnthropicKey: encrypted })
      .where(eq(users.id, user.id));

    const warning = deleted ? "" : "\n\n⚠️ Failed to delete the message. Please delete it manually for security.";
    await sendMessage(chatId, `🔑 API Key registered! Agent mode is now available.${warning}`, false);
    return NextResponse.json({ ok: true });
  }

  // Handle /delkey — remove stored API key
  if (text === "/delkey") {
    await db
      .update(users)
      .set({ encryptedAnthropicKey: null })
      .where(eq(users.id, user.id));

    await sendMessage(chatId, "🔑 API Key removed. Switched to command mode.", false);
    return NextResponse.json({ ok: true });
  }

  // Handle slash commands (no LLM needed)
  if (isCommand(text)) {
    try {
      const response = await handleCommand(text, user.id);
      await sendMessage(chatId, response, "HTML");
    } catch (error) {
      console.error("Command error:", error);
      await sendMessage(chatId, "Something went wrong. Please try again.", false);
    }
    return NextResponse.json({ ok: true });
  }

  // Non-command text: check if user has registered API key for agent mode
  const encryptedKey = user.encryptedAnthropicKey;
  if (!encryptedKey) {
    await sendMessage(
      chatId,
      "Agent mode requires a Claude API Key.\n\nRegister with /setkey sk-ant-...\nor try /help for command mode.",
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
    await sendMessage(chatId, esc("Something went wrong. Please try again."));
  }

  return NextResponse.json({ ok: true });
}
