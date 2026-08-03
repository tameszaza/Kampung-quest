import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { coordinationEventRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

interface RouteContext {
  params: Promise<{ questId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const run = await kampungQuestEngine.getQuest(questId);
    if (!run) return NextResponse.json({ error: "Quest run not found" }, { status: 404 });
    if (run.initiatingCandidateId !== user.id) return NextResponse.json({ error: "You cannot update another member's quest" }, { status: 403 });
    const event = coordinationEventRequestSchema.parse(await request.json());
    return NextResponse.json(await kampungQuestEngine.applyCoordinationEvent({ runId: questId, ...event }));
  } catch (error) {
    return errorResponse(error);
  }
}
