import { describe, expect, it } from "vitest";
import { canViewQuestRun } from "@/server/quest/quest-access";

const run = {
  runId: "quest_1",
  initiatingCandidateId: "host",
  idempotencyKey: null,
  status: "awaiting_acceptance" as const,
  proposal: {
    quest: {
      title: "A quest",
      questType: "community_activity",
      sharedGoal: "Meet neighbours",
      description: "A calm activity.",
      needsAddressed: ["companionship"],
      durationMinutes: 60,
      groupSize: 2,
      venueRequirements: [],
      proposedTimeWindow: {
        start: "2026-08-05T03:00:00.000Z",
        end: "2026-08-05T04:00:00.000Z",
      },
    },
    proposedParticipants: [
      { candidateId: "host", proposedRole: "quest_host", needsAddressed: [], contributionsUsed: [] },
      { candidateId: "matched", proposedRole: "participant", needsAddressed: [], contributionsUsed: [] },
    ],
    reserveCandidates: [],
    mutualBenefitExplanation: [],
    confidence: 0.9,
  },
  validation: null,
  safety: null,
  coordination: {
    questId: "quest_1",
    state: "awaiting_acceptance" as const,
    invitations: [{ candidateId: "matched", status: "pending" as const }],
    nextAction: "Await acceptance",
  },
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
};

describe("quest visibility", () => {
  it("allows the initiator and proposed participants, but no outsider", () => {
    expect(canViewQuestRun(run, "host")).toBe(true);
    expect(canViewQuestRun(run, "matched")).toBe(true);
    expect(canViewQuestRun(run, "outsider")).toBe(false);
  });
});
