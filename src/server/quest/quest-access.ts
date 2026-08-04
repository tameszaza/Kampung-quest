import type { QuestRun } from "@/server/domain/schemas";

/**
 * A quest is visible to its initiator and to every proposed participant.
 * Keeping this check in one place prevents the list and detail endpoints from
 * accidentally exposing only the initiator's runs.
 */
export function canViewQuestRun(run: QuestRun, candidateId: string): boolean {
  if (run.initiatingCandidateId === candidateId) return true;
  if (run.proposal?.proposedParticipants.some((participant) => participant.candidateId === candidateId)) {
    return true;
  }
  return run.coordination?.invitations.some((invitation) => invitation.candidateId === candidateId) ?? false;
}
