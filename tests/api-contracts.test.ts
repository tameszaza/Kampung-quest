import { describe, expect, it } from "vitest";
import {
  assistantRecommendationRequestSchema,
  coordinationEventRequestSchema,
  memoryUpdateRequestSchema,
} from "@/server/domain/schemas";

const constraints = {
  availableWindows: [{ start: "2026-08-03T03:00:00.000Z", end: "2026-08-03T06:00:00.000Z" }],
  maximumDistanceM: 1000,
  minimumGroupSize: 2,
  maximumGroupSize: 4,
  indoorRequired: true,
  stairsAllowed: false,
  dietaryRequirements: [],
  languages: ["English"],
  verified: true,
  invitationConsent: true,
};

describe("version 1 request contracts", () => {
  it("accepts narrative-first and legacy memory inputs", () => {
    const narrative = memoryUpdateRequestSchema.parse({
      candidateId: "candidate_narrative",
      narrative: "Would like company for a healthy lunch",
      constraints,
    });
    const legacy = memoryUpdateRequestSchema.parse({
      candidateId: "candidate_legacy",
      need: "Would like company for a healthy lunch",
      interests: ["cooking"],
      offers: ["prepare ingredients"],
      constraints,
    });

    expect(narrative.profile.need).toBe(narrative.narrative);
    expect(narrative.providedSoftFacts).toEqual({ need: false, interests: false, offers: false });
    expect(legacy.narrative).toBe(legacy.profile.need);
  });

  it("rejects coordination events without a supported type", () => {
    expect(() => coordinationEventRequestSchema.parse({ type: "force_confirmed" })).toThrow();
  });

  it("accepts a complete assistant conversation for a member identity", () => {
    const request = {
      conversationId: "conversation_001",
      candidateId: "maria",
      narrative: "I would enjoy company over lunch.",
      interests: ["healthy cooking"],
      offers: ["can bring fruit"],
      constraints,
    };

    expect(assistantRecommendationRequestSchema.parse(request).candidateId).toBe("maria");
    expect(assistantRecommendationRequestSchema.parse({ ...request, candidateId: "another-user" }).candidateId).toBe("another-user");
  });
});
