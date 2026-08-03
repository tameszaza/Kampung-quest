import { assistantConversationService } from "@/server/container";
import { assistantConfirmRequestSchema, type AssistantWorkflowEvent } from "@/server/domain/schemas";
import { errorResponse } from "@/server/http/responses";

interface RouteContext {
  params: Promise<{ conversationId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    const command = assistantConfirmRequestSchema.parse(await request.json());
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: AssistantWorkflowEvent) => {
          controller.enqueue(encoder.encode(
            `id: ${event.sequence}\nevent: stage\ndata: ${JSON.stringify(event)}\n\n`,
          ));
        };
        try {
          const conversation = await assistantConversationService.confirm(conversationId, command, send);
          controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify(conversation)}\n\n`));
        } catch (error) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({
            error: error instanceof Error ? error.message : "Quest preparation failed",
          })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
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
