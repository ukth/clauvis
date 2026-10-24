import { loadChatHistory, attachmentLabel, findUserTransaction } from "@/lib/ledger-chat";
import { requirePageSession } from "../../_components/session";
import { ChatView } from "./chat-view";

// An agent turn (several model calls + tools) can take well over the default timeout
export const maxDuration = 300;

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ attach?: string }> }) {
  const session = await requirePageSession();
  const { attach } = await searchParams;
  const [history, tx] = await Promise.all([
    loadChatHistory(session.userId),
    attach && /^\d+$/.test(attach) ? findUserTransaction(session.userId, Number(attach)) : null,
  ]);
  return <ChatView history={history} initialAttachment={tx ? { number: tx.number, label: attachmentLabel(tx) } : null} />;
}
