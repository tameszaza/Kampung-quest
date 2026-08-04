import { NextResponse } from "next/server";
import { kampungStore } from "@/server/container";
import { boundedLimit, errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { identityStore } from "@/server/identity/container";
import { withQuestParticipantProfiles } from "@/server/quest/quest-participant-profiles";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const candidateId = url.searchParams.get("candidateId")?.trim();
    if (!candidateId) {
      return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
    }
    if (candidateId !== user.id) return NextResponse.json({ error: "You cannot view another member's quests" }, { status: 403 });
    const limit = boundedLimit(url.searchParams.get("limit"), 20);
    const runs = await kampungStore.listQuestRuns(candidateId, limit);
    return NextResponse.json(await Promise.all(runs.map((run) => withQuestParticipantProfiles(run, identityStore))));
  } catch (error) {
    return errorResponse(error);
  }
}
