import type { EventCoordinationState, EventRecruitmentAssessment } from "@/server/domain/event-coordination";
import type { KampungStore } from "@/server/repositories/kampung-store";

export class RecruitmentEligibilityService {
  constructor(private readonly store: KampungStore) {}

  async assess(state: EventCoordinationState, userId: string): Promise<EventRecruitmentAssessment> {
    if (state.initiatorId === userId || state.roster.some((member) => member.userId === userId)) {
      return this.hidden("This person is already in the proposed group.");
    }
    if (state.roster.length >= state.recruitment.targetGroupSize
      || state.roster.length >= state.recruitment.maximumGroupSize) {
      return this.hidden("This quest has reached its recruitment capacity.");
    }

    const [candidateMemory, organizerMemory, memories, commitments] = await Promise.all([
      this.store.findMemory(userId),
      this.store.findMemory(state.initiatorId),
      this.store.listMemories(),
      this.store.listAcceptedCommitments(),
    ]);
    const candidate = candidateMemory?.profile;
    const organizer = organizerMemory?.profile;
    if (!candidate || !organizer) return this.hidden("An active participant profile could not be verified.");
    if (candidate.memoryStatus !== "active"
      || candidate.relationshipBlocked
      || !candidate.constraints.verified) {
      return this.hidden("The applicant's active profile or participation status changed.");
    }

    const memoryByCandidate = new Map(memories.map((memory) => [memory.profile.candidateId, memory]));
    const profiles = new Map(memories.map((memory) => [memory.profile.candidateId, memory.profile]));
    const rosterProfiles = state.roster.map((member) => profiles.get(member.userId));
    if (rosterProfiles.some((profile) => !profile)) {
      return this.hidden("A current roster member's profile could not be verified.");
    }
    if ([organizer, ...rosterProfiles].some((profile) => profile
      && (profile.memoryStatus !== "active"
        || profile.relationshipBlocked
        || !profile.constraints.verified
        || !profile.constraints.invitationConsent))) {
      return this.hidden("The current group is no longer available for public recruitment.");
    }
    const target = state.recruitment.targetGroupSize;
    if (rosterProfiles.some((profile) => profile
      && (target < profile.constraints.minimumGroupSize || target > profile.constraints.maximumGroupSize))) {
      return this.hidden("The recruitment target no longer fits the current group's limits.");
    }
    const notices: string[] = [];
    if (!candidate.constraints.invitationConsent) {
      notices.push("Enable activity invitations in your profile before requesting to join.");
    }
    if (target < candidate.constraints.minimumGroupSize || target > candidate.constraints.maximumGroupSize) {
      notices.push("This quest's target size is outside your group-size preference.");
    }
    if (![candidate, ...rosterProfiles].every((profile) => profile
      && profile.constraints.languages.some((language) => candidate.constraints.languages.includes(language)))) {
      notices.push("This quest's group-language requirements do not match your profile.");
    }

    const distance = candidate.distanceFromInitiatorM;
    if (distance === null) {
      notices.push("Confirm your location preferences before requesting to join.");
    } else if (distance > Math.min(organizer.constraints.maximumDistanceM, candidate.constraints.maximumDistanceM)) {
      notices.push("This quest's travel range is not compatible with your profile.");
    }
    if (candidate.constraints.indoorRequired && !state.proposal.quest.venueRequirements.includes("indoor")) {
      notices.push("This quest does not meet your indoor venue requirement.");
    }
    if (!candidate.constraints.stairsAllowed && !state.proposal.quest.venueRequirements.includes("no_stairs")) {
      notices.push("This quest does not currently confirm step-free access.");
    }
    const proposed = state.proposal.quest.proposedTimeWindow;
    if (!candidate.constraints.availableWindows.some((window) =>
      Date.parse(window.start) <= Date.parse(proposed.start) && Date.parse(window.end) >= Date.parse(proposed.end))) {
      notices.push("Your availability does not include this quest's provisional time.");
    }
    if (commitments.some((commitment) => commitment.candidateId === userId
      && (commitment.start === null || commitment.end === null
        || (Date.parse(commitment.start) < Date.parse(proposed.end)
          && Date.parse(commitment.end) > Date.parse(proposed.start))))) {
      notices.push("You already have an activity that overlaps this quest's provisional time.");
    }
    if (notices.length) return { eligible: false, discoverable: true, reason: notices[0], notices };

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

  private hidden(reason: string): EventRecruitmentAssessment {
    return { eligible: false, discoverable: false, reason, notices: [] };
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
