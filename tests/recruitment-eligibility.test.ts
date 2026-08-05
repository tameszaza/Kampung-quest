import { describe, expect, it } from "vitest";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { DeterministicEmbeddingProvider } from "@/server/agents/embedding-provider";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import type { CandidateProfile, QuestRun } from "@/server/domain/schemas";
import { EventCoordinator } from "@/server/features/event-coordinator";
import { RecruitmentEligibilityService } from "@/server/features/recruitment-eligibility-service";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";

const window = { start: "2026-08-10T03:00:00.000Z", end: "2026-08-10T05:00:00.000Z" };

function profile(candidateId: string, languages = ["English"]): CandidateProfile {
  return {
    candidateId,
    source: "real",
    need: "Would enjoy a healthy lunch with neighbours",
    interests: ["healthy cooking", "community"],
    offers: ["can welcome neighbours"],
    constraints: {
      availableWindows: [window],
      maximumDistanceM: 1_000,
      minimumGroupSize: 3,
      maximumGroupSize: 4,
      indoorRequired: true,
      stairsAllowed: false,
      dietaryRequirements: [],
      languages,
      verified: true,
      invitationConsent: true,
    },
    memoryStatus: "active",
    alreadyCommitted: false,
    relationshipBlocked: false,
    distanceFromInitiatorM: 300,
    previousGroupScore: 0.5,
  };
}

function understaffedRun(): QuestRun {
  const participants = ["maria", "anne"].map((candidateId, index) => ({
    candidateId,
    proposedRole: index === 0 ? "quest_host" : "recipe_guide",
    needsAddressed: ["Would enjoy a healthy lunch with neighbours"],
    contributionsUsed: ["can welcome neighbours"],
  }));
  return {
    runId: "quest_recruitment_eligibility",
    initiatingCandidateId: "maria",
    idempotencyKey: "recruitment-eligibility",
    status: "forming",
    proposal: {
      quest: {
        title: "Healthy Lunch Together",
        questType: "community_activity",
        sharedGoal: "Share a healthy lunch with neighbours.",
        description: "Prepare and enjoy lunch in an accessible public kitchen.",
        needsAddressed: ["Would enjoy a healthy lunch with neighbours"],
        durationMinutes: 90,
        groupSize: 2,
        venueRequirements: ["approved_public_location", "indoor", "no_stairs"],
        proposedTimeWindow: window,
      },
      proposedParticipants: participants,
      reserveCandidates: [],
      mutualBenefitExplanation: ["Everyone contributes and receives company."],
      confidence: 0.8,
    },
    validation: { valid: false, errors: [{ field: "groupSize", message: "Three people are required." }] },
    safety: { status: "approved", riskLevel: "low", conditions: [], requiresHumanReview: false },
    coordination: null,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

describe("open quest recruitment eligibility", () => {
  it("shows an ordinary hard-mismatch neighbour why they cannot request to join", async () => {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const sofia = profile("sofia");
    sofia.alreadyCommitted = true;
    const noor = profile("noor");
    noor.distanceFromInitiatorM = null;
    for (const candidate of [profile("maria"), profile("anne"), sofia, noor, profile("farah", ["Malay"])]) {
      await engine.recordMemory({ profile: candidate, narrative: candidate.need });
    }
    const eligibility = new RecruitmentEligibilityService(store);
    const coordinator = new EventCoordinator({
      store,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 4 }),
      assessRecruitmentCandidate: (state, userId) => eligibility.assess(state, userId),
    });
    const draft = await coordinator.createFormation(understaffedRun());
    const published = await coordinator.publishRecruitment({
      runId: draft.runId,
      actorId: "maria",
      targetGroupSize: 3,
      expectedRevision: draft.revision,
      idempotencyKey: "publish-eligible-quest",
    });

    await expect(store.saveEventCoordinationState({
      ...published,
      revision: published.revision + 1,
    }, published.revision, {
      candidateId: "sofia",
      profileVersions: [{ candidateId: "sofia", memoryVersion: 999 }],
      start: window.start,
      end: window.end,
      excludeRunId: published.runId,
    })).rejects.toThrow("profile changed during approval");

    expect((await coordinator.listActivities("sofia")).suggested.map((activity) => activity.runId)).toEqual([draft.runId]);
    const noorActivities = await coordinator.listActivities("noor");
    expect(noorActivities.suggested.map((activity) => activity.runId)).toEqual([draft.runId]);
    expect(noorActivities.suggested[0]).toHaveProperty("recruitment.viewerEligibility", {
      canRequest: false,
      notices: ["Confirm your location preferences before requesting to join."],
    });
    const noorView = await coordinator.getStateForUser(draft.runId, "noor");
    expect(noorView).toHaveProperty("viewer.recruitmentEligibility", {
      canRequest: false,
      notices: ["Confirm your location preferences before requesting to join."],
    });
    await expect(coordinator.requestToJoin({
      runId: draft.runId,
      actorId: "noor",
      expectedRevision: published.revision,
      idempotencyKey: "ineligible-noor-request",
    })).rejects.toThrow("Confirm your location preferences before requesting to join.");
    const farahActivities = await coordinator.listActivities("farah");
    expect(farahActivities.suggested.map((activity) => activity.runId)).toEqual([draft.runId]);
    expect(farahActivities.suggested[0]).toHaveProperty("recruitment.viewerEligibility", {
      canRequest: false,
      notices: ["Your profile does not currently share a group language with this quest."],
    });
  });

  it("keeps safety-excluded neighbours from discovering the recruiting quest", async () => {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const blocked = profile("liam");
    blocked.relationshipBlocked = true;
    for (const candidate of [profile("maria"), profile("anne"), blocked]) {
      await engine.recordMemory({ profile: candidate, narrative: candidate.need });
    }
    const eligibility = new RecruitmentEligibilityService(store);
    const coordinator = new EventCoordinator({
      store,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 4 }),
      assessRecruitmentCandidate: (state, userId) => eligibility.assess(state, userId),
    });
    const draft = await coordinator.createFormation(understaffedRun());
    await coordinator.publishRecruitment({
      runId: draft.runId,
      actorId: "maria",
      targetGroupSize: 3,
      expectedRevision: draft.revision,
      idempotencyKey: "publish-hidden-safety-quest",
    });

    expect((await coordinator.listActivities("liam")).suggested).toEqual([]);
    await expect(coordinator.getStateForUser(draft.runId, "liam")).rejects.toThrow("not found");
    await expect(coordinator.requestToJoin({
      runId: draft.runId,
      actorId: "liam",
      expectedRevision: 2,
      idempotencyKey: "blocked-liam-request",
    })).rejects.toThrow("You are not currently eligible for this quest");
  });
});
