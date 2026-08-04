import { NextResponse } from "next/server";
import { eventCoordinator, kampungStore } from "@/server/container";
import { errorResponse, boundedLimit } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { identityStore } from "@/server/identity/container";
import { withQuestParticipantProfiles } from "@/server/quest/quest-participant-profiles";
import { buildEventNotifications, buildQuestNotifications } from "@/server/quest/quest-notifications";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!user.preferences.questNotifications) return NextResponse.json([]);
    const limit = boundedLimit(new URL(request.url).searchParams.get("limit"), 50);
    const [runs, eventNotifications] = await Promise.all([
      kampungStore.listQuestRuns(user.id, limit),
      eventCoordinator.listNotifications(user.id, limit),
    ]);
    const withProfiles = await Promise.all(runs.map((run) => withQuestParticipantProfiles(run, identityStore)));
    const notifications = [
      ...buildQuestNotifications(withProfiles, user.id),
      ...buildEventNotifications(eventNotifications),
    ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return NextResponse.json(notifications.slice(0, limit));
  } catch (error) {
    return errorResponse(error);
  }
}
