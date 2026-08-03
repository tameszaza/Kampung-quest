import { NextResponse } from "next/server";
import { assistantConversationService } from "@/server/container";
import { assistantTurnRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    const conversation = await assistantConversationService.get(conversationId);
    if (!conversation) return NextResponse.json({ error: "Assistant conversation was not found" }, { status: 404 });
    if (conversation.candidateId !== user.id) return NextResponse.json({ error: "You cannot update another member's assistant conversation" }, { status: 403 });
    const command = assistantTurnRequestSchema.parse(await request.json());
    return NextResponse.json(await assistantConversationService.addTurn(conversationId, command));
  } catch (error) {
    return errorResponse(error);
  }
}
