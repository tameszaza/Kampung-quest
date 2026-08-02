import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { createGeminiCompatibleFetch } from "@/server/agents/gemini-provider-fetch";

describe("Gemini compatibility error responses", () => {
  it("preserves a quota error and exposes Google's requested retry delay", async () => {
    const capturedResponse = [{
      error: {
        code: 429,
        message: "Quota exhausted. Please retry in 46.398222872s.",
        status: "RESOURCE_EXHAUSTED",
        details: [{
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "46.398222872s",
        }],
      },
    }];
    const fetch = createGeminiCompatibleFetch(async () => new Response(
      JSON.stringify(capturedResponse),
      { status: 429, headers: { "content-type": "application/json" } },
    ));
    const client = new OpenAI({
      apiKey: "test-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      fetch,
      maxRetries: 0,
    });

    const error = await client.chat.completions.create({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "Reply with OK." }],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenAI.RateLimitError);
    expect(error).toMatchObject({
      status: 429,
      message: expect.stringContaining("Quota exhausted"),
    });
    expect((error as { headers?: Headers }).headers?.get("retry-after")).toBe("47");
  });

  it("does not present a daily quota failure as a short retry", async () => {
    const capturedResponse = [{
      error: {
        code: 429,
        message: "Daily quota exhausted. Please retry in 49.7s.",
        status: "RESOURCE_EXHAUSTED",
        details: [{
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{
            quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
          }],
        }, {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "49.7s",
        }],
      },
    }];
    const fetch = createGeminiCompatibleFetch(async () => new Response(
      JSON.stringify(capturedResponse),
      { status: 429, headers: { "content-type": "application/json" } },
    ));

    const response = await fetch("https://example.test");

    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("x-gemini-quota-period")).toBe("day");
  });
});
