const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export async function sendMessage(chatId: number, text: string, parseMode: "MarkdownV2" | "HTML" | false = "MarkdownV2") {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const resBody = await res.text();
    console.error("Telegram sendMessage failed:", res.status, resBody);
    // Fallback to plain text
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  }
}

export { escapeMarkdownV2 as esc };

export async function sendTyping(chatId: number) {
  await fetch(`${TELEGRAM_API}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

export async function sendMessageWithKeyboard(
  chatId: number,
  text: string,
  keyboard: Array<Array<{ text: string; callback_data: string }>>
) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: Array<Array<{ text: string; callback_data: string }>>
) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };

  await fetch(`${TELEGRAM_API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function answerCallbackQuery(callbackQueryId: string) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

export async function deleteMessage(chatId: number, messageId: number): Promise<boolean> {
  const res = await fetch(`${TELEGRAM_API}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
  return res.ok;
}

