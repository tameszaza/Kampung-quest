import { describe, expect, it } from "vitest";
import { createAssistantWorkflowStream } from "@/server/http/assistant-workflow-stream";
import type { AssistantConversationSnapshot } from "@/server/domain/schemas";

describe("assistant workflow stream", () => {
  it("keeps a slow hosted-model stage alive until the completed snapshot arrives", async () => {
    const completed = {
      conversationId: "conversation-1",
      candidateId: "member-1",
      status: "complete",
      revision: 4,
      messages: [],
      brief: {},
      nextField: null,
      suggestedReplies: [],
      questRunId: "quest-1",
      events: [],
      error: null,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:01.000Z",
    } satisfies AssistantConversationSnapshot;
    const stream = createAssistantWorkflowStream(async () => {
      await new Promise((resolve) => setTimeout(resolve, 22));
      return completed;
    }, 5);

    const text = await new Response(stream).text();

    expect(text).toContain(": keep-alive\n\n");
    expect(text).toContain("event: complete");
    expect(text).toContain('"status":"complete"');
  });
});
