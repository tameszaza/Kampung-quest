import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { invitationResponseRequestSchema } from "@/server/domain/event-coordination";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ invitationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { invitationId } = await context.params;
    const command = invitationResponseRequestSchema.parse(await request.json());
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    await eventCoordinator.respondToInvitation({
      runId: command.runId,
      invitationId,
      actorId: user.id,
      response: command.response,
      expectedRevision: command.expectedRevision,
      idempotencyKey,
    });
    return NextResponse.json(await eventCoordinator.getStateForUser(command.runId, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
