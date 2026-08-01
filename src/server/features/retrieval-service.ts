import type {
  CandidateProfile,
  RetrievalScores,
  RetrievedCandidate,
} from "@/server/domain/schemas";
import type { MemoryRepository } from "@/server/repositories/memory-repository";

export class CandidateRetrievalService {
  constructor(private readonly repository: MemoryRepository) {}

  retrieve(initiator: CandidateProfile, limit = 15): RetrievedCandidate[] {
    return this.repository
      .list()
      .map((card) => card.profile)
      .filter((candidate) => this.passesHardFilters(initiator, candidate))
      .map((profile) => ({ profile, scores: this.score(initiator, profile) }))
      .sort((left, right) => right.scores.total - left.scores.total)
      .slice(0, limit);
  }

  private passesHardFilters(initiator: CandidateProfile, candidate: CandidateProfile): boolean {
    if (
      candidate.candidateId === initiator.candidateId ||
      candidate.memoryStatus !== "active" ||
      !candidate.constraints.verified ||
      !candidate.constraints.invitationConsent ||
      candidate.alreadyCommitted ||
      candidate.relationshipBlocked
    ) {
      return false;
    }

    if (!initiator.constraints.languages.some((language) => candidate.constraints.languages.includes(language))) {
      return false;
    }

    const distance = candidate.distanceFromInitiatorM;
    return (
      distance === null ||
      distance <= Math.min(initiator.constraints.maximumDistanceM, candidate.constraints.maximumDistanceM)
    );
  }

  private score(initiator: CandidateProfile, candidate: CandidateProfile): RetrievalScores {
    const needSimilarity = this.similarity(initiator.need, candidate.need);
    const offerComplementarity = Math.max(
      this.similarity(initiator.need, candidate.offers.join(" ")),
      this.similarity(candidate.need, initiator.offers.join(" ")),
    );
    const interestSimilarity = this.similarity(initiator.interests.join(" "), candidate.interests.join(" "));
    const minimumGroupSize = Math.max(
      initiator.constraints.minimumGroupSize,
      candidate.constraints.minimumGroupSize,
    );
    const maximumGroupSize = Math.min(
      initiator.constraints.maximumGroupSize,
      candidate.constraints.maximumGroupSize,
    );
    const socialCompatibility = minimumGroupSize <= maximumGroupSize ? 1 : 0;
    const previousInteraction = candidate.previousGroupScore;
    const total =
      0.3 * needSimilarity +
      0.25 * offerComplementarity +
      0.2 * interestSimilarity +
      0.15 * socialCompatibility +
      0.1 * previousInteraction;

    return {
      needSimilarity: this.round(needSimilarity),
      offerComplementarity: this.round(offerComplementarity),
      interestSimilarity: this.round(interestSimilarity),
      socialCompatibility,
      previousInteraction,
      total: this.round(total),
    };
  }

  private similarity(left: string, right: string): number {
    const leftTokens = this.tokens(left);
    const rightTokens = this.tokens(right);
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
    const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    return overlap / new Set([...leftTokens, ...rightTokens]).size;
  }

  private tokens(value: string): Set<string> {
    return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  }

  private round(value: number): number {
    return Math.round(value * 10_000) / 10_000;
  }
}
