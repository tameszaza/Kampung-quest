import { afterEach, describe, expect, it, vi } from "vitest";
import { replayAssistantEvents } from "@/features/assistant/client";

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
});
