import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { CandidateProfile } from "@/server/domain/schemas";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { DeterministicEmbeddingProvider } from "@/server/agents/embedding-provider";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { EventCoordinator } from "@/server/features/event-coordinator";
import { PostgresKampungStore } from "@/server/repositories/postgres-kampung-store";
import { AssistantConversationService } from "@/server/features/assistant-conversation-service";

const databaseUrl = process.env.DATABASE_URL;
const store = databaseUrl ? new PostgresKampungStore(databaseUrl) : null;
const integrationCandidateIds = new Set<string>();
const integrationRunIds = new Set<string>();

function profile(candidateId: string): CandidateProfile {
  return {
    candidateId,
    source: "real",
    need: "Wants companionship during lunch",
    interests: ["cooking"],
    offers: ["prepare ingredients"],
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

describe.skipIf(!store)("PostgreSQL Kampung store", () => {
  afterEach(async () => {
    if (integrationRunIds.size) {
      await store!.pool.query(
        "DELETE FROM quest.quest_runs WHERE run_id = ANY($1::text[])",
        [[...integrationRunIds]],
      );
    }
    if (integrationCandidateIds.size) {
      await store!.pool.query(
        "DELETE FROM memory.candidates WHERE candidate_id = ANY($1::text[])",
        [[...integrationCandidateIds]],
      );
    }
    integrationRunIds.clear();
    integrationCandidateIds.clear();
  });

  afterAll(async () => {
    await store?.pool.end();
  });

  it("persists active memory, vectors, and quest state across engine instances", async () => {
    const suffix = randomUUID().slice(0, 8);
    const firstId = `integration_1_${suffix}`;
    const secondId = `integration_2_${suffix}`;
    integrationCandidateIds.add(firstId);
    integrationCandidateIds.add(secondId);
    const engine = new KampungQuestEngine({
      store: store!,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      eventCoordinator: new EventCoordinator({ store: store! }),
    });
    await engine.recordMemory({ profile: profile(firstId), narrative: "First participant" });
    await engine.recordMemory({ profile: profile(secondId), narrative: "Second participant" });
    const run = await engine.proposeQuest({ initiatingCandidateId: firstId });
    integrationRunIds.add(run.runId);
    const coordinator = new EventCoordinator({ store: store! });
    let state = (await store!.findEventCoordinationState(run.runId))!;
    state = await coordinator.confirmRoster({ runId: run.runId, actorId: firstId, expectedRevision: state.revision, idempotencyKey: `integration-roster-${suffix}` });
    for (const invitation of state.invitations) {
      state = await coordinator.respondToInvitation({
        runId: run.runId,
        invitationId: invitation.invitationId,
        actorId: invitation.guestId,
        response: "accept",
        expectedRevision: state.revision,
        idempotencyKey: `integration-accept-${invitation.guestId}`,
      });
    }

    const restartedEngine = new KampungQuestEngine({
      store: store!,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    expect((await restartedEngine.getMemory(firstId))?.retrievalReady).toBe(true);
    expect((await restartedEngine.getQuest(run.runId))?.status).toBe("forming");
    const restartedCoordinator = new EventCoordinator({ store: store! });
    const persistedState = await restartedCoordinator.getStateForUser(run.runId, firstId);
    const persistedInternalState = await store!.findEventCoordinationState(run.runId);
    expect(persistedState.memberships).toHaveLength(run.proposal?.proposedParticipants.length ?? 0);
    expect(persistedInternalState?.auditEvents.length).toBeGreaterThan(1);
    expect(persistedInternalState?.outbox.length).toBeGreaterThan(0);
    const persistedRunIds = (await store!.listQuestRuns(firstId, 10)).map((item) => item.runId);
    expect(persistedRunIds).toContain(run.runId);
  });

  it("publishes an understaffed quest for recruitment", async () => {
    const suffix = randomUUID().slice(0, 8);
    const organizerId = `integration_recruiting_organizer_${suffix}`;
    const participantId = `integration_recruiting_participant_${suffix}`;
    integrationCandidateIds.add(organizerId);
    integrationCandidateIds.add(participantId);
    const language = `Integration-${suffix}`;
    const organizerProfile = profile(organizerId);
    const participantProfile = profile(participantId);
    organizerProfile.constraints.languages = [language];
    participantProfile.constraints.languages = [language];
    organizerProfile.constraints.minimumGroupSize = 3;
    participantProfile.constraints.minimumGroupSize = 3;
    const coordinator = new EventCoordinator({
      store: store!,
      resolveGroupSizeRange: async () => ({ minimum: 3, maximum: 4 }),
    });
    const engine = new KampungQuestEngine({
      store: store!,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
      eventCoordinator: coordinator,
    });
    await engine.recordMemory({ profile: organizerProfile, narrative: "Recruiting organizer" });
    await engine.recordMemory({ profile: participantProfile, narrative: "Recruiting participant" });
    const run = await engine.proposeQuest({ initiatingCandidateId: organizerId });
    integrationRunIds.add(run.runId);
    const draft = (await coordinator.getStateForUser(run.runId, organizerId))!;

    const published = await coordinator.publishRecruitment({
      runId: run.runId,
      actorId: organizerId,
      targetGroupSize: draft.roster.length + 1,
      expectedRevision: draft.revision,
      idempotencyKey: `integration-publish-recruitment-${suffix}`,
    });

    expect(published.lifecycle).toBe("recruiting");
    expect((await coordinator.getStateForUser(run.runId, organizerId))?.lifecycle).toBe("recruiting");
    await store!.hideEventSuggestion(participantId, run.runId);
    const restartedStore = new PostgresKampungStore(databaseUrl!);
    try {
      expect(await restartedStore.listHiddenEventSuggestionIds(participantId)).toContain(run.runId);
    } finally {
      await restartedStore.pool.end();
    }
  });

  it("does not let a slower older memory activation replace a newer version", async () => {
    const candidateId = `integration_order_${randomUUID().slice(0, 8)}`;
    integrationCandidateIds.add(candidateId);
    const engine = new KampungQuestEngine({
      store: store!,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile(candidateId), narrative: "Version one" });
    const olderCommand = { profile: profile(candidateId), narrative: "Version two" };
    const newerCommand = { profile: profile(candidateId), narrative: "Version three" };
    const older = await store!.beginMemoryUpdate(olderCommand);
    const newer = await store!.beginMemoryUpdate(newerCommand);
    const embeddings = new DeterministicEmbeddingProvider();
    const memory = {
      markdown: "# Current need\n\nWants companionship during lunch",
      need: newerCommand.profile.need,
      interests: newerCommand.profile.interests,
      offers: newerCommand.profile.offers,
    };

    await store!.activateMemory({
      attemptId: newer.attemptId,
      command: newerCommand,
      markdown: memory.markdown,
      version: newer.version,
      embeddings: await embeddings.embedMemory({
        candidateId,
        memoryVersion: newer.version,
        memory,
      }),
    });
    await expect(store!.activateMemory({
      attemptId: older.attemptId,
      command: olderCommand,
      markdown: memory.markdown,
      version: older.version,
      embeddings: await embeddings.embedMemory({
        candidateId,
        memoryVersion: older.version,
        memory,
      }),
    })).rejects.toThrow("Memory version conflict");

    expect((await store!.findMemory(candidateId))?.version).toBe(newer.version);
  });

  it("persists AI conversation messages and workflow-ready state across store instances", async () => {
    const service = new AssistantConversationService({
      store: store!,
      agents: new DeterministicAgentRuntime(),
    });
    const opened = await service.create({ candidateId: "maria" });
    const answered = await service.addTurn(opened.conversationId, {
      clientTurnId: `integration_turn_${randomUUID()}`,
      revision: opened.revision,
      answer: { field: "goal", value: "I want to grow herbs with neighbours" },
    });

    const restartedStore = new PostgresKampungStore(databaseUrl!);
    try {
      const restored = await restartedStore.findAssistantConversation(opened.conversationId);
      expect(restored?.revision).toBe(answered.revision);
      expect(restored?.brief.currentGoal).toBe("I want to grow herbs with neighbours");
      expect(restored?.messages).toHaveLength(3);
      expect(restored?.messages.map((message) => message.role)).toEqual([
        "assistant",
        "user",
        "assistant",
      ]);
    } finally {
      await restartedStore.pool.end();
    }
  });
});
