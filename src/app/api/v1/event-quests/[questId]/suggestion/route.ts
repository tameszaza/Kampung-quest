import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ questId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    await eventCoordinator.hideSuggestion({ runId: questId, actorId: user.id });
    return NextResponse.json({ hidden: true });
  } catch (error) {
    return errorResponse(error);
  }
}
