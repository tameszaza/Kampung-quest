import { describe, expect, it, vi } from "vitest";
import { Usage, type Model, type ModelProvider, type ModelRequest } from "@openai/agents";
import {
  hostedRetrySettings,
  hostedProviderErrorMessage,
  normalizeHostedLocalTime,
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
  it.each([
    ["9:00 AM", "09:00"],
    ["12:00 PM", "12:00"],
    ["12:00 AM", "00:00"],
  ])("normalizes local time %s to %s", (input, expected) => {
    expect(normalizeHostedLocalTime(input)).toBe(expected);
  });

  it.each(["weekly", "weekly_pattern", "recurring"])("normalizes a hosted recurring rule labelled %s", async (kind) => {
    const provider = new ConversationModelProvider({
      reply: "Which mornings suit you?",
      briefPatch: {
        recurringAvailabilityRules: [{
          kind,
          daysOfWeek: [1, 2, 3, 4, 5],
          startLocalTime: "9:00 AM",
          endLocalTime: "12 PM",
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
    expect(output.briefPatch.recurringAvailabilityRules?.[0]?.startLocalTime).toBe("09:00");
    expect(output.briefPatch.recurringAvailabilityRules?.[0]?.endLocalTime).toBe("12:00");
    expect(provider.requests).toHaveLength(1);
  });

  it("recovers from a malformed optional recurring rule without pausing the conversation", async () => {
    const provider = new ConversationModelProvider({
      reply: "Which mornings suit you?",
      briefPatch: {
        recurringAvailabilityRules: [{
          kind: "weekly_recurrence",
          daysOfWeek: [1],
          startLocalTime: "morning",
          endLocalTime: "12 PM",
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
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const output = await runtime.conductConversation({
        conversationId: "conversation-invalid-output",
        messages: [],
        brief: {},
        missingFields: ["availability"],
      });
      expect(output.briefPatch.recurringAvailabilityRules).toBeUndefined();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("ignores a short model goal because the user's answer is authoritative", async () => {
    const provider = new ConversationModelProvider({
      reply: "What would you like to do?",
      briefPatch: { currentGoal: "ok" },
      requestedField: "goal",
      suggestedReplies: [],
      status: "collecting",
    });
    const runtime = new HostedAgentRuntime({
      provider: "gemini",
      models: { memory: "test", synthesis: "test", safety: "test", recovery: "test" },
      modelProvider: provider,
    });

    const output = await runtime.conductConversation({
      conversationId: "conversation-short-goal",
      messages: [],
      brief: {},
      missingFields: ["goal"],
    });

    expect(output.briefPatch.currentGoal).toBeUndefined();
  });

  it("normalizes 12-hour recurring times to the server's HH:mm contract", async () => {
    const provider = new ConversationModelProvider({
      reply: "Weekday mornings work.",
      briefPatch: {
        recurringAvailabilityRules: [{
          kind: "weekly",
          daysOfWeek: [1, 2, 3, 4, 5],
          startLocalTime: "9:00 AM",
          endLocalTime: "12:00 PM",
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
      conversationId: "conversation-twelve-hour-times",
      messages: [],
      brief: {},
      missingFields: ["availability"],
    });

    expect(output.briefPatch.recurringAvailabilityRules?.[0]).toMatchObject({
      startLocalTime: "09:00",
      endLocalTime: "12:00",
    });
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
