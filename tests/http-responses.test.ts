import { describe, expect, it } from "vitest";
import { errorResponse } from "@/server/http/responses";

describe("HTTP errors", () => {
  it("does not expose PostgreSQL implementation details to users", async () => {
    const error = Object.assign(
      new Error('new row violates check constraint "event_coordination_states_lifecycle_check"'),
      { code: "23514", constraint: "event_coordination_states_lifecycle_check" },
    );

    const response = errorResponse(error);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unexpected server error" });
  });

  it.each([
    "Gemini request quota is temporarily exhausted. Please try again in about 47 seconds.",
    "Gemini's daily request quota for this model is exhausted. It resets at midnight Pacific time.",
  ])("preserves provider rate limits as HTTP 429 responses", async (message) => {
    const response = errorResponse(new Error(message));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it("hides hosted-provider internals behind a retryable coordination error", async () => {
    const response = errorResponse(new Error(
      "gemini provider unavailable: Schema field at properties/requirementPatch uses optional()",
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Senior Quest is temporarily unavailable. Your request was not applied—please try again.",
    });
  });
});
