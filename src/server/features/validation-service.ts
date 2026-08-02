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
      if (!constraints.verified || !constraints.invitationConsent) {
        errors.push({
          candidateId: profile.candidateId,
          field: "eligibility",
          message: "Participant is not verified or has not consented to invitations.",
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
