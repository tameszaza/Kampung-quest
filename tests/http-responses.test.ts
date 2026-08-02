import { describe, expect, it } from "vitest";
import { errorResponse } from "@/server/http/responses";

describe("HTTP errors", () => {
  it.each([
    "Gemini request quota is temporarily exhausted. Please try again in about 47 seconds.",
    "Gemini's daily request quota for this model is exhausted. It resets at midnight Pacific time.",
  ])("preserves provider rate limits as HTTP 429 responses", async (message) => {
    const response = errorResponse(new Error(message));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
