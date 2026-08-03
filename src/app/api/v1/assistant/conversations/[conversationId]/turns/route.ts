import { NextResponse } from "next/server";
import { assistantConversationService } from "@/server/container";
import { assistantTurnRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const command = assistantTurnRequestSchema.parse(await request.json());
    return NextResponse.json(await assistantConversationService.addTurn(conversationId, command));
  } catch (error) {
    return errorResponse(error);
  }
}
