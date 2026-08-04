import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { coordinationEventRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { canViewQuestRun } from "@/server/quest/quest-access";

interface RouteContext {
  params: Promise<{ questId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const run = await kampungQuestEngine.getQuest(questId);
    if (!run) return NextResponse.json({ error: "Quest run not found" }, { status: 404 });
    if (!canViewQuestRun(run, user.id)) return NextResponse.json({ error: "You are not part of this quest" }, { status: 403 });
    const event = coordinationEventRequestSchema.parse(await request.json());
    const participantEvent = event.type === "participant_accepted"
      || event.type === "participant_declined"
      || event.type === "participant_timed_out";
    if (!participantEvent && run.initiatingCandidateId !== user.id) {
      return NextResponse.json({ error: "Only the quest organiser can complete or cancel this quest" }, { status: 403 });
    }
    return NextResponse.json(await kampungQuestEngine.applyCoordinationEvent({
      runId: questId,
      ...event,
      candidateId: participantEvent ? user.id : event.candidateId,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}
