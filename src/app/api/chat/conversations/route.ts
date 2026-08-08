import { NextResponse } from "next/server";
import { identityStore } from "@/server/identity/container";
import { createConversationSchema } from "@/server/identity/schemas";
import { requireUser } from "@/server/identity/session";
import { errorResponse } from "@/server/http/responses";
import { eventCoordinator } from "@/server/container";
import { RequestPerformance } from "@/server/observability/request-performance";

export async function GET() {
  const timing = new RequestPerformance();
  try {
    const user = await requireUser();
    timing.mark("auth");
    const [ordinary, coordination] = await Promise.all([
      identityStore.listConversations(user.id),
      eventCoordinator.listCoordinationConversations(user.id),
    ]);
    timing.mark("conversations");
    return timing.apply(NextResponse.json({
      conversations: [...ordinary, ...coordination].sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt)),
    }), "chat.conversations.slow", { userId: user.id });
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
