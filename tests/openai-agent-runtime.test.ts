import { describe, expect, it } from "vitest";
import { AGENT_INSTRUCTIONS } from "@/server/agents/agent-instructions";
import { restoreProposalReferences } from "@/server/agents/openai-agent-runtime";
import { stableFactRef } from "@/server/agents/provider-privacy";
import type { CandidateProfile, QuestProposal } from "@/server/domain/schemas";

function profile(candidateId: string, offer: string): CandidateProfile {
  return {
    candidateId,
    source: "test",
    need: `${candidateId} needs friendly company`,
    interests: ["cooking"],
    offers: [offer],
    constraints: {
      availableWindows: [{ start: "2026-08-03T03:00:00.000Z", end: "2026-08-03T06:00:00.000Z" }],
      maximumDistanceM: 1_000,
      minimumGroupSize: 2,
      maximumGroupSize: 3,
      indoorRequired: true,
      stairsAllowed: true,
      dietaryRequirements: [],
      languages: ["English"],
      verified: true,
      invitationConsent: true,
    },
    memoryStatus: "active",
    alreadyCommitted: false,
    relationshipBlocked: false,
    distanceFromInitiatorM: 100,
    previousGroupScore: 0.5,
  };
}

function proposal(contribution: string): QuestProposal {
  return {
    quest: {
      title: "Cook together",
      questType: "community_activity",
      sharedGoal: "Cook together",
      description: "Cook a meal together in a public kitchen.",
      needsAddressed: [stableFactRef("need", "maria needs friendly company")],
      durationMinutes: 90,
      groupSize: 2,
      venueRequirements: ["approved_public_location", "indoor"],
      proposedTimeWindow: { start: "2026-08-03T03:00:00.000Z", end: "2026-08-03T04:30:00.000Z" },
    },
    proposedParticipants: [
      {
        candidateId: "p_1",
        proposedRole: "host",
        needsAddressed: [stableFactRef("need", "maria needs friendly company")],
        contributionsUsed: [stableFactRef("offer", contribution)],
      },
      { candidateId: "p_2", proposedRole: "guest", needsAddressed: [], contributionsUsed: [] },
    ],
    reserveCandidates: [],
    mutualBenefitExplanation: ["Both participants contribute."],
    confidence: 0.8,
  };
}

describe("matchmaking output contract", () => {
  it("defines an explicit contract for every hosted agent role", () => {
    expect(Object.keys(AGENT_INSTRUCTIONS)).toEqual([
      "conversation",
      "memory",
      "synthesis",
      "safety",
      "recovery",
      "taskPlan",
      "taskReassignment",
      "coordination",
    ]);
    expect(AGENT_INSTRUCTIONS.synthesis).toContain("Copy the exact ref string character-for-character");
    expect(AGENT_INSTRUCTIONS.synthesis).toContain("return no_match");
    expect(AGENT_INSTRUCTIONS.coordination).toContain("Do not reveal or speculate about any other participant");
  });

  it("accepts an exact supplied fact if a provider returns the text instead of its opaque ref", () => {
    const maria = profile("maria", "I can bring fruit");
    const anne = profile("anne", "I can teach a recipe");
    const restored = restoreProposalReferences(
      proposal("I can bring fruit"),
      new Map([["p_1", "maria"], ["p_2", "anne"]]),
      [maria, anne],
    );

    expect(restored.proposedParticipants[0]?.contributionsUsed).toEqual(["I can bring fruit"]);
  });

  it("does not leak an unknown offer fact reference when the provider returns a malformed ref", () => {
    const maria = profile("maria", "I can bring fruit");
    const anne = profile("anne", "I can teach a recipe");

    expect(() => restoreProposalReferences(
      proposal("offer_not_supplied_by_any_participant"),
      new Map([["p_1", "maria"], ["p_2", "anne"]]),
      [maria, anne],
    )).toThrow("Matchmaking could not verify the supplied participant facts");
  });
});
