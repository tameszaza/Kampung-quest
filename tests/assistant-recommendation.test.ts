import { describe, expect, it } from "vitest";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { DeterministicEmbeddingProvider } from "@/server/agents/embedding-provider";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { AssistantRecommendationService } from "@/server/features/assistant-recommendation-service";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";

describe("Senior Quest assistant recommendations", () => {
  function command() {
    return {
      conversationId: "conversation_001",
      candidateId: "maria" as const,
      narrative: "I would enjoy company over a healthy lunch.",
      interests: ["healthy cooking"],
      offers: ["I can bring fruit"],
      constraints: {
        availableWindows: [{
          start: "2026-08-03T11:00:00+08:00",
          end: "2026-08-03T14:00:00+08:00",
        }],
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
    };
  }

  function setup() {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    return {
      store,
      assistant: new AssistantRecommendationService({
        engine,
        store,
        provider: "deterministic",
        demoSeedEnabled: true,
      }),
    };
  }

  function setupWithAgents(agents: DeterministicAgentRuntime) {
    const store = new InMemoryKampungStore();
    const engine = new KampungQuestEngine({
      store,
      agents,
      embeddings: new DeterministicEmbeddingProvider(),
    });
    return {
      store,
      assistant: new AssistantRecommendationService({
        engine,
        store,
        provider: "deterministic",
        demoSeedEnabled: true,
      }),
    };
  }

  it("turns Maria's confirmed conversation into memory and a safe recommended quest", async () => {
    const { assistant } = setup();
    const result = await assistant.recommend(command());

    expect(result.provider).toBe("deterministic");
    expect(result.memory.profile.candidateId).toBe("maria");
    expect(result.memory.retrievalReady).toBe(true);
    expect(result.quest.status).toBe("awaiting_acceptance");
    expect(result.quest.validation?.valid).toBe(true);
    expect(result.quest.safety?.status).toBe("approved");
    expect(result.quest.proposal?.proposedParticipants).toContainEqual(
      expect.objectContaining({ candidateId: "maria" }),
    );
    expect(result.seededCandidateCount).toBeGreaterThanOrEqual(3);
  });

  it("returns the same memory and quest when a confirmed conversation is retried", async () => {
    const { assistant, store } = setup();

    const first = await assistant.recommend(command());
    for (let index = 0; index < 51; index += 1) {
      await assistant.recommend({
        ...command(),
        conversationId: `newer_conversation_${index}`,
      });
    }
    const versionBeforeReplay = (await store.findMemory("maria"))?.version;
    const repeated = await assistant.recommend(command());

    expect(repeated.memory.version).toBe(versionBeforeReplay);
    expect(repeated.quest.runId).toBe(first.quest.runId);
  });

  it("lists Maria's persisted recommendations without exposing another candidate's runs", async () => {
    const { assistant, store } = setup();
    await assistant.recommend(command());
    await assistant.recommend({ ...command(), conversationId: "conversation_002" });

    const mariaRuns = await store.listQuestRuns("maria", 10);
    const otherRuns = await store.listQuestRuns("demo_anne", 10);

    expect(mariaRuns).toHaveLength(2);
    expect(mariaRuns.every((run) => run.initiatingCandidateId === "maria")).toBe(true);
    expect(otherRuns).toEqual([]);
  });

  it("refreshes only rolling demo availability while keeping stable profile constraints", async () => {
    const { assistant, store } = setup();
    await assistant.recommend(command());
    const firstAnne = await store.findMemory("demo_anne");
    const later = command();
    later.conversationId = "conversation_002";
    later.constraints.availableWindows = [{
      start: "2026-08-10T06:00:00.000Z",
      end: "2026-08-10T09:00:00.000Z",
    }];
    later.constraints.languages = ["Chinese"];

    const result = await assistant.recommend(later);
    const laterAnne = await store.findMemory("demo_anne");

    expect(result.quest.status).toBe("awaiting_acceptance");
    expect(result.quest.proposal?.proposedParticipants.length).toBeGreaterThanOrEqual(2);
    expect(laterAnne?.profile.constraints.languages).toEqual(firstAnne?.profile.constraints.languages);
    expect(laterAnne?.profile.distanceFromInitiatorM).toBe(firstAnne?.profile.distanceFromInitiatorM);
    expect(laterAnne?.profile.constraints.availableWindows).toEqual(later.constraints.availableWindows);
  });

  it("makes the newest confirmed request the active need instead of blending old goals", async () => {
    const { assistant } = setup();
    await assistant.recommend(command());

    const latest = command();
    latest.conversationId = "conversation_salmon";
    latest.narrative = "I would like to make a salad bowl with raw salmon.";
    latest.interests = ["salad preparation"];
    latest.offers = ["I can bring salad ingredients"];
    const result = await assistant.recommend(latest);

    expect(result.memory.profile.need).toBe(latest.narrative);
    expect(result.quest.proposal?.quest.needsAddressed).toContain(latest.narrative);
    expect(result.quest.proposal?.quest.needsAddressed.join(" ")).not.toContain("healthy lunch");
  });

  it("does not spend agent memory requests on fixed demo neighbours", async () => {
    class CountingMemoryRuntime extends DeterministicAgentRuntime {
      memoryUpdates = 0;

      override async updateMemory(
        input: Parameters<DeterministicAgentRuntime["updateMemory"]>[0],
      ): ReturnType<DeterministicAgentRuntime["updateMemory"]> {
        this.memoryUpdates += 1;
        return super.updateMemory(input);
      }
    }

    const agents = new CountingMemoryRuntime();
    const { assistant } = setupWithAgents(agents);

    await assistant.recommend(command());
    const later = command();
    later.conversationId = "conversation_002";
    later.constraints.availableWindows = [{
      start: "2026-08-10T06:00:00.000Z",
      end: "2026-08-10T09:00:00.000Z",
    }];
    await assistant.recommend(later);

    expect(agents.memoryUpdates).toBe(2);
  });

  it("retries a failed provider attempt without creating another memory version", async () => {
    class FailingOnceRuntime extends DeterministicAgentRuntime {
      private attempts = 0;

      override async synthesizeQuest(
        input: Parameters<DeterministicAgentRuntime["synthesizeQuest"]>[0],
      ): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        this.attempts += 1;
        if (this.attempts === 1) throw new Error("Quest model unavailable");
        return super.synthesizeQuest(input);
      }
    }

    const { assistant, store } = setupWithAgents(new FailingOnceRuntime());

    await expect(assistant.recommend(command())).rejects.toThrow("Quest model unavailable");
    const failedRun = await store.findQuestByIdempotencyKey("assistant:maria:conversation_001");
    for (let index = 0; index < 51; index += 1) {
      await assistant.recommend({
        ...command(),
        conversationId: `later_conversation_${index}`,
      });
    }
    const versionBeforeRetry = (await store.findMemory("maria"))?.version;
    const recovered = await assistant.recommend(command());

    expect(recovered.quest.status).toBe("awaiting_acceptance");
    expect(recovered.quest.idempotencyKey).toBe(`assistant:maria:conversation_001:retry:${failedRun?.runId}`);
    expect(recovered.memory.version).toBe(versionBeforeRetry);
    expect(failedRun?.status).toBe("failed");
  });
});
