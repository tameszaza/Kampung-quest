import { assistantConversationService } from "@/server/container";
import { assistantConfirmRequestSchema } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";
import { createAssistantWorkflowStream } from "@/server/http/assistant-workflow-stream";
import { requireUser } from "@/server/identity/session";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { conversationId } = await context.params;
    const existing = await assistantConversationService.get(conversationId);
    if (!existing) return new Response(JSON.stringify({ error: "Assistant conversation was not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (existing.candidateId !== user.id) return new Response(JSON.stringify({ error: "You cannot confirm another member's assistant conversation" }), { status: 403, headers: { "Content-Type": "application/json" } });
    const command = assistantConfirmRequestSchema.parse(await request.json());
    const stream = createAssistantWorkflowStream((send) =>
      assistantConversationService.confirm(conversationId, command, send)
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
