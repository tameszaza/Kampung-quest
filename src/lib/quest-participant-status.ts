import type { CoordinationPlan } from "@/server/domain/schemas";

export type InvitationStatus = CoordinationPlan["invitations"][number]["status"];
export type QuestParticipantStatus = "joining" | "pending" | "invited" | "declined" | "replaced";

export function questParticipantStatus(
  candidateId: string,
  viewerId: string,
  invitationStatus?: InvitationStatus,
): { key: QuestParticipantStatus; label: string } {
  if (invitationStatus === "accepted") return { key: "joining", label: "Joining" };
  if (invitationStatus === "declined") return { key: "declined", label: "Declined" };
  if (invitationStatus === "replaced") return { key: "replaced", label: "Replaced" };
  if (invitationStatus === undefined) return { key: "pending", label: "Pending" };
  return candidateId === viewerId
    ? { key: "invited", label: "Invited" }
    : { key: "pending", label: "Pending" };
}
