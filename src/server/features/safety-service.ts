import type { CandidateProfile, QuestProposal, SafetyReview } from "@/server/domain/schemas";

export class SafetyGuardianService {
  review(proposal: QuestProposal, profiles: Map<string, CandidateProfile>): SafetyReview {
    const content = `${proposal.quest.title} ${proposal.quest.description}`.toLowerCase();
    const prohibitedTerms = ["cash", "loan", "payment", "home visit", "private home"];
    const needsReview =
      prohibitedTerms.some((term) => content.includes(term)) ||
      proposal.proposedParticipants.some((participant) => !profiles.has(participant.candidateId));

    if (needsReview) {
      return {
        status: "human_review",
        riskLevel: "medium",
        conditions: ["A human coordinator must review the flagged proposal."],
        requiresHumanReview: true,
      };
    }

    return {
      status: "approved",
      riskLevel: "low",
      conditions: [
        "Do not share participant phone numbers.",
        "Ask for consent before sharing display names.",
        "Use coordinator verification at completion.",
      ],
      requiresHumanReview: false,
    };
  }
}
