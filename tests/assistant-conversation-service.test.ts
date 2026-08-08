import { describe, expect, it } from "vitest";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { AssistantConversationService } from "@/server/features/assistant-conversation-service";
import type { AssistantAnswer } from "@/server/domain/schemas";
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

  it("retrieves saved accessibility defaults and skips those questions", async () => {
    const service = new AssistantConversationService({
      store: new InMemoryKampungStore(),
      agents: new DeterministicAgentRuntime(),
      resolveAccessibilityPreferences: async () => ({ stairsAllowed: false, maximumDistanceM: 1000, language: "English" }),
    });
    let conversation = await service.create({ candidateId: "maria" });
    expect(conversation.brief).toMatchObject({ stairsAllowed: false, maximumDistanceM: 1000, language: "English" });

    const answers: AssistantAnswer[] = [
      { field: "goal", value: "I want to join a gentle book club" },
      { field: "interests", value: null },
      { field: "offers", value: null },
      { field: "availability", value: { start: "2026-08-04T11:00:00.000Z", end: "2026-08-04T13:00:00.000Z" } },
      { field: "group_size", value: { minimum: 2, maximum: 4 } },
      { field: "indoor", value: true },
      { field: "consent", value: true },
    ];
    for (const [index, answer] of answers.entries()) {
      conversation = await service.addTurn(conversation.conversationId, {
        clientTurnId: `saved-accessibility-${index}`,
        revision: conversation.revision,
        answer,
      });
    }

    expect(conversation.status).toBe("ready_for_review");
    expect(conversation.brief.stairsAllowed).toBe(false);
    expect(conversation.brief.maximumDistanceM).toBe(1000);
    expect(conversation.brief.language).toBe("English");
    expect(conversation.messages.some((message) => /stairs|distance|language/i.test(message.content))).toBe(false);
  });

  it("keeps working when preference retrieval fails and asks again after defaults are unset", async () => {
    const store = new InMemoryKampungStore();
    const unavailable = new AssistantConversationService({
      store,
      agents: new DeterministicAgentRuntime(),
      resolveAccessibilityPreferences: async () => { throw new Error("preference store unavailable"); },
    });
    await expect(unavailable.create({ candidateId: "maria" })).resolves.toMatchObject({ nextField: "goal" });

    const cleared = new AssistantConversationService({
      store,
      agents: new DeterministicAgentRuntime(),
      resolveAccessibilityPreferences: async () => ({ stairsAllowed: null, maximumDistanceM: null, language: null }),
    });
    let conversation = await cleared.create({ candidateId: "maria" });
    const answers: AssistantAnswer[] = [
      { field: "goal", value: "I want to join a gentle book club" },
      { field: "interests", value: null },
      { field: "offers", value: null },
      { field: "availability", value: { start: "2026-08-04T11:00:00.000Z", end: "2026-08-04T13:00:00.000Z" } },
      { field: "group_size", value: { minimum: 2, maximum: 4 } },
      { field: "indoor", value: true },
    ];
    for (const [index, answer] of answers.entries()) {
      conversation = await cleared.addTurn(conversation.conversationId, {
        clientTurnId: `cleared-accessibility-${index}`,
        revision: conversation.revision,
        answer,
      });
    }
    expect(conversation.nextField).toBe("stairs");
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

  it("does not treat a consent reply as a new current request", async () => {
    class MislabelingRuntime extends DeterministicAgentRuntime {
      override async conductConversation(
        input: Parameters<DeterministicAgentRuntime["conductConversation"]>[0],
      ): ReturnType<DeterministicAgentRuntime["conductConversation"]> {
        const output = await super.conductConversation(input);
        return { ...output, briefPatch: { currentGoal: "yes" } };
      }
    }

    const service = new AssistantConversationService({
      store: new InMemoryKampungStore(),
      agents: new MislabelingRuntime(),
    });
    const opened = await service.create({ candidateId: "maria" });
    const answered = await service.addTurn(opened.conversationId, {
      clientTurnId: "consent-before-goal",
      revision: opened.revision,
      answer: { field: "consent", value: false },
    });

    expect(answered.brief.currentGoal).toBeUndefined();
    expect(answered.brief.invitationConsent).toBe(false);
    expect(answered.nextField).toBe("goal");
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

  it("returns an organizer-only recruitment draft when no eligible neighbour is available yet", async () => {
    const service = orchestrated(false);
    const ready = await readyConversation(service);

    const completed = await service.confirm(ready.conversationId, { revision: ready.revision });

    expect(completed.status).toBe("complete");
    expect(completed.questRunId).not.toBeNull();
    expect(completed.events.some((event) => event.message.includes("recruiting the remaining group"))).toBe(true);
  });
});
