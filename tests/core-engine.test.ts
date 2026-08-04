import { describe, expect, it } from "vitest";
import type { CandidateProfile } from "@/server/domain/schemas";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { DeterministicEmbeddingProvider } from "@/server/agents/embedding-provider";
import type { EmbeddingProvider } from "@/server/agents/embedding-provider";
import { MockInvitationAdapter, MockVenueAdapter } from "@/server/coordination/adapters";
import { KampungQuestEngine, QUEST_IMAGE_PLACEHOLDER } from "@/server/core/kampung-quest-engine";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";
import type { QuestImageAgent } from "@/server/agents/quest-image-agent";

function profile(candidateId: string): CandidateProfile {
  return {
    candidateId,
    source: "real",
    need: "Wants companionship during a healthy lunch",
    interests: ["cooking", "healthy eating"],
    offers: ["can teach a low-sodium recipe"],
    constraints: {
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
    },
    memoryStatus: "active",
    alreadyCommitted: false,
    relationshipBlocked: false,
    distanceFromInitiatorM: null,
    previousGroupScore: 0.5,
  };
}

function withProfile(
  candidateId: string,
  overrides: Partial<CandidateProfile>,
): CandidateProfile {
  return { ...profile(candidateId), ...overrides };
}

describe("KampungQuestEngine memory", () => {
  it("activates a versioned Markdown memory only after its vectors are ready", async () => {
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });

    const first = await engine.recordMemory({
      profile: profile("candidate_001"),
      narrative: "I would enjoy meeting neighbours over a healthy lunch.",
    });
    const second = await engine.recordMemory({
      profile: profile("candidate_001"),
      narrative: "I can also help by teaching my low-sodium recipe.",
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.retrievalReady).toBe(true);
    expect(second.markdown).toContain("# Current need");
    expect((await engine.getMemory("candidate_001"))?.version).toBe(2);
  });

  it("keeps the previous memory active when indexing fails", async () => {
    const store = new InMemoryKampungStore();
    const workingEngine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await workingEngine.recordMemory({ profile: profile("candidate_001"), narrative: "Initial memory" });

    const failingEmbeddings: EmbeddingProvider = {
      embedMemory: async () => {
        throw new Error("Embedding provider unavailable");
      },
    };
    const failingEngine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: failingEmbeddings,
    });

    await expect(
      failingEngine.recordMemory({ profile: profile("candidate_001"), narrative: "Unindexed update" }),
    ).rejects.toThrow("Embedding provider unavailable");
    expect((await failingEngine.getMemory("candidate_001"))?.version).toBe(1);
  });

  it("preserves prior soft facts for a narrative-only follow-up", async () => {
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Initial memory" });
    const updated = await engine.recordMemory({
      profile: withProfile("candidate_001", { need: "Had a pleasant chat today", interests: [], offers: [] }),
      narrative: "Had a pleasant chat today",
      providedSoftFacts: { need: false, interests: false, offers: false },
    });

    expect(updated.profile.need).toBe(profile("candidate_001").need);
    expect(updated.profile.interests).toEqual(profile("candidate_001").interests);
    expect(updated.profile.offers).toEqual(profile("candidate_001").offers);
  });

  it("retrieves complementary offers while excluding ineligible candidates", async () => {
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({
      profile: withProfile("candidate_001", {
        need: "Wants help learning QR payment",
        interests: ["smartphones"],
        offers: [],
      }),
      narrative: "I want to learn QR payment.",
    });
    await engine.recordMemory({
      profile: withProfile("candidate_002", {
        need: "Wants to meet nearby neighbours",
        interests: ["smartphones"],
        offers: ["can teach smartphone and QR payment skills"],
      }),
      narrative: "I can teach QR payments.",
    });
    await engine.recordMemory({
      profile: withProfile("candidate_003", {
        need: "Wants to learn QR payment",
        constraints: { ...profile("candidate_003").constraints, verified: false },
      }),
      narrative: "This profile is not verified.",
    });

    const candidates = await engine.retrieveCandidates({ initiatingCandidateId: "candidate_001", limit: 15 });

    expect(candidates.map((candidate) => candidate.profile.candidateId)).toEqual(["candidate_002"]);
    expect(candidates[0].scores.offerComplementarity).toBeGreaterThan(0);
  });

  it("does not retrieve a candidate who already accepted an active quest", async () => {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({
      profile: withProfile("candidate_001", {
        need: "Wants help learning QR payment",
        interests: ["smartphones"],
        offers: [],
      }),
      narrative: "I want to learn QR payment.",
    });
    await engine.recordMemory({
      profile: withProfile("candidate_002", {
        need: "Wants to teach QR payment",
        interests: ["smartphones"],
        offers: ["can teach smartphone and QR payment skills"],
      }),
      narrative: "I can teach QR payments.",
    });
    await store.saveQuestRun({
      runId: "active-quest",
      initiatingCandidateId: "candidate_003",
      idempotencyKey: null,
      status: "confirmed",
      proposal: null,
      validation: null,
      safety: null,
      coordination: {
        questId: "active-quest",
        state: "confirmed",
        invitations: [{ candidateId: "candidate_002", status: "accepted" }],
        nextAction: "Complete the activity",
      },
      createdAt: "2026-08-03T03:00:00.000Z",
      updatedAt: "2026-08-03T04:00:00.000Z",
    });

    expect(await engine.retrieveCandidates({ initiatingCandidateId: "candidate_001" })).toEqual([]);
  });

  it("keeps candidates with only pending invitations eligible", async () => {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({
      profile: withProfile("candidate_001", {
        need: "Wants help learning QR payment",
        interests: ["smartphones"],
        offers: [],
      }),
      narrative: "I want to learn QR payment.",
    });
    await engine.recordMemory({
      profile: withProfile("candidate_002", {
        need: "Wants to teach QR payment",
        interests: ["smartphones"],
        offers: ["can teach smartphone and QR payment skills"],
      }),
      narrative: "I can teach QR payments.",
    });
    await store.saveQuestRun({
      runId: "pending-quest",
      initiatingCandidateId: "candidate_003",
      idempotencyKey: null,
      status: "awaiting_acceptance",
      proposal: null,
      validation: null,
      safety: null,
      coordination: {
        questId: "pending-quest",
        state: "awaiting_acceptance",
        invitations: [{ candidateId: "candidate_002", status: "pending" }],
        nextAction: "Await acceptance",
      },
      createdAt: "2026-08-03T03:00:00.000Z",
      updatedAt: "2026-08-03T04:00:00.000Z",
    });

    expect(
      (await engine.retrieveCandidates({ initiatingCandidateId: "candidate_001" }))
        .map((candidate) => candidate.profile.candidateId),
    ).toEqual(["candidate_002"]);
  });

  it("filters candidates whose group-size ranges cannot overlap", async () => {
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({
      profile: withProfile("candidate_001", {
        constraints: { ...profile("candidate_001").constraints, minimumGroupSize: 4 },
      }),
      narrative: "Prefers a group of four",
    });
    await engine.recordMemory({
      profile: withProfile("candidate_002", {
        constraints: { ...profile("candidate_002").constraints, maximumGroupSize: 3 },
      }),
      narrative: "Prefers at most three people",
    });

    expect(await engine.retrieveCandidates({ initiatingCandidateId: "candidate_001" })).toEqual([]);
  });

  it("never compares embeddings produced by different models", async () => {
    const embeddings: EmbeddingProvider = {
      async embedMemory(input) {
        const model = input.candidateId === "candidate_001" ? "model-a" : "model-b";
        return (["need", "interest", "offer"] as const).map((kind) => ({
          candidateId: input.candidateId,
          memoryVersion: input.memoryVersion,
          kind,
          model,
          dimensions: 1536,
          vector: [1, ...Array.from<number>({ length: 1535 }).fill(0)],
        }));
      },
    };
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings,
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "First model" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Second model" });

    expect(await engine.retrieveCandidates({ initiatingCandidateId: "candidate_001" })).toEqual([]);
  });

  it("persists an idempotent, validated and safety-approved quest proposal", async () => {
    const invitations = new MockInvitationAdapter();
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      invitations,
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "I want company for lunch." });
    await engine.recordMemory({
      profile: withProfile("candidate_002", {
        need: "Wants to learn healthy lunch cooking",
        offers: ["prepare ingredients"],
      }),
      narrative: "I want to learn and can prepare ingredients.",
    });

    const first = await engine.proposeQuest({
      initiatingCandidateId: "candidate_001",
      idempotencyKey: "demo-proposal-1",
    });
    const repeated = await engine.proposeQuest({
      initiatingCandidateId: "candidate_001",
      idempotencyKey: "demo-proposal-1",
    });

    expect(first.status).toBe("awaiting_acceptance");
    expect(first.validation?.valid).toBe(true);
    expect(first.safety?.status).toBe("approved");
    expect(first.coordination?.invitations).toHaveLength(2);
    expect(invitations.sent.map((invitation) => invitation.candidateId).sort()).toEqual([
      "candidate_001",
      "candidate_002",
    ]);
    expect(repeated.runId).toBe(first.runId);
    expect((await engine.getQuest(first.runId))?.runId).toBe(first.runId);
  });

  it("attaches a generated thumbnail without making image generation part of quest validity", async () => {
    const imageAgent: QuestImageAgent = {
      generate: async () => ({ bytes: Buffer.from("image"), mimeType: "image/png", model: "test" }),
    };
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      imageAgent,
      imageStorage: { save: async () => "/api/quest-images/test-image", read: async () => Buffer.from("image") },
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "I want company for lunch." });
    await engine.recordMemory({
      profile: withProfile("candidate_002", { need: "Wants to learn healthy lunch cooking", offers: ["prepare ingredients"] }),
      narrative: "I want to learn and can prepare ingredients.",
    });

    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });

    expect(run.status).toBe("awaiting_acceptance");
    expect(run.imageUrl).toBe(QUEST_IMAGE_PLACEHOLDER);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await engine.getQuest(run.runId))?.imageUrl === "/api/quest-images/test-image") break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect((await engine.getQuest(run.runId))?.imageUrl).toBe("/api/quest-images/test-image");
  });

  it("atomically reserves an idempotency key before model work", async () => {
    class CountingAgentRuntime extends DeterministicAgentRuntime {
      synthesisCalls = 0;

      override async synthesizeQuest(
        input: Parameters<DeterministicAgentRuntime["synthesizeQuest"]>[0],
      ): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        this.synthesisCalls += 1;
        return super.synthesizeQuest(input);
      }
    }
    const agents = new CountingAgentRuntime();
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents,
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Host" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Guest" });

    const [first, second] = await Promise.all([
      engine.proposeQuest({ initiatingCandidateId: "candidate_001", idempotencyKey: "concurrent-key" }),
      engine.proposeQuest({ initiatingCandidateId: "candidate_001", idempotencyKey: "concurrent-key" }),
    ]);

    expect(first.runId).toBe(second.runId);
    expect(agents.synthesisCalls).toBe(1);
  });

  it("persists a failed quest run when an agent provider fails", async () => {
    class FailingQuestAgentRuntime extends DeterministicAgentRuntime {
      override async synthesizeQuest(): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        throw new Error("Quest model unavailable");
      }
    }

    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new FailingQuestAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Lunch company" });

    await expect(engine.proposeQuest({
      initiatingCandidateId: "candidate_001",
      idempotencyKey: "failed-proposal",
    })).rejects.toThrow("Quest model unavailable");

    const replay = await engine.proposeQuest({
      initiatingCandidateId: "candidate_001",
      idempotencyKey: "failed-proposal",
    });
    expect(replay.status).toBe("failed");
  });

  it("rejects contributions invented by a quest agent", async () => {
    class InventingQuestAgentRuntime extends DeterministicAgentRuntime {
      readonly inputs: Array<Parameters<DeterministicAgentRuntime["synthesizeQuest"]>[0]> = [];

      override async synthesizeQuest(
        input: Parameters<DeterministicAgentRuntime["synthesizeQuest"]>[0],
      ): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        this.inputs.push(structuredClone(input));
        const output = await super.synthesizeQuest(input);
        if (output.outcome === "proposal") {
          output.proposal.proposedParticipants[0].contributionsUsed = ["can provide medical advice"];
        }
        return output;
      }
    }

    const agents = new InventingQuestAgentRuntime();
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents,
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Lunch company" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Healthy cooking" });

    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });

    expect(run.status).toBe("human_review");
    expect(run.validation?.errors).toContainEqual(expect.objectContaining({
      candidateId: "candidate_001",
      field: "contributionsUsed",
    }));
    expect(run.coordination).toBeNull();
    expect(agents.inputs).toHaveLength(2);
    expect(agents.inputs[1].proposalToCorrect).toBeDefined();
    expect(agents.inputs[1].validationErrors?.length).toBeGreaterThan(0);
  });

  it("returns no_match when a corrected proposal drops the confirmed active intent", async () => {
    class DriftingCorrectionRuntime extends DeterministicAgentRuntime {
      override async synthesizeQuest(
        input: Parameters<DeterministicAgentRuntime["synthesizeQuest"]>[0],
      ): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        const output = await super.synthesizeQuest(input);
        if (output.outcome !== "proposal") return output;
        if (!input.proposalToCorrect) {
          output.proposal.proposedParticipants[0].contributionsUsed = ["invented contribution"];
          return output;
        }
        output.proposal.quest.needsAddressed = output.proposal.quest.needsAddressed.filter(
          (need) => need !== input.initiator.need,
        );
        const initiatingParticipant = output.proposal.proposedParticipants.find(
          (participant) => participant.candidateId === input.initiator.candidateId,
        );
        if (initiatingParticipant) initiatingParticipant.needsAddressed = [];
        return output;
      }
    }
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DriftingCorrectionRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Lunch company" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Healthy cooking" });

    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });

    expect(run.status).toBe("no_match");
    expect(run.noMatch?.reason).toContain("current request");
    expect(run.proposal).toBeNull();
  });

  it("does not invite anyone when safety review rejects a proposal", async () => {
    class RejectingSafetyRuntime extends DeterministicAgentRuntime {
      override async reviewSafety(): ReturnType<DeterministicAgentRuntime["reviewSafety"]> {
        return {
          status: "rejected",
          riskLevel: "high",
          conditions: ["Unsafe assignment"],
          requiresHumanReview: true,
        };
      }
    }
    const invitations = new MockInvitationAdapter();
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new RejectingSafetyRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      invitations,
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Host" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Guest" });

    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });
    expect(run.status).toBe("human_review");
    expect(run.coordination).toBeNull();
    expect(invitations.sent).toEqual([]);
  });

  it("rejects duplicate participants and mismatched group counts", async () => {
    class DuplicateQuestAgentRuntime extends DeterministicAgentRuntime {
      override async synthesizeQuest(
        input: Parameters<DeterministicAgentRuntime["synthesizeQuest"]>[0],
      ): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        const output = await super.synthesizeQuest(input);
        if (output.outcome === "proposal") {
          output.proposal.proposedParticipants[1] = structuredClone(output.proposal.proposedParticipants[0]);
          output.proposal.quest.groupSize = 3;
        }
        return output;
      }
    }
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DuplicateQuestAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Host" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Guest" });

    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });
    expect(run.status).toBe("human_review");
    expect(run.validation?.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(["proposedParticipants", "groupSize"]),
    );
  });

  it("revalidates the initiating participant's current eligibility", async () => {
    const invitations = new MockInvitationAdapter();
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      invitations,
    });
    await engine.recordMemory({
      profile: withProfile("candidate_001", { alreadyCommitted: true }),
      narrative: "Already committed elsewhere",
    });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Guest" });

    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });
    expect(run.status).toBe("human_review");
    expect(run.validation?.errors).toContainEqual(expect.objectContaining({
      candidateId: "candidate_001",
      field: "eligibility",
    }));
    expect(invitations.sent).toEqual([]);
  });

  it("confirms a quest only after every proposed participant accepts", async () => {
    const venues = new MockVenueAdapter();
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      venues,
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Lunch company" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Healthy cooking" });
    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });

    const waiting = await engine.applyCoordinationEvent({
      runId: run.runId,
      type: "participant_accepted",
      candidateId: "candidate_001",
    });
    expect(waiting.status).toBe("awaiting_acceptance");
    expect(venues.confirmations).toHaveLength(0);

    const confirmed = await engine.applyCoordinationEvent({
      runId: run.runId,
      type: "participant_accepted",
      candidateId: "candidate_002",
    });

    expect(venues.confirmations).toHaveLength(1);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.coordination?.invitations.every((invitation) => invitation.status === "accepted")).toBe(true);
  });

  it("revalidates and reinvites a reserve after a participant declines", async () => {
    const invitations = new MockInvitationAdapter();
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      invitations,
    });
    const twoPersonProfile = (candidateId: string) =>
      withProfile(candidateId, {
        constraints: { ...profile(candidateId).constraints, maximumGroupSize: 2 },
      });
    await engine.recordMemory({ profile: twoPersonProfile("candidate_001"), narrative: "Host" });
    await engine.recordMemory({ profile: twoPersonProfile("candidate_002"), narrative: "First match" });
    await engine.recordMemory({ profile: twoPersonProfile("candidate_003"), narrative: "Reserve match" });
    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });
    const selectedGuest = run.proposal?.proposedParticipants.find(
      (participant) => participant.candidateId !== "candidate_001",
    );
    const reserve = run.proposal?.reserveCandidates[0];
    expect(selectedGuest).toBeDefined();
    expect(reserve).toBeDefined();

    const recovered = await engine.applyCoordinationEvent({
      runId: run.runId,
      type: "participant_declined",
      candidateId: selectedGuest?.candidateId,
    });

    expect(recovered.status).toBe("awaiting_acceptance");
    expect(recovered.proposal?.proposedParticipants.some(
      (participant) => participant.candidateId === reserve?.candidateId,
    )).toBe(true);
    expect(recovered.validation?.valid).toBe(true);
    expect(recovered.safety?.status).toBe("approved");
    expect(invitations.sent.at(-1)?.candidateId).toBe(reserve?.candidateId);

    const initiatorAccepted = await engine.applyCoordinationEvent({
      runId: run.runId,
      type: "participant_accepted",
      candidateId: "candidate_001",
    });
    expect(initiatorAccepted.status).toBe("awaiting_acceptance");
    const confirmed = await engine.applyCoordinationEvent({
      runId: run.runId,
      type: "participant_accepted",
      candidateId: reserve?.candidateId,
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.coordination?.invitations.find(
      (candidate) => candidate.candidateId === selectedGuest?.candidateId,
    )?.status).toBe("replaced");
  });

  it("rejects cancellation from a terminal state", async () => {
    const engine = new KampungQuestEngine({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile("candidate_001"), narrative: "Host" });
    await engine.recordMemory({ profile: profile("candidate_002"), narrative: "Guest" });
    const run = await engine.proposeQuest({ initiatingCandidateId: "candidate_001" });
    await engine.applyCoordinationEvent({ runId: run.runId, type: "quest_cancelled" });

    await expect(engine.applyCoordinationEvent({
      runId: run.runId,
      type: "quest_cancelled",
    })).rejects.toThrow("not valid");
  });

  it("adds a compatible third participant to an open future quest", async () => {
    const store = new InMemoryKampungStore();
    const invitations = new MockInvitationAdapter();
    const engine = new KampungQuestEngine({
      store,
      invitations,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const futureConstraints = {
      ...profile("candidate_001").constraints,
      availableWindows: [{
        start: "2026-08-06T03:00:00.000Z",
        end: "2026-08-06T06:00:00.000Z",
      }],
    };
    const shared = {
      need: "Wants companionship during a healthy lunch",
      interests: ["cooking", "healthy eating"],
      offers: ["can teach a low-sodium recipe"],
    };
    for (const candidateId of ["candidate_001", "candidate_002", "candidate_003"]) {
      await engine.recordMemory({
        profile: withProfile(candidateId, {
          ...shared,
          interests: candidateId === "candidate_003" ? [] : shared.interests,
          constraints: futureConstraints,
        }),
        narrative: shared.need,
      });
    }
    await store.saveQuestRun({
      runId: "open-future-quest",
      initiatingCandidateId: "candidate_001",
      idempotencyKey: null,
      status: "awaiting_acceptance",
      proposal: {
        quest: {
          title: "Healthy Lunch Quest",
          questType: "community_activity",
          sharedGoal: "Share a healthy lunch together.",
          description: "A friendly public lunch with a role for everyone.",
          needsAddressed: [shared.need],
          durationMinutes: 90,
          groupSize: 2,
          venueRequirements: ["approved_public_location", "indoor", "no_stairs"],
          proposedTimeWindow: {
            start: "2026-08-06T03:00:00.000Z",
            end: "2026-08-06T04:30:00.000Z",
          },
        },
        proposedParticipants: [
          {
            candidateId: "candidate_001",
            proposedRole: "quest_host",
            needsAddressed: [shared.need],
            contributionsUsed: [shared.offers[0]],
          },
          {
            candidateId: "candidate_002",
            proposedRole: "participant_1",
            needsAddressed: [shared.need],
            contributionsUsed: [shared.offers[0]],
          },
        ],
        reserveCandidates: [],
        mutualBenefitExplanation: ["Everyone shares a need and contribution."],
        confidence: 0.9,
      },
      validation: { valid: true, errors: [] },
      safety: {
        status: "approved",
        riskLevel: "low",
        conditions: [],
        requiresHumanReview: false,
      },
      coordination: {
        questId: "open-future-quest",
        state: "awaiting_acceptance",
        invitations: [
          { candidateId: "candidate_001", status: "pending" },
          { candidateId: "candidate_002", status: "pending" },
        ],
        nextAction: "Collect acceptance.",
      },
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    });

    const excluded = await engine.joinOpenQuest(
      "candidate_003",
      "assistant:candidate_003:conversation_004",
      undefined,
      { excludedRunIds: new Set(["open-future-quest"]) },
    );
    expect(excluded).toBeNull();

    const joined = await engine.joinOpenQuest("candidate_003", "assistant:candidate_003:conversation_003");

    expect(joined?.runId).toBe("open-future-quest");
    expect(joined?.status).toBe("awaiting_acceptance");
    expect(joined?.proposal?.quest.groupSize).toBe(3);
    expect(joined?.proposal?.proposedParticipants.map((participant) => participant.candidateId))
      .toEqual(["candidate_001", "candidate_002", "candidate_003"]);
    expect(joined?.coordination?.invitations).toContainEqual({ candidateId: "candidate_003", status: "pending" });
    expect(invitations.sent).toContainEqual({ runId: "open-future-quest", candidateId: "candidate_003" });
    expect((await store.findQuestByIdempotencyKey("assistant:candidate_003:conversation_003"))?.runId)
      .toBe("open-future-quest");
  });

  it("does not add a participant after an activity has started", async () => {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const future = withProfile("candidate_001", {
      constraints: {
        ...profile("candidate_001").constraints,
        availableWindows: [{
          start: "2026-08-03T03:00:00.000Z",
          end: "2026-08-03T06:00:00.000Z",
        }],
      },
    });
    await engine.recordMemory({ profile: future, narrative: future.need });
    await engine.recordMemory({ profile: withProfile("candidate_002", { constraints: future.constraints }), narrative: future.need });
    await engine.recordMemory({ profile: withProfile("candidate_003", { constraints: future.constraints }), narrative: future.need });
    await store.saveQuestRun({
      runId: "past-quest",
      initiatingCandidateId: "candidate_001",
      idempotencyKey: null,
      status: "awaiting_acceptance",
      proposal: {
        quest: {
          title: "Past Quest",
          questType: "community_activity",
          sharedGoal: "Meet neighbours.",
          description: "A past activity.",
          needsAddressed: [future.need],
          durationMinutes: 60,
          groupSize: 2,
          venueRequirements: ["approved_public_location"],
          proposedTimeWindow: { start: "2026-08-03T03:00:00.000Z", end: "2026-08-03T04:00:00.000Z" },
        },
        proposedParticipants: [
          { candidateId: "candidate_001", proposedRole: "quest_host", needsAddressed: [future.need], contributionsUsed: [future.offers[0]] },
          { candidateId: "candidate_002", proposedRole: "participant_1", needsAddressed: [future.need], contributionsUsed: [future.offers[0]] },
        ],
        reserveCandidates: [],
        mutualBenefitExplanation: [],
        confidence: 0.8,
      },
      validation: { valid: true, errors: [] },
      safety: null,
      coordination: {
        questId: "past-quest",
        state: "awaiting_acceptance",
        invitations: [{ candidateId: "candidate_001", status: "pending" }, { candidateId: "candidate_002", status: "pending" }],
        nextAction: "Collect acceptance.",
      },
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });

    expect(await engine.joinOpenQuest("candidate_003")).toBeNull();
  });
});
