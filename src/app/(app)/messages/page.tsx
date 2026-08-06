import { ChatCenter } from "@/components/chat-center";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ assistant?: string; quest?: string; new?: string }> }) {
  const { assistant, quest, new: startNew } = await searchParams;
  return <ChatCenter initialConversation={assistant === "1" ? "assistant" : undefined} initialQuest={quest} startNewAssistant={startNew === "1"} />;
}
