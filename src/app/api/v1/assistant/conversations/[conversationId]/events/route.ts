import { assistantConversationService } from "@/server/container";
import { errorResponse } from "@/server/http/responses";
import { requireUser } from "@/server/identity/session";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    const conversation = await assistantConversationService.get(conversationId);
    if (!conversation) return new Response(JSON.stringify({ error: "Assistant conversation was not found" }), { status: 404 });
    if (conversation.candidateId !== user.id) return new Response(JSON.stringify({ error: "You cannot view another member's assistant events" }), { status: 403 });
    const after = Number.parseInt(new URL(request.url).searchParams.get("after") ?? "0", 10) || 0;
    const body = conversation.events
      .filter((event) => event.sequence > after)
      .map((event) => `id: ${event.sequence}\nevent: stage\ndata: ${JSON.stringify(event)}\n\n`)
      .join("");
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
