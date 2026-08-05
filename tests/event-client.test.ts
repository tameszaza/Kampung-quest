import { afterEach, describe, expect, it, vi } from "vitest";
import { hideEventSuggestion, respondToEventInvitation } from "@/features/events/client";

describe("event coordination client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits an invitation response when randomUUID is unavailable", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("crypto", {});
    vi.stubGlobal("fetch", fetchMock);

    await respondToEventInvitation({
      runId: "quest_lan_safari",
      invitationId: "invitation_lan_safari",
      response: "accept",
      expectedRevision: 3,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0];
    expect(request?.headers).toEqual(expect.objectContaining({
      "Idempotency-Key": expect.any(String),
    }));
  });

  it("hides a suggested quest for the signed-in viewer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ hidden: true }));
    vi.stubGlobal("fetch", fetchMock);

    await hideEventSuggestion("quest_hidden_from_feed");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/event-quests/quest_hidden_from_feed/suggestion",
      { method: "DELETE" },
    );
  });
});
