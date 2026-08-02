import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { coordinationEventRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ questId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { questId } = await context.params;
    const event = coordinationEventRequestSchema.parse(await request.json());
    return NextResponse.json(await kampungQuestEngine.applyCoordinationEvent({ runId: questId, ...event }));
  } catch (error) {
    return errorResponse(error);
  }
}
