import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    await identityStore.leaveConversation(user.id, conversationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
