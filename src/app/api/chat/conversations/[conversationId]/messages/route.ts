import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import type { EventCoordinationMessage, EventQuestView } from "@/server/domain/event-coordination";
import { decodeMessageCursor, pageChatMessages, syncMeta } from "@/server/chat/message-sync";
import { identityStore } from "@/server/identity/container";
import { sendMessageSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    let after;
    try {
      after = decodeMessageCursor(new URL(request.url).searchParams.get("after"), conversationId);
    } catch {
      return NextResponse.json({ error: "This chat sync cursor is invalid. Reload the conversation." }, { status: 400 });
    }
    const questConversation = parseQuestConversationId(conversationId);
    if (questConversation) {
      const [thread, quest] = await Promise.all([
        questConversation.scope === "group"
          ? eventCoordinator.getGroupCoordinationThread(questConversation.runId, user.id)
          : eventCoordinator.getCoordinationThread(questConversation.runId, user.id),
        eventCoordinator.getStateForUser(questConversation.runId, user.id),
      ]);
      const messages = thread.messages.map((message) => toChatMessage(message, conversationId, user.id, quest));
      const page = pageChatMessages(messages, conversationId, after);
      return NextResponse.json({
        messages: page.messages,
        sync: syncMeta(page, after && !page.resetRequired ? "delta" : "snapshot"),
      });
    }
    const page = await identityStore.listMessagesPage(user.id, conversationId, after);
    return NextResponse.json({
      messages: page.messages,
      sync: syncMeta(page, after && !page.resetRequired ? "delta" : "snapshot"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    const { body } = sendMessageSchema.parse(await request.json());
    const questConversation = parseQuestConversationId(conversationId);
    if (questConversation) {
      const clientMessageId = `message_${randomUUID()}`;
      const thread = questConversation.scope === "group"
        ? await eventCoordinator.getGroupCoordinationThread(questConversation.runId, user.id)
        : await eventCoordinator.getCoordinationThread(questConversation.runId, user.id);
      const updated = questConversation.scope === "group"
        ? await eventCoordinator.addGroupCoordinationMessage({
            runId: questConversation.runId,
            actorId: user.id,
            body,
            clientMessageId,
            expectedRevision: thread.revision,
          })
        : await eventCoordinator.addCoordinationMessage({
            runId: questConversation.runId,
            actorId: user.id,
            body,
            clientMessageId,
            expectedRevision: thread.revision,
          });
      const message = updated.messages.find((candidate) => candidate.messageId === clientMessageId)!;
      const quest = await eventCoordinator.getStateForUser(questConversation.runId, user.id);
      const chatMessage = toChatMessage(message, conversationId, user.id, quest);
      const page = pageChatMessages([chatMessage], conversationId);
      return NextResponse.json(
        { message: chatMessage, sync: syncMeta(page, "snapshot") },
        { status: 201 },
      );
    }
    const message = await identityStore.sendMessage(user.id, conversationId, body);
    const page = pageChatMessages([message], conversationId);
    return NextResponse.json(
      { message, sync: syncMeta(page, "snapshot") },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function parseQuestConversationId(conversationId: string): { scope: "private" | "group"; runId: string } | null {
  if (conversationId.startsWith("quest-private:")) return { scope: "private", runId: conversationId.slice("quest-private:".length) };
  if (conversationId.startsWith("quest-group:")) return { scope: "group", runId: conversationId.slice("quest-group:".length) };
  return null;
}

function toChatMessage(message: EventCoordinationMessage, conversationId: string, userId: string, quest: EventQuestView) {
  const sender = message.senderId
    ? quest.participantProgress.find((participant) => participant.userId === message.senderId)
    : null;
  const senderId = message.role === "participant" ? message.senderId ?? userId : null;
  return {
    id: message.messageId,
    conversationId,
    senderId,
    senderName: message.role === "participant" ? sender?.displayName ?? "You" : message.role === "assistant" ? "Senior Quest" : "Activity update",
    senderImageUrl: sender?.photoUrl ?? null,
    body: message.body,
    createdAt: message.createdAt,
    mine: senderId === userId,
  };
}
