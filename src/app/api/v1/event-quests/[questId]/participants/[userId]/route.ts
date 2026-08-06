import { NextResponse } from "next/server";
import { eventCoordinator } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { identityStore } from "@/server/identity/container";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ questId: string; userId: string }> };

export async function GET(_: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId, userId } = await context.params;
    const state = await eventCoordinator.getStateForUser(questId, user.id);
    if (!state.participantProgress.some((participant) => participant.userId === userId)) {
      return NextResponse.json({ error: "That person is not part of this activity" }, { status: 404 });
    }
    const target = await identityStore.findUserById(userId);
    if (!target) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json({
      id: target.id,
      fullName: target.fullName,
      username: target.username,
      email: target.email,
      phone: target.phone,
      photoUrl: target.photoUrl,
      emergencyContact: target.emergencyContact,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
