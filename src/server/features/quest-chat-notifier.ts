import { format } from "node:util";
import type { QuestRun } from "@/server/domain/schemas";
import type { IdentityStore } from "@/server/identity/identity-store";
import type { KampungStore } from "@/server/repositories/kampung-store";

type QuestParticipant = NonNullable<QuestRun["proposal"]>["proposedParticipants"][number];

/**
 * Keeps the quest workflow and chat workflow loosely coupled. A failed chat
 * notification must never roll back a safety-approved quest; each delivery is
 * attempted independently and the assistant thread is updated idempotently.
 */
export class QuestChatNotifier {
  constructor(
    private readonly identityStore: IdentityStore,
    private readonly questStore: KampungStore,
  ) {}

  async questCreated(run: QuestRun): Promise<void> {
    try {
      await this.questCreatedInternal(run);
    } catch {
      // Chat delivery is deliberately non-transactional with quest creation.
    }
  }

  private async questCreatedInternal(run: QuestRun): Promise<void> {
    const proposal = run.proposal;
    if (!proposal) return;
    const participants = proposal.proposedParticipants;
    const initiator = participants.find((participant) => participant.candidateId === run.initiatingCandidateId);
    if (initiator && !isDemo(run.initiatingCandidateId)) {
      for (const participant of participants) {
        if (participant.candidateId === run.initiatingCandidateId || isDemo(participant.candidateId)) continue;
        await this.sendDirectUpdate(
          run.initiatingCandidateId,
          participant.candidateId,
          await this.matchMessage(run, participant, "Senior Quest found a match for your request."),
        );
      }
    }
    await Promise.all(participants.filter((participant) => !isDemo(participant.candidateId)).map(async (participant) =>
      this.updateAssistant(participant.candidateId, run, await this.matchMessageForRecipient(run, participant.candidateId)),
    ));
  }

  async participantAccepted(run: QuestRun, candidateId: string): Promise<void> {
    try {
      await this.participantAcceptedInternal(run, candidateId);
    } catch {
      // The coordination event is already durable; a transient chat outage
      // must not make a successful acceptance look like a failure.
    }
  }

  private async participantAcceptedInternal(run: QuestRun, candidateId: string): Promise<void> {
    const proposal = run.proposal;
    if (!proposal || isDemo(candidateId)) return;
    const accepted = proposal.proposedParticipants.find((participant) => participant.candidateId === candidateId);
    if (!accepted) return;
    const recipients = proposal.proposedParticipants
      .map((participant) => participant.candidateId)
      .filter((participantId) => participantId !== candidateId && !isDemo(participantId));
    const acceptedName = await this.displayName(candidateId);
    const role = roleName(accepted.proposedRole);
    const message = `Senior Quest update: ${acceptedName} accepted the role of ${role} for “${proposal.quest.title}” and may join the activity. Please review the updated plan.`;
    await Promise.all(recipients.map((recipientId) => this.sendDirectUpdate(candidateId, recipientId, message)));
    await Promise.all(recipients.map((recipientId) => this.updateAssistant(recipientId, run, message)));
  }

  private async sendDirectUpdate(senderId: string, recipientId: string, body: string): Promise<void> {
    try {
      const conversation = await this.identityStore.createConversation(senderId, {
        type: "direct",
        participantIds: [recipientId],
        systemInitiated: true,
      });
      await this.identityStore.sendMessage(senderId, conversation.id, body);
    } catch {
      // A blocked/deleted account should not prevent the remaining participants
      // from receiving their update.
    }
  }

  private async updateAssistant(candidateId: string, run: QuestRun, content: string): Promise<void> {
    try {
      const current = await this.questStore.findLatestAssistantConversation(candidateId);
      if (!current || current.messages.some((message) => message.messageId === assistantMessageId(run, candidateId))) return;
      // Do not interrupt an unfinished guided conversation. A no-match thread
      // is promoted to a completed result so the user can open the quest.
      if (!["no_match", "complete"].includes(current.status)) return;
      const now = new Date().toISOString();
      await this.questStore.saveAssistantConversation({
        ...current,
        status: "complete",
        revision: current.revision + 1,
        messages: [...current.messages, {
          messageId: assistantMessageId(run, candidateId),
          role: "assistant",
          content,
          createdAt: now,
        }],
        nextField: null,
        suggestedReplies: [],
        questRunId: run.runId,
        error: null,
        updatedAt: now,
      }, current.revision);
    } catch {
      // Assistant updates are best effort and are retried by the next quest
      // state transition. The direct chat remains the source of truth.
    }
  }

  private async matchMessage(run: QuestRun, participant: QuestParticipant, prefix: string): Promise<string> {
    const name = await this.displayName(participant.candidateId);
    return format(
      "%s %s can join as %s on %s. Open the quest details to review the time and safety checks.",
      prefix,
      name,
      roleName(participant.proposedRole),
      run.proposal?.quest.title ?? "this activity",
    );
  }

  private async matchMessageForRecipient(run: QuestRun, recipientId: string): Promise<string> {
    const matched = run.proposal?.proposedParticipants.find((participant) => participant.candidateId !== recipientId && !isDemo(participant.candidateId));
    if (!matched) return "Senior Quest found a match for your request. Open the quest details to review it.";
    return this.matchMessage(run, matched, "Senior Quest found a new match for your request.");
  }

  private async displayName(candidateId: string): Promise<string> {
    return (await this.identityStore.findUserById(candidateId))?.fullName ?? "A community member";
  }
}

function assistantMessageId(run: QuestRun, candidateId: string): string {
  return `quest-match-${run.runId}-${candidateId}`;
}

function isDemo(candidateId: string): boolean {
  return candidateId.startsWith("demo_");
}

function roleName(role: string): string {
  return role.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
