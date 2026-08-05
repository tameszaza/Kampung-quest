import { describe, expect, it } from "vitest";
import { Usage, type Model, type ModelProvider, type ModelRequest } from "@openai/agents";
import { zodTextFormat } from "openai/helpers/zod";
import {
  coordinationProviderOutputSchema,
  normalizeCoordinationProviderOutput,
  type CoordinationProviderOutput,
} from "@/server/agents/coordination-agent-output";
import { HostedAgentRuntime } from "@/server/agents/openai-agent-runtime";

describe("coordination agent output", () => {
  it("serializes to the strict structured-output contract used by the hosted provider", () => {
    expect(() => zodTextFormat(coordinationProviderOutputSchema, "coordination_output")).not.toThrow();
  });

  it("normalizes a hosted appointment action into the domain intent", () => {
    expect(normalizeCoordinationProviderOutput(providerOutput({
      type: "change_appointment",
      appointmentPatch: {
        start: null,
        end: null,
        localTime: "15:00",
        durationMinutes: 60,
        venueName: "NTU Hall 15",
        venueAddress: null,
      },
    }))).toEqual({
      reply: "I will check that change.",
      requirementPatch: {},
      intent: {
        type: "change_appointment",
        patch: { localTime: "15:00", durationMinutes: 60, venueName: "NTU Hall 15" },
      },
    });
  });

  it("reaches the hosted model and returns its appointment action", async () => {
    const provider = new CoordinationModelProvider(providerOutput({
      type: "change_appointment",
      appointmentPatch: {
        start: null,
        end: null,
        localTime: "15:00",
        durationMinutes: null,
        venueName: "NTU Hall 15",
        venueAddress: null,
      },
    }));
    const runtime = new HostedAgentRuntime({
      provider: "gemini",
      models: { memory: "test", synthesis: "test", safety: "test", recovery: "test" },
      modelProvider: provider,
    });

    const result = await runtime.coordinateEvent({
      quest: { title: "Coffee", description: "Meet for coffee", durationMinutes: 60 },
      messages: [],
      currentRequirements: emptyRequirements(),
      currentAppointment: null,
      latestSuggestion: null,
      timeZone: "Asia/Singapore",
      scope: "group",
      latestMessage: "Move it to 3 PM at NTU Hall 15",
    });

    expect(provider.requests).toHaveLength(1);
    expect(result.intent).toEqual({
      type: "change_appointment",
      patch: { localTime: "15:00", venueName: "NTU Hall 15" },
    });
  });

  it("rejects intent fields that conflict with the selected action", () => {
    expect(() => normalizeCoordinationProviderOutput(providerOutput({
      type: "social",
      appointmentPatch: {
        start: null,
        end: null,
        localTime: "15:00",
        durationMinutes: null,
        venueName: null,
        venueAddress: null,
      },
    }))).toThrow("inconsistent fields");
  });

  it.each([
    [{ type: "social" as const }, { type: "social" }],
    [{ type: "question" as const, topic: "confirmations" as const }, { type: "question", topic: "confirmations" }],
    [{ type: "confirm_appointment" as const, appointmentVersion: 3 }, { type: "confirm_appointment", appointmentVersion: 3 }],
    [{ type: "reject_appointment" as const, appointmentVersion: 3, reason: "Too late" }, { type: "reject_appointment", appointmentVersion: 3, reason: "Too late" }],
    [{ type: "organizer_action" as const, action: "cancel" as const }, { type: "organizer_action", action: "cancel" }],
    [{ type: "unsupported" as const, reason: "Outside coordination" }, { type: "unsupported", reason: "Outside coordination" }],
  ])("normalizes the %s hosted intent", (providerIntent, expectedIntent) => {
    expect(normalizeCoordinationProviderOutput(providerOutput(providerIntent)).intent).toEqual(expectedIntent);
  });

  it("normalizes hosted requirement updates without leaking null placeholders", () => {
    const output = providerOutput({ type: "update_requirement", ambiguity: ["Which entrance?"] });
    output.requirementPatch.accessibility = ["Needs step-free access"];

    expect(normalizeCoordinationProviderOutput(output)).toMatchObject({
      requirementPatch: { accessibility: ["Needs step-free access"] },
      intent: {
        type: "update_requirement",
        patch: { accessibility: ["Needs step-free access"] },
        ambiguity: ["Which entrance?"],
      },
    });
  });
});

class CoordinationModelProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly output: ReturnType<typeof providerOutput>) {}

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

function emptyRequirements() {
  return {
    availableWindows: [],
    accessibility: [],
    travel: [],
    dietary: [],
    environmental: [],
    venuePreferences: [],
    temporaryConflicts: [],
    other: [],
  };
}

function providerOutput(intent: Partial<{
  type: "social" | "question" | "update_requirement" | "change_appointment" | "confirm_appointment" | "reject_appointment" | "organizer_action" | "unsupported";
  topic: "status" | "confirmations" | "compatibility" | "other" | null;
  appointmentPatch: {
    start: string | null;
    end: string | null;
    localTime: string | null;
    durationMinutes: number | null;
    venueName: string | null;
    venueAddress: string | null;
  } | null;
  ambiguity: string[] | null;
  referencesSuggestionId: string | null;
  appointmentVersion: number | null;
  reason: string | null;
  action: "change_roster" | "cancel" | "start" | "complete" | null;
}>): CoordinationProviderOutput {
  return {
    reply: "I will check that change.",
    requirementPatch: {
      availableWindows: null,
      accessibility: null,
      travel: null,
      dietary: null,
      environmental: null,
      venuePreferences: null,
      temporaryConflicts: null,
      other: null,
    },
    intent: {
      type: "social" as const,
      topic: null,
      appointmentPatch: null,
      ambiguity: null,
      referencesSuggestionId: null,
      appointmentVersion: null,
      reason: null,
      action: null,
      ...intent,
    },
  };
}
