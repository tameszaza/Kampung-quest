import type { EventCoordinationState, EventRecruitmentAssessment } from "@/server/domain/event-coordination";
import type { KampungStore } from "@/server/repositories/kampung-store";

export class RecruitmentEligibilityService {
  constructor(private readonly store: KampungStore) {}

  async assess(state: EventCoordinationState, userId: string): Promise<EventRecruitmentAssessment> {
    if (state.initiatorId === userId || state.roster.some((member) => member.userId === userId)) {
      return { eligible: false, reason: "This person is already in the proposed group." };
    }
    if (state.roster.length >= state.recruitment.targetGroupSize
      || state.roster.length >= state.recruitment.maximumGroupSize) {
      return { eligible: false, reason: "This quest has reached its recruitment capacity." };
    }

    const [candidateMemory, organizerMemory, memories, commitments] = await Promise.all([
      this.store.findMemory(userId),
      this.store.findMemory(state.initiatorId),
      this.store.listMemories(),
      this.store.listAcceptedCommitments(),
    ]);
    const candidate = candidateMemory?.profile;
    const organizer = organizerMemory?.profile;
    if (!candidate || !organizer) return { eligible: false, reason: "An active participant profile could not be verified." };
    if (candidate.memoryStatus !== "active"
      || candidate.relationshipBlocked
      || !candidate.constraints.verified
      || !candidate.constraints.invitationConsent) {
      return { eligible: false, reason: "The applicant's active profile, consent, or participation status changed." };
    }

    const memoryByCandidate = new Map(memories.map((memory) => [memory.profile.candidateId, memory]));
    const profiles = new Map(memories.map((memory) => [memory.profile.candidateId, memory.profile]));
    const rosterProfiles = state.roster.map((member) => profiles.get(member.userId));
    if (rosterProfiles.some((profile) => !profile)) {
      return { eligible: false, reason: "A current roster member's profile could not be verified." };
    }
    const target = state.recruitment.targetGroupSize;
    if ([candidate, ...rosterProfiles].some((profile) => profile
      && (target < profile.constraints.minimumGroupSize || target > profile.constraints.maximumGroupSize))) {
      return { eligible: false, reason: "The recruitment target no longer fits everyone's group-size limits." };
    }
    if (![candidate, ...rosterProfiles].every((profile) => profile
      && profile.constraints.languages.some((language) => candidate.constraints.languages.includes(language)))) {
      return { eligible: false, reason: "The applicant no longer shares a suitable group language." };
    }

    const distance = candidate.distanceFromInitiatorM;
    if (distance === null) {
      return { eligible: false, reason: "The applicant's distance from this quest could not be verified." };
    }
    if (distance > Math.min(organizer.constraints.maximumDistanceM, candidate.constraints.maximumDistanceM)) {
      return { eligible: false, reason: "The quest is now outside the applicant's travel distance." };
    }
    if (candidate.constraints.indoorRequired && !state.proposal.quest.venueRequirements.includes("indoor")) {
      return { eligible: false, reason: "The quest no longer meets the applicant's indoor requirement." };
    }
    if (!candidate.constraints.stairsAllowed && !state.proposal.quest.venueRequirements.includes("no_stairs")) {
      return { eligible: false, reason: "The quest no longer meets the applicant's stair-free access requirement." };
    }
    const proposed = state.proposal.quest.proposedTimeWindow;
    if (!candidate.constraints.availableWindows.some((window) =>
      Date.parse(window.start) <= Date.parse(proposed.start) && Date.parse(window.end) >= Date.parse(proposed.end))) {
      return { eligible: false, reason: "The applicant's availability no longer includes this quest window." };
    }
    if (commitments.some((commitment) => commitment.candidateId === userId
      && (commitment.start === null || commitment.end === null
        || (Date.parse(commitment.start) < Date.parse(proposed.end)
          && Date.parse(commitment.end) > Date.parse(proposed.start))))) {
      return { eligible: false, reason: "The applicant now has an overlapping active commitment." };
    }

    const score = this.relevanceScore(state, candidate.need, candidate.interests, candidate.offers);
    return {
      eligible: true,
      candidate: {
        participant: {
          candidateId: userId,
          proposedRole: "supporting_participant",
          needsAddressed: [candidate.need],
          contributionsUsed: [candidate.offers[0] ?? "participate and support the group"],
        },
        explanation: ["Compatible availability, access needs, location, language, and group preferences"],
        score,
        eligibilityGuard: {
          candidateId: userId,
          profileVersions: [...new Set([userId, state.initiatorId, ...state.roster.map((member) => member.userId)])]
            .map((candidateId) => {
              const memory = candidateId === userId
                ? candidateMemory
                : candidateId === state.initiatorId ? organizerMemory : memoryByCandidate.get(candidateId);
              return { candidateId, memoryVersion: memory!.version };
            }),
          start: proposed.start,
          end: proposed.end,
          excludeRunId: state.runId,
        },
      },
    };
  }

  private relevanceScore(
    state: EventCoordinationState,
    need: string,
    interests: string[],
    offers: string[],
  ): number {
    const questTokens = this.tokens([
      state.proposal.quest.title,
      state.proposal.quest.description,
      state.proposal.quest.sharedGoal,
    ].join(" "));
    const candidateTokens = this.tokens([need, ...interests, ...offers].join(" "));
    if (!questTokens.size || !candidateTokens.size) return 0;
    const overlap = [...candidateTokens].filter((token) => questTokens.has(token)).length;
    return overlap / new Set([...questTokens, ...candidateTokens]).size;
  }

  private tokens(value: string): Set<string> {
    return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  }
}
