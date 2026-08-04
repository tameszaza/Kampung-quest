import type { QuestRun } from "@/server/domain/schemas";
import type { IdentityStore } from "@/server/identity/identity-store";
import type { KampungStore } from "@/server/repositories/kampung-store";

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
