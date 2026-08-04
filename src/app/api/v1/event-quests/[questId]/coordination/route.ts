import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { coordinationMessageRequestSchema } from "@/server/domain/event-coordination";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ questId: string }> };

export async function GET(_: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    return NextResponse.json(await eventCoordinator.getCoordinationThread(questId, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const command = coordinationMessageRequestSchema.parse(await request.json());
    return NextResponse.json(await eventCoordinator.addCoordinationMessage({
      runId: questId,
      actorId: user.id,
      ...command,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

