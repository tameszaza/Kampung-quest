import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { CandidateProfile } from "@/server/domain/schemas";
import { DeterministicAgentRuntime } from "@/server/agents/deterministic-agent-runtime";
import { DeterministicEmbeddingProvider } from "@/server/agents/embedding-provider";
import { KampungQuestEngine } from "@/server/core/kampung-quest-engine";
import { PostgresKampungStore } from "@/server/repositories/postgres-kampung-store";

const databaseUrl = process.env.DATABASE_URL;
const store = databaseUrl ? new PostgresKampungStore(databaseUrl) : null;

function profile(candidateId: string): CandidateProfile {
  return {
    candidateId,
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
  afterAll(async () => {
    await store?.pool.end();
  });

  it("persists active memory, vectors, and quest state across engine instances", async () => {
    const suffix = randomUUID().slice(0, 8);
    const firstId = `integration_1_${suffix}`;
    const secondId = `integration_2_${suffix}`;
    const engine = new KampungQuestEngine({
      store: store!,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    await engine.recordMemory({ profile: profile(firstId), narrative: "First participant" });
    await engine.recordMemory({ profile: profile(secondId), narrative: "Second participant" });
    const run = await engine.proposeQuest({ initiatingCandidateId: firstId });

    const restartedEngine = new KampungQuestEngine({
      store: store!,
      agents: new DeterministicAgentRuntime(),
      embeddings: new DeterministicEmbeddingProvider(),
    });
    expect((await restartedEngine.getMemory(firstId))?.retrievalReady).toBe(true);
    expect((await restartedEngine.getQuest(run.runId))?.status).toBe("awaiting_acceptance");
  });
});
