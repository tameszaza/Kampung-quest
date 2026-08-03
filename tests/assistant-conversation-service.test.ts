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

  async function readyConversation(service: AssistantConversationService) {
    let conversation = await service.create({ candidateId: "maria" });
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

  it("returns no_match instead of forcing a quest without eligible neighbours", async () => {
    const service = orchestrated(false);
    const ready = await readyConversation(service);

    const completed = await service.confirm(ready.conversationId, { revision: ready.revision });

    expect(completed.status).toBe("no_match");
    expect(completed.events.some((event) => event.message.includes("No strong match"))).toBe(true);
  });
});
