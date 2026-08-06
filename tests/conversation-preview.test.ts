import { describe, expect, it } from "vitest";
import { latestChatMessage } from "@/features/events/conversation-preview";

describe("latestChatMessage", () => {
  it("chooses the newest private or group message", () => {
    const privateMessage = { messageId: "private-1", createdAt: "2026-08-07T10:00:00.000Z", body: "private" };
    const groupMessage = { messageId: "group-1", createdAt: "2026-08-07T10:01:00.000Z", body: "group" };

    expect(latestChatMessage([privateMessage], [groupMessage])).toBe(groupMessage);
  });

  it("uses the message id as a deterministic tie-breaker", () => {
    const first = { messageId: "message-a", createdAt: "2026-08-07T10:00:00.000Z" };
    const second = { messageId: "message-b", createdAt: "2026-08-07T10:00:00.000Z" };

    expect(latestChatMessage([first], [second])).toBe(second);
  });

  it("returns undefined when both chat scopes are empty", () => {
    expect(latestChatMessage([], [])).toBeUndefined();
  });
});
