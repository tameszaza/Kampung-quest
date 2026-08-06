import { describe, expect, it } from "vitest";
import { Usage, type Model, type ModelProvider, type ModelRequest } from "@openai/agents";
import {
  hostedRetrySettings,
  hostedProviderErrorMessage,
  normalizeGeminiVenueRequirements,
  HostedAgentRuntime,
} from "@/server/agents/openai-agent-runtime";

class ConversationModelProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly output: unknown) {}

  getModel(): Model {
    return {
      getResponse: async (request) => {
        this.requests.push(request);
        return {
          usage: new Usage(),
          output: [{
            type: "message" as const,
            role: "assistant" as const,
            status: "completed" as const,
            content: [{ type: "output_text" as const, text: JSON.stringify(this.output) }],
          }],
        };
      },
      getStreamedResponse: async function* () {},
    };
  }
}

describe("Gemini agent output normalization", () => {
  it.each(["weekly", "weekly_pattern", "recurring"])("normalizes a hosted recurring rule labelled %s", async (kind) => {
    const provider = new ConversationModelProvider({
      reply: "Which mornings suit you?",
      briefPatch: {
        recurringAvailabilityRules: [{
          kind,
          daysOfWeek: [1, 2, 3, 4, 5],
          startLocalTime: "09:00",
          endLocalTime: "12:00",
          timeZone: "Asia/Singapore",
          validFrom: "2026-08-06",
          validUntil: "2026-12-31",
        }],
      },
      requestedField: "availability",
      suggestedReplies: [],
      status: "collecting",
    });
    const runtime = new HostedAgentRuntime({
      provider: "gemini",
      models: { memory: "test", synthesis: "test", safety: "test", recovery: "test" },
      modelProvider: provider,
    });

    const output = await runtime.conductConversation({
      conversationId: "conversation-weekly-rule",
      messages: [],
      brief: {},
      missingFields: ["availability"],
    });

    expect(output.briefPatch.recurringAvailabilityRules?.[0]?.kind).toBe("weekly_recurrence");
    expect(provider.requests).toHaveLength(1);
  });

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
