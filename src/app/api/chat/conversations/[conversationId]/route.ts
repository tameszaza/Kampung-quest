import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { conversationActionSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    if (conversationId.startsWith("quest-private:") || conversationId.startsWith("quest-group:")) {
      return NextResponse.json({ error: "Activity chats follow quest membership and cannot be left or deleted here" }, { status: 409 });
    }
    let action: "delete" | "leave" = "leave";
    try {
      const body = await _request.json() as unknown;
      action = conversationActionSchema.parse(body).action;
    } catch {
      // Keep backwards compatibility for callers that used DELETE to leave a group.
    }
    if (action === "delete") await identityStore.deleteConversation(user.id, conversationId);
    else await identityStore.leaveConversation(user.id, conversationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
