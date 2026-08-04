import { describe, expect, it } from "vitest";
import {
  hostedRetrySettings,
  hostedProviderErrorMessage,
  normalizeGeminiVenueRequirements,
} from "@/server/agents/openai-agent-runtime";

describe("Gemini agent output normalization", () => {
  it("maps descriptive public indoor venues to the validator's canonical requirements", () => {
    expect(normalizeGeminiVenueRequirements([
      "Indoor public community center media lounge",
      "Indoor seating",
      "Television or projector screen",
    ])).toEqual(expect.arrayContaining([
      "approved_public_location",
      "indoor",
    ]));
  });

  it("does not approve a venue merely because it is indoors", () => {
    expect(normalizeGeminiVenueRequirements(["Indoor private living room"]))
      .not.toContain("approved_public_location");
  });

  it("does not wait or spend another request after a Gemini quota response", async () => {
    const settings = hostedRetrySettings("gemini");
    const decision = await settings.policy?.({
      error: new Error("429"),
      attempt: 1,
      maxRetries: settings.maxRetries ?? 0,
      stream: false,
      normalized: {
        statusCode: 429,
        retryAfterMs: 46_398,
        isNetworkError: false,
        isAbort: false,
      },
    });

    expect(settings.maxRetries).toBe(0);
    expect(decision).toBe(false);
  });

  it("turns a Gemini quota response into a useful user-facing error", () => {
    expect(hostedProviderErrorMessage("gemini", {
      status: 429,
      headers: new Headers({ "retry-after": "47" }),
    })).toBe("Gemini request quota is temporarily exhausted. Please try again in about 47 seconds.");
  });

  it("normalizes a decimal retry hint without delaying the request", () => {
    expect(hostedProviderErrorMessage("gemini", {
      status: 429,
      message: "Quota exhausted. Please retry in 1.5s.",
      headers: new Headers(),
    })).toBe("Gemini request quota is temporarily exhausted. Please try again in about 2 seconds.");
  });

  it("explains a daily Gemini quota without suggesting an immediate retry", () => {
    expect(hostedProviderErrorMessage("gemini", {
      status: 429,
      headers: new Headers({ "x-gemini-quota-period": "day" }),
    })).toBe("Gemini's daily request quota for this model is exhausted. It resets at midnight Pacific time.");
  });
});
