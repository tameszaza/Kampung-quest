import type { ChatMessage, ChatMessageCursor, ChatMessagePage } from "@/server/identity/types";

export const CHAT_MESSAGE_PAGE_SIZE = 300;

type MessagePage<T> = Omit<ChatMessagePage, "messages"> & { messages: T[] };

export function encodeMessageCursor(cursor: ChatMessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMessageCursor(value: string | null, conversationId: string): ChatMessageCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ChatMessageCursor>;
    if (
      parsed.conversationId !== conversationId
      || typeof parsed.messageId !== "string"
      || typeof parsed.createdAt !== "string"
      || Number.isNaN(Date.parse(parsed.createdAt))
    ) throw new Error("Invalid chat message cursor");
    return parsed as ChatMessageCursor;
  } catch {
    throw new Error("Invalid chat message cursor");
  }
}

export function cursorForMessage(conversationId: string, message: Pick<ChatMessage, "id" | "createdAt">): ChatMessageCursor {
  return { conversationId, messageId: message.id, createdAt: message.createdAt };
}

export function pageChatMessages(
  messages: ChatMessage[],
  conversationId: string,
  after?: ChatMessageCursor,
): ChatMessagePage {
  return pageMessages(messages, conversationId, after);
}

export function pageMessages<T extends { id: string; createdAt: string }>(
  messages: T[],
  conversationId: string,
  after?: ChatMessageCursor,
): MessagePage<T> {
  const start = after
    ? messages.findIndex((message) => message.id === after.messageId && message.createdAt === after.createdAt) + 1
    : Math.max(0, messages.length - CHAT_MESSAGE_PAGE_SIZE);

  if (after && start === 0) {
    const snapshot = messages.slice(-CHAT_MESSAGE_PAGE_SIZE);
    return {
      messages: snapshot,
      cursor: snapshot.at(-1) ? cursorForMessage(conversationId, snapshot.at(-1)!) : null,
      hasMore: false,
      resetRequired: true,
    };
  }

  const page = messages.slice(start, start + CHAT_MESSAGE_PAGE_SIZE);
  const lastMessage = page.at(-1);
  return {
    messages: page,
      cursor: lastMessage
      ? cursorForMessage(conversationId, lastMessage)
      : after ?? null,
    hasMore: start + page.length < messages.length,
    resetRequired: false,
  };
}

export function syncMeta(page: Pick<ChatMessagePage, "cursor" | "hasMore" | "resetRequired">, mode: "snapshot" | "delta") {
  return {
    mode,
    cursor: page.cursor ? encodeMessageCursor(page.cursor) : null,
    hasMore: page.hasMore,
    resetRequired: page.resetRequired,
  } as const;
}
