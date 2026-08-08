import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";
import { RequestPerformance } from "@/server/observability/request-performance";

export async function GET() {
  const timing = new RequestPerformance();
  try {
    const user = await requireUser();
    timing.mark("auth");
    const activities = await eventCoordinator.listActivities(user.id);
    timing.mark("activities");
    return timing.apply(NextResponse.json(activities), "activities.list.slow", { userId: user.id });
  } catch (error) {
    return errorResponse(error);
  }
}
