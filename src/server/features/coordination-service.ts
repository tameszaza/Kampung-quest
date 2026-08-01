import { randomUUID } from "node:crypto";
import type { CoordinationPlan, QuestProposal, SafetyReview } from "@/server/domain/schemas";

export class EventCoordinationService {
  prepare(proposal: QuestProposal, safety: SafetyReview): CoordinationPlan | null {
    if (safety.status !== "approved") return null;

    return {
      questId: `quest_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      state: "awaiting_acceptance",
      invitations: proposal.proposedParticipants.map((participant) => ({
        candidateId: participant.candidateId,
        status: "pending",
      })),
      nextAction: "Collect explicit acceptance, then confirm the venue and exact schedule.",
    };
  }
}
