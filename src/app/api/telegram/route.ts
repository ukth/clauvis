import { NextRequest, NextResponse, after } from "next/server";
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
  markdownToTelegramHtml,
  splitForTelegram,
} from "@/lib/telegram";
import { runAgent } from "@/lib/agent";
import { decidePairingRequest, findPairingRequest, revokeAllLedgerSessions } from "@/lib/ledger-auth";

// Agent replies (up to 4096 tokens, several tool calls) can take well over 30s
export const maxDuration = 300;
import { isCommand, handleCommand } from "@/lib/commands";
import { encrypt, decrypt } from "@/lib/crypto";
import { randomBytes } from "crypto";

interface TelegramUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type?: string; first_name?: string; username?: string };
    from?: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from?: { id: number };
    message?: { message_id: number; chat: { id: number; type?: string } };
    data: string;
  };
}

const HELP_KEYBOARD = [
  [{ text: "🔐 가계부 웹 로그인", callback_data: "help:web" }],
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
  "help:web": `🔐 가계부 웹 로그인

• /web 123456 - 웹 화면의 로그인 코드 확인 후 승인
• /logout_all - 모든 웹 기기 로그아웃

본인이 요청한 로그인이 아니면 승인하지 마세요.`,
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
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update: TelegramUpdate = await request.json();

  // Handle callback queries (inline keyboard button clicks)
  if (update.callback_query) {
    const { id, message: cbMessage, data, from } = update.callback_query;
    await answerCallbackQuery(id);

    if (!cbMessage) return NextResponse.json({ ok: true });
    if (data.startsWith("web:")) {
      if (cbMessage.chat.type !== "private" || from?.id !== cbMessage.chat.id) {
        return NextResponse.json({ ok: true });
      }
      const match = /^web:(approve|reject):([a-f0-9-]{36})$/i.exec(data);
      const user = await getUserByChat(cbMessage.chat.id);
      if (!match || !user) {
        await editMessageText(cbMessage.chat.id, cbMessage.message_id, "가입된 개인 채팅에서만 승인할 수 있습니다.", []);
        return NextResponse.json({ ok: true });
      }
      try {
        const approve = match[1] === "approve";
        const changed = await decidePairingRequest(match[2], user.id, approve);
        await editMessageText(cbMessage.chat.id, cbMessage.message_id,
          changed
            ? approve ? "✅ 승인됨. 앱으로 돌아가면 로그인돼 있어요.\n\n모든 기기 로그아웃: /logout_all" : "로그인 요청을 거절했습니다."
            : "만료되었거나 이미 처리된 요청입니다. 웹에서 새 코드를 받아 주세요.", []);
      } catch {
        await sendMessage(cbMessage.chat.id, "로그인 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", false);
      }
      return NextResponse.json({ ok: true });
    }

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

  // Message bodies may contain API keys, cookies, or pairing codes; never log them.
  console.log(`[TELEGRAM] message_id=${message.message_id} chat=${message.chat.id}`);

  const chatId = message.chat.id;
  const text = message.text.trim();

  // Pairing deep links must be handled before /start's legacy API-key linking.
  if (/^\/start(?:@\w+)?\s+web_/i.test(text) || /^\/web(?:@\w+)?(?:\s|$)/i.test(text)) {
    if (message.chat.type !== "private" || message.from?.id !== chatId) {
      await sendMessage(chatId, "봇과의 개인 채팅에서 로그인해 주세요.", false);
      return NextResponse.json({ ok: true });
    }
    const user = await getUserByChat(chatId);
    if (!user) {
      await sendMessage(chatId, "먼저 /start 로 가입한 뒤 웹 로그인 코드를 다시 보내 주세요.", false);
      return NextResponse.json({ ok: true });
    }
    const match = /^(?:\/start(?:@\w+)?\s+web_|\/web(?:@\w+)?\s+)(\d{6})$/i.exec(text);
    try {
      const pairing = match ? await findPairingRequest(match[1]) : null;
      if (!pairing) {
        await sendMessage(chatId, "유효한 로그인 요청을 찾을 수 없습니다. 웹에서 새 코드를 받아 주세요.", false);
      } else {
        await sendMessageWithKeyboard(chatId,
          `🔐 웹 로그인 요청\n\n코드 ${pairing.pairCode}\n기기: ${pairing.userAgent}\n\n본인이 방금 요청한 게 아니면 승인하지 마세요.`,
          [[{ text: "✅ 승인", callback_data: `web:approve:${pairing.id}` },
            { text: "거절", callback_data: `web:reject:${pairing.id}` }]]);
      }
    } catch {
      await sendMessage(chatId, "로그인 요청을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", false);
    }
    return NextResponse.json({ ok: true });
  }

  if (/^\/logout_all(?:@\w+)?$/i.test(text)) {
    if (message.chat.type !== "private" || message.from?.id !== chatId) {
      await sendMessage(chatId, "봇과의 개인 채팅에서 로그아웃해 주세요.", false);
      return NextResponse.json({ ok: true });
    }
    const user = await getUserByChat(chatId);
    if (!user) {
      await sendMessage(chatId, "먼저 /start 로 가입해 주세요.", false);
      return NextResponse.json({ ok: true });
    }
    try {
      await revokeAllLedgerSessions(user.id);
      await sendMessage(chatId, "모든 웹 기기에서 로그아웃했습니다.", false);
    } catch {
      await sendMessage(chatId, "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.", false);
    }
    return NextResponse.json({ ok: true });
  }

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

  // Reply to Telegram immediately and run the agent after the response. Long generations
  // otherwise exceed the function timeout, and Telegram re-delivers the same update on
  // timeouts, re-running (and re-billing) the agent each time.
  after(async () => {
    try {
      // Show typing indicator
      await sendTyping(chatId);

      // Run the agent with user's API key (messages are saved inside runAgent)
      const apiKey = decrypt(encryptedKey);
      const response = await runAgent(text, user.id, apiKey, user.model);

      // Agent writes Markdown; send as escaped Telegram HTML so special chars never break parsing.
      // Split the Markdown first (HTML escaping can lengthen it), one message per chunk.
      for (const chunk of splitForTelegram(response, 3500)) {
        await sendMessage(chatId, markdownToTelegramHtml(chunk), "HTML");
      }
    } catch (error) {
      console.error("Error processing message:", error);
      if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 401) {
        await sendMessage(
          chatId,
          "🔑 Your Anthropic API key is invalid or has been revoked.\n\nPlease re-register it with /setkey sk-ant-...",
          false
        );
      } else {
        const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : undefined;
        const code = status ? ` [${status}]` : "";
        await sendMessage(chatId, esc(`Something went wrong${code}. Please try again.`));
      }
    }
  });

  return NextResponse.json({ ok: true });
}
