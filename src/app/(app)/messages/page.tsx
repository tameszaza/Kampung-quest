import { ChatCenter } from "@/components/chat-center";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ assistant?: string; quest?: string }> }) {
  const { assistant, quest } = await searchParams;
  return <ChatCenter initialConversation={assistant === "1" ? "assistant" : undefined} initialQuest={quest} />;
}
