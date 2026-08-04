import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ questId: string }> };

export async function GET(_: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    return NextResponse.json(await eventCoordinator.getStateForUser(questId, user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

