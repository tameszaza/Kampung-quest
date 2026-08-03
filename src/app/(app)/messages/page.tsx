import { ChatCenter } from "@/components/chat-center";
import { EventCoordinationConversation } from "@/components/event-coordination-conversation";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ assistant?: string; quest?: string }> }) {
  const { assistant, quest } = await searchParams;
  if (quest) return <EventCoordinationConversation runId={quest} />;
  return <ChatCenter initialConversation={assistant === "1" ? "assistant" : undefined} />;
}
