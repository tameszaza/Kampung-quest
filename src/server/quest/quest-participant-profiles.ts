import type { IdentityStore } from "@/server/identity/identity-store";
import type { QuestParticipantProfile, QuestRun } from "@/server/domain/schemas";

const demoNames: Record<string, string> = {
  demo_anne: "Anne",
  demo_david: "David",
  demo_john: "John",
  demo_mei: "Mei",
  demo_aisha: "Aisha",
  demo_ravi: "Ravi",
  demo_lim: "Lim",
  demo_sofia: "Sofia",
  demo_farah: "Farah",
  demo_kumar: "Kumar",
  demo_helen: "Helen",
  demo_noor: "Noor",
};

/**
 * Adds the smallest public identity snapshot needed by quest UIs. The quest
 * access check must happen before this helper is called; it never makes an
 * otherwise private quest visible.
 */
export async function withQuestParticipantProfiles(
  run: QuestRun,
  identityStore: IdentityStore,
): Promise<QuestRun> {
  if (!run.proposal) return run;
  const participantProfiles = await Promise.all(run.proposal.proposedParticipants.map(async (participant): Promise<QuestParticipantProfile> => {
    const user = participant.candidateId.startsWith("demo_")
      ? null
      : await identityStore.findUserById(participant.candidateId);
    return {
      candidateId: participant.candidateId,
      displayName: user?.fullName ?? demoNames[participant.candidateId] ?? "Community member",
      photoUrl: user?.photoUrl ?? demoPhoto(participant.candidateId),
      proposedRole: participant.proposedRole,
    };
  }));
  return { ...run, participantProfiles };
}

function demoPhoto(candidateId: string): string | null {
  const photos: Record<string, string> = {
    demo_anne: "/assets/profile-anne.jpg",
    demo_david: "/assets/profile-david.jpg",
    demo_john: "/assets/profile-john.jpg",
    demo_mei: "/assets/profile-group.jpg",
  };
  return photos[candidateId] ?? null;
}
