import { NextResponse } from "next/server";
import { kampungQuestEngine } from "@/server/container";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";
import { canViewQuestRun } from "@/server/quest/quest-access";
import { withQuestParticipantProfiles } from "@/server/quest/quest-participant-profiles";
import { identityStore } from "@/server/identity/container";

interface RouteContext {
  params: Promise<{ questId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const run = await kampungQuestEngine.getQuest(questId);
    if (!run) return NextResponse.json({ error: "Quest run not found" }, { status: 404 });
    if (!canViewQuestRun(run, user.id)) return NextResponse.json({ error: "You are not part of this quest" }, { status: 403 });
    return NextResponse.json(await withQuestParticipantProfiles(run, identityStore));
  } catch (error) {
    return errorResponse(error);
  }
}
