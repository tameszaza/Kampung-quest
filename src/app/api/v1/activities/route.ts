import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await eventCoordinator.listActivities(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}

