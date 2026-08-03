import { beforeEach, describe, expect, it } from "vitest";
import type { CandidateProfile } from "@/server/domain/schemas";
import { EventCoordinationService } from "@/server/features/coordination-service";
import { MemoryService } from "@/server/features/memory-service";
import { QuestPipeline } from "@/server/features/quest-pipeline";
import { CandidateRetrievalService } from "@/server/features/retrieval-service";
import { SafetyGuardianService } from "@/server/features/safety-service";
import { QuestSynthesisService } from "@/server/features/synthesis-service";
import { ConstraintValidator } from "@/server/features/validation-service";
import { InMemoryMemoryRepository } from "@/server/repositories/memory-repository";

const repository = new InMemoryMemoryRepository();
const memory = new MemoryService(repository);
const pipeline = new QuestPipeline(
  repository,
  new CandidateRetrievalService(repository),
  new QuestSynthesisService(),
  new ConstraintValidator(),
  new SafetyGuardianService(),
  new EventCoordinationService(),
);

function profile(candidateId: string, need: string, offer: string): CandidateProfile {
  return {
    candidateId,
    source: "real",
    need,
    interests: ["cooking", "healthy eating"],
    offers: [offer],
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

describe("quest pipeline", () => {
  beforeEach(() => repository.clear());

  it("creates markdown memory cards", () => {
    const card = memory.remember(profile("candidate_001", "Wants company for lunch", "teach cooking"));
    expect(card.markdown).toContain("# Current need");
    expect(card.markdown).toContain("candidate_001");
  });

  it("retrieves, validates, safety-checks, and coordinates a quest", () => {
    memory.remember(profile("candidate_001", "Wants companionship during a healthy lunch", "teach a recipe"));
    memory.remember(profile("candidate_002", "Wants to learn healthy lunch cooking", "prepare ingredients"));

    const result = pipeline.run("candidate_001");

    expect(result.validation.valid).toBe(true);
    expect(result.safety?.status).toBe("approved");
    expect(result.coordination?.state).toBe("awaiting_acceptance");
    expect(result.proposal.proposedParticipants).toHaveLength(2);
  });
});
