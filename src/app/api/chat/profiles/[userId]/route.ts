import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { userId } = await context.params;
    const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
    if (!conversationId) return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    return NextResponse.json({ profile: await identityStore.getChatProfile(user.id, userId, conversationId) });
  } catch (error) {
    return errorResponse(error);
  }
}
