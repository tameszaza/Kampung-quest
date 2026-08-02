import type { QuestProposal } from "@/server/domain/schemas";

export interface InvitationAdapter {
  send(input: { runId: string; candidateId: string }): Promise<void>;
}

export interface VenueAdapter {
  confirm(input: { runId: string; proposal: QuestProposal }): Promise<{ confirmed: boolean }>;
}

export class MockInvitationAdapter implements InvitationAdapter {
  readonly sent: Array<{ runId: string; candidateId: string }> = [];

  async send(input: { runId: string; candidateId: string }): Promise<void> {
    this.sent.push(structuredClone(input));
  }
}

export class MockVenueAdapter implements VenueAdapter {
  readonly confirmations: Array<{ runId: string; proposal: QuestProposal }> = [];

  async confirm(input: { runId: string; proposal: QuestProposal }): Promise<{ confirmed: boolean }> {
    this.confirmations.push(structuredClone(input));
    return { confirmed: true };
  }
}
