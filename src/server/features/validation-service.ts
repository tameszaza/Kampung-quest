import type {
  CandidateProfile,
  QuestProposal,
  ValidationErrorItem,
  ValidationResult,
} from "@/server/domain/schemas";

export class ConstraintValidator {
  validate(proposal: QuestProposal, profiles: Map<string, CandidateProfile>): ValidationResult {
    const errors: ValidationErrorItem[] = [];
    const quest = proposal.quest;
    const participantIds = proposal.proposedParticipants.map((participant) => participant.candidateId);
    const uniqueParticipantIds = new Set(participantIds);

    if (uniqueParticipantIds.size !== participantIds.length) {
      errors.push({ field: "proposedParticipants", message: "Proposed participants must be unique." });
    }
    if (quest.groupSize !== participantIds.length) {
      errors.push({ field: "groupSize", message: "Quest group size must equal the participant count." });
    }
    if (quest.durationMinutes <= 0 || quest.durationMinutes > 120) {
      errors.push({ field: "durationMinutes", message: "Quest duration must be between 1 and 120 minutes." });
    }
    const proposedIds = new Set(participantIds);
    const reserveIds = new Set<string>();
    for (const reserve of proposal.reserveCandidates) {
      if (reserveIds.has(reserve.candidateId)) {
        errors.push({
          candidateId: reserve.candidateId,
          field: "reserveCandidates",
          message: "Reserve candidates must be unique.",
        });
      }
      reserveIds.add(reserve.candidateId);
      if (proposedIds.has(reserve.candidateId)) {
        errors.push({
          candidateId: reserve.candidateId,
          field: "reserveCandidates",
          message: "A proposed participant cannot also be a reserve.",
        });
      }
      if (!profiles.has(reserve.candidateId)) {
        errors.push({
          candidateId: reserve.candidateId,
          field: "reserveCandidates",
          message: "Reserve profile was not found.",
        });
      }
    }
    const knownProposedNeeds = new Set(
      participantIds.flatMap((candidateId) => {
        const profile = profiles.get(candidateId);
        return profile ? [profile.need] : [];
      }),
    );
    for (const need of quest.needsAddressed) {
      if (!knownProposedNeeds.has(need)) {
        errors.push({
          field: "needsAddressed",
          message: "The quest referenced a need outside the proposed participants' active memories.",
        });
      }
    }

    if (!quest.venueRequirements.includes("approved_public_location")) {
      errors.push({ field: "venue", message: "A public approved venue is required." });
    }

    for (const participant of proposal.proposedParticipants) {
      const profile = profiles.get(participant.candidateId);
      if (!profile) {
        errors.push({ candidateId: participant.candidateId, field: "profile", message: "Profile was not found." });
        continue;
      }

      const constraints = profile.constraints;
      if (
        profile.memoryStatus !== "active" ||
        profile.alreadyCommitted ||
        profile.relationshipBlocked ||
        !constraints.verified ||
        !constraints.invitationConsent
      ) {
        errors.push({
          candidateId: profile.candidateId,
          field: "eligibility",
          message: "Participant is not currently eligible for an invitation.",
        });
      }
      for (const need of participant.needsAddressed) {
        if (need !== profile.need) {
          errors.push({
            candidateId: profile.candidateId,
            field: "needsAddressed",
            message: "The proposal referenced a need that is not in the participant's active memory.",
          });
        }
      }
      const knownContributions = profile.offers.length > 0
        ? profile.offers
        : ["participate and support the group"];
      for (const contribution of participant.contributionsUsed) {
        if (!knownContributions.includes(contribution)) {
          errors.push({
            candidateId: profile.candidateId,
            field: "contributionsUsed",
            message: "The proposal referenced a contribution that is not in the participant's active memory.",
          });
        }
      }
      if (quest.groupSize < constraints.minimumGroupSize || quest.groupSize > constraints.maximumGroupSize) {
        errors.push({
          candidateId: profile.candidateId,
          field: "groupSize",
          message: "Quest group size is outside the participant's limits.",
        });
      }
      if (constraints.indoorRequired && !quest.venueRequirements.includes("indoor")) {
        errors.push({ candidateId: profile.candidateId, field: "venue", message: "An indoor venue is required." });
      }
      if (!constraints.stairsAllowed && !quest.venueRequirements.includes("no_stairs")) {
        errors.push({
          candidateId: profile.candidateId,
          field: "accessibility",
          message: "A stair-free venue is required.",
        });
      }
      const available = constraints.availableWindows.some(
        (window) =>
          Date.parse(window.start) <= Date.parse(quest.proposedTimeWindow.start) &&
          Date.parse(quest.proposedTimeWindow.end) <= Date.parse(window.end),
      );
      if (!available) {
        errors.push({
          candidateId: profile.candidateId,
          field: "availability",
          message: "Proposed time is outside the participant's availability.",
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
