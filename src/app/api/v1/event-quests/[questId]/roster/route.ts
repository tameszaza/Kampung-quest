import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { rosterConfirmRequestSchema, rosterUpdateRequestSchema } from "@/server/domain/event-coordination";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ questId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const command = rosterUpdateRequestSchema.parse(await request.json());
    await eventCoordinator.updateRoster({
      runId: questId,
      actorId: user.id,
      ...command,
    });
    return NextResponse.json(await eventCoordinator.getStateForUser(questId, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const command = rosterConfirmRequestSchema.parse(await request.json());
    const idempotencyKey = request.headers.get("Idempotency-Key");
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key is required" }, { status: 400 });
    await eventCoordinator.confirmRoster({
      runId: questId,
      actorId: user.id,
      expectedRevision: command.expectedRevision,
      idempotencyKey,
    });
    return NextResponse.json(await eventCoordinator.getStateForUser(questId, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
