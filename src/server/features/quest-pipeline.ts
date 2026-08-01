import type { CandidateProfile, PipelineResult } from "@/server/domain/schemas";
import type { MemoryRepository } from "@/server/repositories/memory-repository";
import { EventCoordinationService } from "./coordination-service";
import { CandidateRetrievalService } from "./retrieval-service";
import { SafetyGuardianService } from "./safety-service";
import { QuestSynthesisService } from "./synthesis-service";
import { ConstraintValidator } from "./validation-service";

export class QuestPipeline {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly retrieval: CandidateRetrievalService,
    private readonly synthesis: QuestSynthesisService,
    private readonly validator: ConstraintValidator,
    private readonly safety: SafetyGuardianService,
    private readonly coordination: EventCoordinationService,
  ) {}

  run(initiatingCandidateId: string, candidateLimit = 15): PipelineResult {
    const card = this.repository.find(initiatingCandidateId);
    if (!card) throw new Error("Initiating candidate was not found");

    const candidates = this.retrieval.retrieve(card.profile, candidateLimit);
    const proposal = this.synthesis.synthesize(card.profile, candidates);
    const profiles = new Map<string, CandidateProfile>(
      this.repository.list().map((stored) => [stored.profile.candidateId, stored.profile]),
    );
    const validation = this.validator.validate(proposal, profiles);
    if (!validation.valid) return { proposal, validation, safety: null, coordination: null };

    const safety = this.safety.review(proposal, profiles);
    return {
      proposal,
      validation,
      safety,
      coordination: this.coordination.prepare(proposal, safety),
    };
  }
}
