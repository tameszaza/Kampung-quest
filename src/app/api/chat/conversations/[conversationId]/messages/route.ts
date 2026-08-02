import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { sendMessageSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

type RouteContext = { params: Promise<{ conversationId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    return NextResponse.json({ messages: await identityStore.listMessages(user.id, conversationId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    const { body } = sendMessageSchema.parse(await request.json());
    return NextResponse.json(
      { message: await identityStore.sendMessage(user.id, conversationId, body) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

