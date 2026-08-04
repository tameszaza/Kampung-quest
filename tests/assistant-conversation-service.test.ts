import { describe, expect, it } from "vitest";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { AssistantConversationService } from "@/server/features/assistant-conversation-service";
import type { AssistantAnswer, QuestRun } from "@/server/domain/schemas";
import { InMemoryKampungStore } from "@/server/repositories/kampung-store";
import { DeterministicEmbeddingProvider } from "@/server/agents/embedding-provider";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { AssistantRecommendationService } from "@/server/features/assistant-recommendation-service";

describe("Senior Quest AI conversation", () => {
  function orchestrated(demoSeedEnabled: boolean) {
    const store = new InMemoryKampungStore();
    const agents = new DeterministicAgentRuntime();
    const engine = new KampungQuestEngine({
      store,
      agents,
      embeddings: new DeterministicEmbeddingProvider(),
    });
    return new AssistantConversationService({
      store,
      agents,
      recommendations: new AssistantRecommendationService({
        store,
        engine,
        provider: "deterministic",
        demoSeedEnabled,
      }),
    });
  }

  async function readyConversation(service: AssistantConversationService, candidateId = "maria") {
    let conversation = await service.create({ candidateId });
    const answers: AssistantAnswer[] = [
      { field: "goal", value: "I want to prepare a salad bowl with neighbours" },
      { field: "interests", value: null },
      { field: "offers", value: null },
      { field: "availability", value: { start: "2026-08-04T11:00:00.000Z", end: "2026-08-04T13:00:00.000Z" } },
      { field: "group_size", value: { minimum: 2, maximum: 4 } },
      { field: "indoor", value: true },
      { field: "stairs", value: false },
      { field: "distance", value: 1000 },
      { field: "language", value: "English" },
      { field: "consent", value: true },
    ];
    for (const [index, answer] of answers.entries()) {
      conversation = await service.addTurn(conversation.conversationId, {
        clientTurnId: `ready_${index}`,
        revision: conversation.revision,
        answer,
      });
    }
    return conversation;
  }

  it("uses agent output for the opening and follow-up turns while the server owns completeness", async () => {
    const store = new InMemoryKampungStore();
    const service = new AssistantConversationService({
      store,
      agents: new DeterministicAgentRuntime(),
    });

    const opened = await service.create({ candidateId: "maria" });
    expect(opened.messages).toHaveLength(1);
    expect(opened.messages[0]).toEqual(expect.objectContaining({ role: "assistant" }));
    expect(opened.nextField).toBe("goal");

    const answered = await service.addTurn(opened.conversationId, {
      clientTurnId: "turn_goal",
      revision: opened.revision,
      answer: { field: "goal", value: "I want to prepare a salad bowl with raw salmon." },
    });

    expect(answered.brief.currentGoal).toBe("I want to prepare a salad bowl with raw salmon.");
    expect(answered.messages.at(-1)).toEqual(expect.objectContaining({ role: "assistant" }));
    expect(answered.nextField).not.toBe("goal");
    expect(answered.status).toBe("collecting");
  });

  it("binds the confirmed conversation and quest to the authenticated member identity", async () => {
    const store = new InMemoryKampungStore();
    const agents = new DeterministicAgentRuntime();
    const engine = new KampungQuestEngine({
      store,
      agents,
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const service = new AssistantConversationService({
      store,
      agents,
      recommendations: new AssistantRecommendationService({
        store,
        engine,
        provider: "deterministic",
        demoSeedEnabled: true,
      }),
    });
    const ready = await readyConversation(service, "authenticated_user_123");

    const completed = await service.confirm(ready.conversationId, { revision: ready.revision });
    const quest = await engine.getQuest(completed.questRunId!);

    expect(completed.candidateId).toBe("authenticated_user_123");
    expect(quest?.initiatingCandidateId).toBe("authenticated_user_123");
    expect((await engine.getMemory("authenticated_user_123"))?.profile.source).toBe("real");
  });

  it("accepts different model-selected question orders for different current goals", async () => {
    class AdaptiveQuestionRuntime extends DeterministicAgentRuntime {
      override async conductConversation(
        input: Parameters<DeterministicAgentRuntime["conductConversation"]>[0],
      ): ReturnType<DeterministicAgentRuntime["conductConversation"]> {
        if (!input.brief.currentGoal) return super.conductConversation(input);
        const sportsRequest = input.brief.currentGoal.includes("NBA");
        return {
          reply: sportsRequest ? "Which language should we use for the game?" : "When would cooking suit you?",
          briefPatch: {},
          requestedField: sportsRequest ? "language" : "availability",
          suggestedReplies: [],
          status: "collecting",
        };
      }
    }
    const service = new AssistantConversationService({
      store: new InMemoryKampungStore(),
      agents: new AdaptiveQuestionRuntime(),
    });
    const sports = await service.create({ candidateId: "maria" });
    const sportsFollowUp = await service.addTurn(sports.conversationId, {
      clientTurnId: "sports_goal",
      revision: sports.revision,
      answer: { field: "goal", value: "I want to watch an NBA game" },
    });
    const cooking = await service.create({ candidateId: "maria" });
    const cookingFollowUp = await service.addTurn(cooking.conversationId, {
      clientTurnId: "cooking_goal",
      revision: cooking.revision,
      answer: { field: "goal", value: "I want to cook a salad" },
    });

    expect(sportsFollowUp.nextField).toBe("language");
    expect(cookingFollowUp.nextField).toBe("availability");
    expect(sportsFollowUp.brief.currentGoal).toContain("NBA");
    expect(cookingFollowUp.brief.currentGoal).toContain("salad");
  });

  it("persists a failed hosted turn and safely retries the same client turn", async () => {
    class FailingTurnRuntime extends DeterministicAgentRuntime {
      calls = 0;

      override async conductConversation(
        input: Parameters<DeterministicAgentRuntime["conductConversation"]>[0],
      ): ReturnType<DeterministicAgentRuntime["conductConversation"]> {
        this.calls += 1;
        if (this.calls === 2) throw new Error("Gemini request quota is temporarily exhausted");
        return super.conductConversation(input);
      }
    }
    const store = new InMemoryKampungStore();
    const service = new AssistantConversationService({ store, agents: new FailingTurnRuntime() });
    const opened = await service.create({ candidateId: "maria" });

    await expect(service.addTurn(opened.conversationId, {
      clientTurnId: "durable_turn",
      revision: opened.revision,
      answer: { field: "goal", value: "I want help preparing raw salmon safely" },
    })).rejects.toThrow("quota");

    const failed = await service.get(opened.conversationId);
    expect(failed?.brief.currentGoal).toBe("I want help preparing raw salmon safely");
    expect(failed?.messages.at(-1)).toEqual(expect.objectContaining({
      messageId: "durable_turn",
      role: "user",
    }));
    expect(failed?.error).toContain("quota");

    const retried = await service.addTurn(opened.conversationId, {
      clientTurnId: "durable_turn",
      revision: failed!.revision,
      answer: { field: "goal", value: "I want help preparing raw salmon safely" },
    });
    expect(retried.messages.filter((message) => message.messageId === "durable_turn")).toHaveLength(1);
    expect(retried.messages.at(-1)?.role).toBe("assistant");
    expect(retried.error).toBeNull();
  });

  it("does not become ready until explicit constraints and consent are present", async () => {
    const store = new InMemoryKampungStore();
    const service = new AssistantConversationService({
      store,
      agents: new DeterministicAgentRuntime(),
    });
    let conversation = await service.create({ candidateId: "maria" });

    const answers: AssistantAnswer[] = [
      { field: "goal", value: "I want to watch an NBA game with neighbours" },
      { field: "interests", value: null },
      { field: "offers", value: null },
      { field: "availability", value: { start: "2026-08-04T11:00:00.000Z", end: "2026-08-04T13:00:00.000Z" } },
      { field: "group_size", value: { minimum: 2, maximum: 4 } },
      { field: "indoor", value: true },
      { field: "stairs", value: false },
      { field: "distance", value: 1000 },
      { field: "language", value: "English" },
    ];
    for (const [index, answer] of answers.entries()) {
      conversation = await service.addTurn(conversation.conversationId, {
        clientTurnId: `turn_${index}`,
        revision: conversation.revision,
        answer,
      });
    }
    expect(conversation.status).toBe("collecting");

    conversation = await service.addTurn(conversation.conversationId, {
      clientTurnId: "turn_consent",
      revision: conversation.revision,
      answer: { field: "consent", value: true },
    });
    expect(conversation.status).toBe("ready_for_review");
  });

  it("persists truthful workflow stages while preparing a quest", async () => {
    const service = orchestrated(true);
    const ready = await readyConversation(service);
    const streamed: number[] = [];

    const completed = await service.confirm(ready.conversationId, { revision: ready.revision }, (event) => {
      streamed.push(event.sequence);
    });

    expect(completed.status).toBe("complete");
    expect(completed.questRunId).toMatch(/^quest_/);
    expect(completed.events.map((event) => event.stage)).toEqual(expect.arrayContaining([
      "brief", "memory", "retrieval", "synthesis", "validation", "safety",
    ]));
    expect(streamed).toEqual(completed.events.map((event) => event.sequence));
  });

  it("deduplicates concurrent confirmation and leaves one persisted terminal quest", async () => {
    const service = orchestrated(true);
    const ready = await readyConversation(service);

    const confirmations = await Promise.all([
      service.confirm(ready.conversationId, { revision: ready.revision }),
      service.confirm(ready.conversationId, { revision: ready.revision }),
    ]);
    const persisted = await service.get(ready.conversationId);

    expect(confirmations.every((item) => ["processing", "complete", "no_match"].includes(item.status))).toBe(true);
    expect(persisted?.status).toBe("complete");
    expect(persisted?.questRunId).toMatch(/^quest_/);
    expect(new Set(confirmations.map((item) => item.questRunId).filter(Boolean)).size).toBeLessThanOrEqual(1);
  });

  it("recovers automatically from one transient Gemini timeout during quest creation", async () => {
    class TimeoutOnceRuntime extends DeterministicAgentRuntime {
      synthesisCalls = 0;

      override async synthesizeQuest(
        input: Parameters<DeterministicAgentRuntime["synthesizeQuest"]>[0],
      ): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        this.synthesisCalls += 1;
        if (this.synthesisCalls === 1) {
          throw new Error("gemini provider unavailable: Request timed out.");
        }
        return super.synthesizeQuest(input);
      }
    }
    const store = new InMemoryKampungStore();
    const agents = new TimeoutOnceRuntime();
    const engine = new KampungQuestEngine({
      store,
      agents,
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const service = new AssistantConversationService({
      store,
      agents,
      recommendations: new AssistantRecommendationService({
        store,
        engine,
        provider: "gemini",
        demoSeedEnabled: true,
      }),
    });
    const ready = await readyConversation(service);

    const completed = await service.confirm(ready.conversationId, { revision: ready.revision });

    expect(completed.status).toBe("complete");
    expect(completed.error).toBeNull();
    expect(agents.synthesisCalls).toBe(2);
    expect(completed.events.some((event) => event.message.includes("retrying"))).toBe(true);
    expect(completed.events).toContainEqual(expect.objectContaining({
      stage: "memory",
      kind: "system",
      message: "Reusing the persisted active request for retry",
    }));
  });

  it("does not automatically retry a Gemini quota failure", async () => {
    class QuotaRuntime extends DeterministicAgentRuntime {
      synthesisCalls = 0;

      override async synthesizeQuest(): ReturnType<DeterministicAgentRuntime["synthesizeQuest"]> {
        this.synthesisCalls += 1;
        throw new Error("Gemini request quota is temporarily exhausted. Please try again later.");
      }
    }
    const store = new InMemoryKampungStore();
    const agents = new QuotaRuntime();
    const engine = new KampungQuestEngine({
      store,
      agents,
      embeddings: new DeterministicEmbeddingProvider(),
    });
    const service = new AssistantConversationService({
      store,
      agents,
      recommendations: new AssistantRecommendationService({
        store,
        engine,
        provider: "gemini",
        demoSeedEnabled: true,
      }),
    });
    const ready = await readyConversation(service);

    const failed = await service.confirm(ready.conversationId, { revision: ready.revision });

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("quota");
    expect(agents.synthesisCalls).toBe(1);
    expect(failed.events.some((event) => event.message.includes("retrying"))).toBe(false);
  });

  it("returns no_match instead of forcing a quest without eligible neighbours", async () => {
    const service = orchestrated(false);
    const ready = await readyConversation(service);

    const completed = await service.confirm(ready.conversationId, { revision: ready.revision });

    expect(completed.status).toBe("no_match");
    expect(completed.events.some((event) => event.message.includes("No strong match"))).toBe(true);
  });

  it("moves a no-match adjustment back to review without another model request", async () => {
    const service = orchestrated(false);
    const ready = await readyConversation(service);
    const noMatch = await service.confirm(ready.conversationId, { revision: ready.revision });
    expect(noMatch.status).toBe("no_match");

    const adjusted = await service.addTurn(noMatch.conversationId, {
      clientTurnId: "no-match-adjustment",
      revision: noMatch.revision,
      answer: { field: "goal", value: "I would like a gentle gardening group" },
    });

    expect(adjusted.status).toBe("ready_for_review");
    expect(adjusted.brief.currentGoal).toBe("I would like a gentle gardening group");
    expect(adjusted.messages.at(-1)?.content).toContain("review the new summary");
    expect(adjusted.error).toBeNull();
  });

  it("keeps the original no-match conversation unchanged when a later group includes the member", async () => {
    const store = new InMemoryKampungStore();
    const agents = new DeterministicAgentRuntime();
    const service = new AssistantConversationService({ store, agents });
    const conversation = await service.create({ candidateId: "maria" });
    const noMatch = await store.saveAssistantConversation({
      ...conversation,
      status: "no_match",
      brief: {
        ...conversation.brief,
        currentGoal: "A book club",
        interests: ["books"],
        offers: ["conversation"],
        availableWindows: [{ start: "2026-08-10T03:00:00.000Z", end: "2026-08-10T04:00:00.000Z" }],
        minimumGroupSize: 2,
        maximumGroupSize: 4,
        indoorRequired: true,
        stairsAllowed: true,
        maximumDistanceM: 1000,
        language: "English",
        invitationConsent: true,
      },
      revision: conversation.revision + 1,
    }, conversation.revision);
    const laterQuest: QuestRun = {
      runId: "quest-later-group",
      initiatingCandidateId: "p_2",
      idempotencyKey: "later-group",
      status: "human_review",
      proposal: {
        quest: {
          title: "Book Club Together",
          questType: "community_activity",
          sharedGoal: "Read together",
          description: "A book club at a public library.",
          needsAddressed: ["company"],
          durationMinutes: 60,
          groupSize: 3,
          venueRequirements: ["approved_public_location", "indoor"],
          proposedTimeWindow: { start: "2026-08-10T03:00:00.000Z", end: "2026-08-10T04:00:00.000Z" },
        },
        proposedParticipants: [
          { candidateId: "p_2", proposedRole: "organizer", needsAddressed: [], contributionsUsed: [] },
          { candidateId: "maria", proposedRole: "reader", needsAddressed: [], contributionsUsed: [] },
          { candidateId: "third", proposedRole: "welcomer", needsAddressed: [], contributionsUsed: [] },
        ],
        reserveCandidates: [],
        mutualBenefitExplanation: [],
        confidence: 0.8,
      },
      validation: { valid: true, errors: [] },
      safety: { status: "approved", riskLevel: "low", conditions: [], requiresHumanReview: false },
      coordination: null,
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    await store.saveQuestRun(laterQuest);

    const unchanged = await service.get(noMatch.conversationId);
    expect(unchanged?.status).toBe("no_match");
    expect(unchanged?.questRunId).toBeNull();
    expect(unchanged?.messages).toEqual(noMatch.messages);
  });
});
