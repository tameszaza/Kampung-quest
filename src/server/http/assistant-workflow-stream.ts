import type { AssistantConversationSnapshot, AssistantWorkflowEvent } from "@/server/domain/schemas";

const DEFAULT_HEARTBEAT_MS = 10_000;

export function createAssistantWorkflowStream(
  run: (send: (event: AssistantWorkflowEvent) => void) => Promise<AssistantConversationSnapshot>,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let open = true;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (frame: string) => {
        if (open) controller.enqueue(encoder.encode(frame));
      };
      const send = (event: AssistantWorkflowEvent) => enqueue(
        `id: ${event.sequence}\nevent: stage\ndata: ${JSON.stringify(event)}\n\n`,
      );

      heartbeat = setInterval(() => enqueue(": keep-alive\n\n"), heartbeatMs);
      void run(send)
        .then((conversation) => enqueue(`event: complete\ndata: ${JSON.stringify(conversation)}\n\n`))
        .catch((error) => enqueue(`event: error\ndata: ${JSON.stringify({
          error: error instanceof Error ? error.message : "Quest preparation failed",
        })}\n\n`))
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = null;
          if (open) controller.close();
          open = false;
        });
    },
    cancel() {
      open = false;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  });
}
