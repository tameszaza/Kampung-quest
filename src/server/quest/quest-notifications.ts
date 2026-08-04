import type { QuestParticipantProfile, QuestRun } from "@/server/domain/schemas";

export type QuestNotificationKind = "suggested" | "joined" | "declined" | "status";

export interface QuestNotification {
  id: string;
  kind: QuestNotificationKind;
  title: string;
  message: string;
  createdAt: string;
  questRunId: string;
  questTitle: string;
  actor?: {
    displayName: string;
    photoUrl: string | null;
    role: string;
  };
}

/**
 * Build activity notifications from the durable quest state. Notifications
 * are intentionally read-only projections: a suggestion never creates a
 * chat message, and the list always reflects the latest invitation status.
 */
export function buildQuestNotifications(runs: QuestRun[], candidateId: string): QuestNotification[] {
  return runs
    .flatMap((run) => notificationsForRun(run, candidateId))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function notificationsForRun(run: QuestRun, candidateId: string): QuestNotification[] {
  const proposal = run.proposal;
  if (!proposal) {
    if (run.initiatingCandidateId !== candidateId || run.status !== "no_match") return [];
    return [notification(run, "status", "No match yet", "Senior Quest is still looking for a suitable activity.")];
  }

  const participant = proposal.proposedParticipants.find((item) => item.candidateId === candidateId);
  const initiator = proposal.proposedParticipants.find((item) => item.candidateId === run.initiatingCandidateId);
  const invitation = run.coordination?.invitations.find((item) => item.candidateId === candidateId);
  const notifications: QuestNotification[] = [];

  // Pending proposals are surfaced here instead of opening a chat thread.
  if (participant && run.initiatingCandidateId !== candidateId && (invitation?.status ?? "pending") === "pending") {
    notifications.push(notification(
      run,
      "suggested",
      "New activity suggestion",
      `You were matched for “${proposal.quest.title}” as ${roleName(participant.proposedRole)}.`,
      initiator,
    ));
  }

  for (const current of run.coordination?.invitations ?? []) {
    const actor = proposal.proposedParticipants.find((item) => item.candidateId === current.candidateId);
    if (!actor || current.status === "pending" || current.status === "replaced") continue;
    if (current.status === "accepted") {
      notifications.push(notification(
        run,
        "joined",
        current.candidateId === candidateId ? "You joined an activity" : "A new participant joined",
        current.candidateId === candidateId
          ? `You joined “${proposal.quest.title}” as ${roleName(actor.proposedRole)}.`
          : `${displayName(run, actor.candidateId)} joined “${proposal.quest.title}” as ${roleName(actor.proposedRole)}.`,
        actor,
        `joined-${actor.candidateId}`,
      ));
    } else if (current.status === "declined" && run.initiatingCandidateId === candidateId) {
      notifications.push(notification(
        run,
        "declined",
        "Invitation update",
        `${displayName(run, actor.candidateId)} declined “${proposal.quest.title}”.`,
        actor,
        `declined-${actor.candidateId}`,
      ));
    }
  }

  if (run.initiatingCandidateId === candidateId && run.status === "human_review") {
    notifications.push(notification(run, "status", "Safety review needed", "A coordinator is reviewing this activity before invitations can continue."));
  } else if (participant && run.status === "confirmed") {
    notifications.push(notification(run, "status", "Activity confirmed", `“${proposal.quest.title}” is ready. See the details for time and place.`));
  }

  return notifications;
}

function notification(
  run: QuestRun,
  kind: QuestNotificationKind,
  title: string,
  message: string,
  actor?: { candidateId: string; proposedRole: string },
  suffix: string = kind,
): QuestNotification {
  return {
    id: `quest-${run.runId}-${suffix}`,
    kind,
    title,
    message,
    createdAt: run.updatedAt || run.createdAt,
    questRunId: run.runId,
    questTitle: run.proposal?.quest.title ?? "Senior Quest activity",
    actor: actor ? {
      displayName: displayName(run, actor.candidateId),
      photoUrl: profileFor(run, actor.candidateId)?.photoUrl ?? null,
      role: roleName(actor.proposedRole),
    } : undefined,
  };
}

function profileFor(run: QuestRun, candidateId: string): QuestParticipantProfile | undefined {
  return run.participantProfiles?.find((profile) => profile.candidateId === candidateId);
}

function displayName(run: QuestRun, candidateId: string): string {
  return profileFor(run, candidateId)?.displayName ?? (candidateId === run.initiatingCandidateId ? "You" : "A community member");
}

function roleName(role: string): string {
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
