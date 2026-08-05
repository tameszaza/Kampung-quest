import { describe, expect, it } from "vitest";
import { visibleConversationSummaries } from "@/features/events/conversation-projection";
import type { ConversationSummary } from "@/server/identity/types";

describe("Messages conversation projection", () => {
  it("shows one activity workspace instead of separate private and group duplicates", () => {
    const activity = summary("activity:quest_1", "group", "Coffee social");
    const assistant = summary("senior-quest-assistant", "direct", "Senior Quest");
    const conversations = [
      summary("quest-private:quest_1", "quest_private", "Coffee social · Private"),
      summary("quest-group:quest_1", "quest_group", "Coffee social"),
      summary("direct_1", "direct", "Anne"),
    ];

    expect(visibleConversationSummaries([activity], assistant, conversations).map((item) => item.id)).toEqual([
      "activity:quest_1",
      "senior-quest-assistant",
      "direct_1",
    ]);
  });
});

function summary(id: string, type: ConversationSummary["type"], title: string): ConversationSummary {
  return {
    id,
    type,
    title,
    imageUrl: null,
    preview: title,
    lastMessageAt: "2026-08-05T08:00:00.000Z",
    unreadCount: 0,
    memberCount: 1,
  };
}
