import { NextResponse } from "next/server";
import { eventCoordinator, kampungStore } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { identityStore } from "@/server/identity/container";
import { requireUser } from "@/server/identity/session";

type RouteContext = { params: Promise<{ questId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { questId } = await context.params;
    const state = await eventCoordinator.getStateForUser(questId, user.id);
    if (state.initiatorId !== user.id || state.lifecycle !== "forming") {
      return NextResponse.json({ error: "Only the organizer can search while forming a roster" }, { status: 403 });
    }
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 50);
    const contacts = await identityStore.listContacts(user.id, query);
    const selected = new Set(state.roster.map((member) => member.userId));
    const eligible = [];
    for (const contact of contacts) {
      if (selected.has(contact.id)) continue;
      const memory = await kampungStore.findMemory(contact.id);
      const profile = memory?.profile;
      if (!profile || profile.memoryStatus !== "active" || profile.alreadyCommitted
        || profile.relationshipBlocked || !profile.constraints.verified
        || !profile.constraints.invitationConsent) continue;
      eligible.push(contact);
    }
    return NextResponse.json({ contacts: eligible });
  } catch (error) {
    return errorResponse(error);
  }
}

