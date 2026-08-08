import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assistantConversationService } from "@/server/container";
import { assistantTurnRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { logger, safeErrorMessage } from "@/server/observability/logger";
import { RequestPerformance } from "@/server/observability/request-performance";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const timing = new RequestPerformance();
  const requestId = `assistant_turn_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  let conversationId = "unknown";
  let userId: string | undefined;
  try {
    const user = await requireUser();
    userId = user.id;
    timing.mark("auth");
    ({ conversationId } = await context.params);
    const conversation = await assistantConversationService.get(conversationId);
    timing.mark("conversation");
    if (!conversation) return NextResponse.json({ error: "Assistant conversation was not found" }, { status: 404 });
    if (conversation.candidateId !== user.id) return NextResponse.json({ error: "You cannot update another member's assistant conversation" }, { status: 403 });
    const command = assistantTurnRequestSchema.parse(await request.json());
    const updated = await assistantConversationService.addTurn(conversationId, { ...command, waitForAgent: false });
    timing.mark("turn_saved");
    const response = timing.apply(NextResponse.json(updated), "assistant.turn.slow", { userId: user.id });
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    logger.error("assistant.turn.failed", {
      requestId,
      conversationId,
      userId,
      error: safeErrorMessage(error),
    });
    const response = errorResponse(error);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}
