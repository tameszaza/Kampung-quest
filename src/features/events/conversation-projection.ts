import type { ConversationSummary } from "@/server/identity/types";

export function visibleConversationSummaries(
  activities: ConversationSummary[],
  assistant: ConversationSummary,
  conversations: ConversationSummary[],
): ConversationSummary[] {
  return [
    ...activities,
    assistant,
    ...conversations.filter((conversation) =>
      conversation.type !== "quest_private" && conversation.type !== "quest_group"),
  ];
}
