import { after, NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { decodeMessageCursor, pageMessages, syncMeta } from "@/server/chat/message-sync";
import { coordinationMessageRequestSchema } from "@/server/domain/event-coordination";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { RequestPerformance } from "@/server/observability/request-performance";

type RouteContext = { params: Promise<{ questId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    let after;
    try {
      after = decodeMessageCursor(new URL(request.url).searchParams.get("after"), `quest-private:${questId}`);
    } catch {
      return NextResponse.json({ error: "This chat sync cursor is invalid. Reload the conversation." }, { status: 400 });
    }
    const thread = await eventCoordinator.getCoordinationThread(questId, user.id);
    return NextResponse.json(withMessagePage(thread, `quest-private:${questId}`, after));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const timing = new RequestPerformance();
  try {
    const user = await requireUser();
    timing.mark("auth");
    const { questId } = await context.params;
    const command = coordinationMessageRequestSchema.parse(await request.json());
    const thread = await eventCoordinator.addCoordinationMessage({
      runId: questId,
      actorId: user.id,
      ...command,
      waitForAgent: false,
      scheduleAgent: (task) => after(task),
    });
    timing.mark("persist_message");
    return timing.apply(
      NextResponse.json(withMessagePage(thread, `quest-private:${questId}`), { status: 202 }),
      "event_coordination.message.accepted.slow",
      { scope: "private", userId: user.id },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function withMessagePage<T extends { messages: Array<{ messageId: string; createdAt: string }> }>(thread: T, conversationId: string, after?: ReturnType<typeof decodeMessageCursor>) {
  const page = pageMessages(
    thread.messages.map((message) => ({ id: message.messageId, createdAt: message.createdAt, message })),
    conversationId,
    after,
  );
  return {
    ...thread,
    messages: page.messages.map((entry) => entry.message),
    sync: syncMeta(page, after && !page.resetRequired ? "delta" : "snapshot"),
  };
}
