import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmAssistantConversation, replayAssistantEvents } from "@/features/assistant/client";
import type { AssistantConversationSnapshot } from "@/server/domain/schemas";

function conversation(status: AssistantConversationSnapshot["status"] = "ready_for_review"): AssistantConversationSnapshot {
  return {
    conversationId: "conversation/id",
    candidateId: "member-1",
    status,
    revision: 3,
    messages: [],
    brief: {},
    nextField: null,
    suggestedReplies: [],
    questRunId: null,
    events: [],
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

describe("assistant workflow event replay client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests only events after the last sequence and parses persisted SSE frames", async () => {
    const fetchMock = vi.fn(async () => new Response([
      "id: 4\nevent: stage\ndata: {\"sequence\":4,\"stage\":\"synthesis\",\"status\":\"completed\",\"message\":\"Quest proposed\",\"kind\":\"agent\",\"createdAt\":\"2026-08-03T00:00:00.000Z\"}\n\n",
      "id: 5\nevent: stage\ndata: {\"sequence\":5,\"stage\":\"validation\",\"status\":\"completed\",\"message\":\"Rules passed\",\"kind\":\"system\",\"createdAt\":\"2026-08-03T00:00:01.000Z\"}\n\n",
    ].join(""), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const events = await replayAssistantEvents("conversation/id", 3);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/assistant/conversations/conversation%2Fid/events?after=3",
      { cache: "no-store" },
    );
    expect(events.map((event) => [event.sequence, event.stage, event.kind])).toEqual([
      [4, "synthesis", "agent"],
      [5, "validation", "system"],
    ]);
  });

  it("parses a final complete frame even when the stream omits the trailing blank line", async () => {
    const completed = conversation("complete");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      `event: complete\ndata: ${JSON.stringify(completed)}`,
      { headers: { "Content-Type": "text/event-stream" } },
    )));

    await expect(confirmAssistantConversation(conversation(), vi.fn())).resolves.toEqual(completed);
  });

  it("restores persisted progress when an intermediary closes the stream", async () => {
    const processing = conversation("processing");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(": keep-alive\n\n", { headers: { "Content-Type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(processing), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmAssistantConversation(conversation(), vi.fn())).resolves.toEqual(processing);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/assistant/conversations/conversation%2Fid",
      { cache: "no-store" },
    );
  });
});
