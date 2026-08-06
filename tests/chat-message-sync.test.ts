import { describe, expect, it } from "vitest";
import { decodeMessageCursor, encodeMessageCursor, pageChatMessages } from "@/server/chat/message-sync";
import { InMemoryIdentityStore } from "@/server/identity/identity-store";
import type { ChatMessage } from "@/server/identity/types";

function message(id: string, minute: number): ChatMessage {
  return {
    id,
    conversationId: "chat-1",
    senderId: "sender-1",
    senderName: "Sender",
    senderImageUrl: null,
    body: id,
    createdAt: new Date(Date.UTC(2026, 7, 6, 10, minute)).toISOString(),
    mine: false,
  };
}

describe("chat message synchronization", () => {
  it("returns a bounded snapshot and only messages after the acknowledged cursor", () => {
    const history = Array.from({ length: 305 }, (_, index) => message(`message-${index}`, index));
    const snapshot = pageChatMessages(history, "chat-1");
    expect(snapshot.messages).toHaveLength(300);
    expect(snapshot.messages[0]?.id).toBe("message-5");
    expect(snapshot.messages.at(-1)?.id).toBe("message-304");
    expect(snapshot.hasMore).toBe(false);

    const next = pageChatMessages([...history, message("message-305", 305)], "chat-1", snapshot.cursor!);
    expect(next.messages.map((item) => item.id)).toEqual(["message-305"]);

    const unchanged = pageChatMessages([...history, message("message-305", 305)], "chat-1", next.cursor!);
    expect(unchanged.messages).toEqual([]);
    expect(unchanged.cursor).toEqual(next.cursor);
  });

  it("requests a safe snapshot when the client cursor no longer exists", () => {
    const history = Array.from({ length: 3 }, (_, index) => message(`message-${index}`, index));
    const stale = pageChatMessages(history, "chat-1", {
      conversationId: "chat-1",
      messageId: "deleted-message",
      createdAt: new Date(Date.UTC(2026, 7, 6, 9)).toISOString(),
    });
    expect(stale.resetRequired).toBe(true);
    expect(stale.messages).toEqual(history);
  });

  it("rejects cursors belonging to another conversation", () => {
    const encoded = encodeMessageCursor({
      conversationId: "chat-1",
      messageId: "message-1",
      createdAt: new Date(Date.UTC(2026, 7, 6, 10)).toISOString(),
    });
    expect(() => decodeMessageCursor(encoded, "chat-2")).toThrow("Invalid chat message cursor");
  });

  it("keeps a live conversation current without downloading its history again", async () => {
    const store = new InMemoryIdentityStore();
    const maria = await store.createUser({
      fullName: "Maria Sync",
      username: "maria.sync",
      email: "maria-sync@example.com",
      phone: null,
      passwordHash: "scrypt$stored-only-for-test",
      dateOfBirth: "1948-05-12",
      gender: "Female",
      preferredLanguage: "English",
      area: "Tampines",
      photoUrl: null,
      preferences: {
        interests: [], groupSize: "small", activityLevel: "gentle", accessibilityNeeds: [], textSize: "large",
        highContrast: false, messageNotifications: true, questNotifications: true, profileVisibility: "community",
        messagePrivacy: "everyone", showOnlineStatus: true,
      },
    });
    const lee = await store.createUser({
      fullName: "Lee Sync",
      username: "lee.sync",
      email: "lee-sync@example.com",
      phone: null,
      passwordHash: "scrypt$stored-only-for-test",
      dateOfBirth: "1948-05-12",
      gender: "Male",
      preferredLanguage: "English",
      area: "Tampines",
      photoUrl: null,
      preferences: {
        interests: [], groupSize: "small", activityLevel: "gentle", accessibilityNeeds: [], textSize: "large",
        highContrast: false, messageNotifications: true, questNotifications: true, profileVisibility: "community",
        messagePrivacy: "everyone", showOnlineStatus: true,
      },
    });
    const conversation = await store.createConversation(maria.id, { type: "group", participantIds: [lee.id], title: "Sync Friends" });
    await store.sendMessage(lee.id, conversation.id, "First update");
    const initial = await store.listMessagesPage(maria.id, conversation.id);
    expect(initial.messages.at(-1)?.body).toBe("First update");

    await store.sendMessage(lee.id, conversation.id, "Second update");
    const delta = await store.listMessagesPage(maria.id, conversation.id, initial.cursor!);
    expect(delta.messages.map((item) => item.body)).toEqual(["Second update"]);
    expect((await store.listMessagesPage(maria.id, conversation.id, delta.cursor!)).messages).toEqual([]);
  });
});
