import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { buildRewardSummary } from "@/server/features/reward-service";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

export async function GET() {
  try {
    const user = await requireUser();
    const activities = await eventCoordinator.listActivities(user.id);
    return NextResponse.json(buildRewardSummary(activities.my.completed));
  } catch (error) {
    return errorResponse(error);
  }
}
