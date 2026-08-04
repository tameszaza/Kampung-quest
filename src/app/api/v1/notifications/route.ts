import { NextResponse } from "next/server";
import { kampungStore } from "@/server/container";
import { errorResponse, boundedLimit } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { identityStore } from "@/server/identity/container";
import { withQuestParticipantProfiles } from "@/server/quest/quest-participant-profiles";
import { buildQuestNotifications } from "@/server/quest/quest-notifications";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user.preferences.questNotifications) return NextResponse.json([]);
    const limit = boundedLimit(new URL(request.url).searchParams.get("limit"), 50);
    const runs = await kampungStore.listQuestRuns(user.id, limit);
    const withProfiles = await Promise.all(runs.map((run) => withQuestParticipantProfiles(run, identityStore)));
    return NextResponse.json(buildQuestNotifications(withProfiles, user.id).slice(0, limit));
  } catch (error) {
    return errorResponse(error);
  }
}
