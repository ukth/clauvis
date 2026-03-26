const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function sendMessage(chatId: number, text: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

export function isAuthorizedUser(chatId: number): boolean {
  const authorizedId = process.env.TELEGRAM_AUTHORIZED_USER_ID;
  return authorizedId ? chatId === Number(authorizedId) : false;
}
