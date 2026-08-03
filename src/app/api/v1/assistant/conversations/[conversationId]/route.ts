import { NextResponse } from "next/server";
import { assistantConversationService } from "@/server/container";
import { errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const conversation = await assistantConversationService.get(conversationId);
    if (!conversation) return NextResponse.json({ error: "Assistant conversation was not found" }, { status: 404 });
    return NextResponse.json(conversation);
  } catch (error) {
    return errorResponse(error);
  }
}
