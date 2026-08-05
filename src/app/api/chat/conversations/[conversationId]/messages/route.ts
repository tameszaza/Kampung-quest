import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import type { EventCoordinationMessage, EventQuestView } from "@/server/domain/event-coordination";
import { identityStore } from "@/server/identity/container";
import { sendMessageSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    const questConversation = parseQuestConversationId(conversationId);
    if (questConversation) {
      const [thread, quest] = await Promise.all([
        questConversation.scope === "group"
          ? eventCoordinator.getGroupCoordinationThread(questConversation.runId, user.id)
          : eventCoordinator.getCoordinationThread(questConversation.runId, user.id),
        eventCoordinator.getStateForUser(questConversation.runId, user.id),
      ]);
      return NextResponse.json({
        messages: thread.messages.map((message) => toChatMessage(message, conversationId, user.id, quest)),
      });
    }
    return NextResponse.json({ messages: await identityStore.listMessages(user.id, conversationId) });
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
      return NextResponse.json(
        { message: toChatMessage(message, conversationId, user.id, quest) },
        { status: 201 },
      );
    }
    return NextResponse.json(
      { message: await identityStore.sendMessage(user.id, conversationId, body) },
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
