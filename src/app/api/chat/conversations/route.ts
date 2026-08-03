import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { createConversationSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ conversations: await identityStore.listConversations(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = createConversationSchema.parse(await request.json());
    return NextResponse.json(
      { conversation: await identityStore.createConversation(user.id, input) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

