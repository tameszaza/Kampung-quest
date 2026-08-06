import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { buildRewardSummaryWithTaskEntries } from "@/server/features/reward-service";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

export async function GET() {
  try {
    const user = await requireUser();
    const [activities, entries, taskPlanRunIds] = await Promise.all([
      eventCoordinator.listActivities(user.id),
      eventCoordinator.listRewardEntries(user.id),
      eventCoordinator.listTaskRewardRunIds(user.id),
    ]);
    return NextResponse.json(buildRewardSummaryWithTaskEntries(activities.my.completed, entries, taskPlanRunIds));
  } catch (error) {
    return errorResponse(error);
  }
}
