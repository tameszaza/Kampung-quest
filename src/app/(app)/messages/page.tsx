import { ChatCenter } from "@/components/chat-center";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ assistant?: string }> }) {
  const { assistant } = await searchParams;
  return <ChatCenter initialConversation={assistant === "1" ? "assistant" : undefined} />;
}
