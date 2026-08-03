import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "@/server/agents/agent-runtime";
import { stableFactRef } from "@/server/agents/provider-privacy";
import type { EmbeddingProvider } from "@/server/agents/embedding-provider";
import {
  MockInvitationAdapter,
  MockVenueAdapter,
  type InvitationAdapter,
  type VenueAdapter,
} from "@/server/coordination/adapters";
import type {
  CandidateProfile,
  CoordinationEventCommand,
  MemoryAgentOutput,
  MemoryCard,
  MemoryUpdateCommand,
  ProposeQuestCommand,
  QuestRun,
  RetrievedCandidate,
  RetrievalCommand,
} from "@/server/domain/schemas";
import { ConstraintValidator } from "@/server/features/validation-service";
import type { KampungStore } from "@/server/repositories/kampung-store";

interface KampungQuestEngineDependencies {
  store: KampungStore;
  agents: AgentRuntime;
  embeddings: EmbeddingProvider;
  invitations?: InvitationAdapter;
  venues?: VenueAdapter;
}

export interface QuestPipelineEvent {
  stage: "retrieval" | "synthesis" | "validation" | "safety";
  status: "started" | "completed" | "failed";
  message: string;
  kind: "agent" | "system";
}

export type QuestPipelineObserver = (event: QuestPipelineEvent) => Promise<void> | void;

export class KampungQuestEngine {
  private readonly validator = new ConstraintValidator();
  private readonly invitations: InvitationAdapter;
  private readonly venues: VenueAdapter;

  constructor(private readonly dependencies: KampungQuestEngineDependencies) {
    this.invitations = dependencies.invitations ?? new MockInvitationAdapter();
    this.venues = dependencies.venues ?? new MockVenueAdapter();
  }

  async recordMemory(command: MemoryUpdateCommand): Promise<MemoryCard> {
    return this.recordMemoryOutput(command, (currentMemory) =>
      this.dependencies.agents.updateMemory({
        ...command,
        currentMemory,
      })
    );
  }

  async recordPreparedMemory(
    command: MemoryUpdateCommand,
    memory: MemoryAgentOutput,
  ): Promise<MemoryCard> {
    return this.recordMemoryOutput(command, async () => memory);
  }

  private async recordMemoryOutput(
    command: MemoryUpdateCommand,
    createMemory: (currentMemory: MemoryCard | null) => Promise<MemoryAgentOutput>,
  ): Promise<MemoryCard> {
    const attempt = await this.dependencies.store.beginMemoryUpdate(command);
    try {
      const generated = await createMemory(attempt.currentMemory);
      const memory: MemoryAgentOutput = {
        ...generated,
        need: command.providedSoftFacts?.need ? command.profile.need : generated.need,
        interests: command.providedSoftFacts?.interests ? command.profile.interests : generated.interests,
        offers: command.providedSoftFacts?.offers ? command.profile.offers : generated.offers,
      };
      const embeddings = await this.dependencies.embeddings.embedMemory({
        candidateId: command.profile.candidateId,
        memoryVersion: attempt.version,
        memory,
      });

      return this.dependencies.store.activateMemory({
        attemptId: attempt.attemptId,
        command: {
          ...command,
          profile: {
            ...command.profile,
            need: memory.need,
            interests: memory.interests,
            offers: memory.offers,
          },
        },
        markdown: memory.markdown,
        version: attempt.version,
        embeddings,
      });
    } catch (error) {
      await this.dependencies.store.failMemoryUpdate(
        attempt.attemptId,
        error instanceof Error ? error.message : "Unknown memory update failure",
      );
      throw error;
    }
  }

  getMemory(candidateId: string): Promise<MemoryCard | null> {
    return this.dependencies.store.findMemory(candidateId);
  }

  async retrieveCandidates(command: RetrievalCommand): Promise<RetrievedCandidate[]> {
    const initiatorCard = await this.dependencies.store.findMemory(command.initiatingCandidateId);
    if (!initiatorCard) throw new Error("Initiating candidate was not found");

    const embeddings = await this.dependencies.store.findEmbeddings(command.initiatingCandidateId);
    const need = embeddings.find((embedding) => embedding.kind === "need");
    const interest = embeddings.find((embedding) => embedding.kind === "interest");
    if (!need || !interest) throw new Error("Initiating candidate memory is not retrieval-ready");

    const rawLimit = 10;
    const [needMatches, offerMatches, interestMatches, cards] = await Promise.all([
      this.dependencies.store.searchEmbeddings({
        kind: "need",
        query: need.vector,
        model: need.model,
        dimensions: need.dimensions,
        limit: rawLimit,
      }),
      this.dependencies.store.searchEmbeddings({
        kind: "offer",
        query: need.vector,
        model: need.model,
        dimensions: need.dimensions,
        limit: rawLimit,
      }),
      this.dependencies.store.searchEmbeddings({
        kind: "interest",
        query: interest.vector,
        model: interest.model,
        dimensions: interest.dimensions,
        limit: rawLimit,
      }),
      this.dependencies.store.listMemories(),
    ]);
    const profiles = new Map(cards.map((card) => [card.profile.candidateId, card.profile]));
    const scoreByCandidate = new Map<string, { need: number; offer: number; interest: number }>();
    for (const [key, matches] of [
      ["need", needMatches],
      ["offer", offerMatches],
      ["interest", interestMatches],
    ] as const) {
      for (const match of matches) {
        const scores = scoreByCandidate.get(match.candidateId) ?? { need: 0, offer: 0, interest: 0 };
        scores[key] = Math.max(scores[key], match.similarity);
        scoreByCandidate.set(match.candidateId, scores);
      }
    }

    return [...scoreByCandidate.entries()]
      .flatMap(([candidateId, vectorScores]) => {
        const profile = profiles.get(candidateId);
        if (!profile || !this.passesHardFilters(initiatorCard.profile, profile)) return [];
        const minimumGroupSize = Math.max(
          initiatorCard.profile.constraints.minimumGroupSize,
          profile.constraints.minimumGroupSize,
        );
        const maximumGroupSize = Math.min(
          initiatorCard.profile.constraints.maximumGroupSize,
          profile.constraints.maximumGroupSize,
        );
        const socialCompatibility = minimumGroupSize <= maximumGroupSize ? 1 : 0;
        const total =
          0.3 * vectorScores.need +
          0.25 * vectorScores.offer +
          0.2 * vectorScores.interest +
          0.15 * socialCompatibility +
          0.1 * profile.previousGroupScore;
        return [{
          profile,
          scores: {
            needSimilarity: this.round(vectorScores.need),
            offerComplementarity: this.round(vectorScores.offer),
            interestSimilarity: this.round(vectorScores.interest),
            socialCompatibility,
            previousInteraction: profile.previousGroupScore,
            total: this.round(total),
          },
        }];
      })
      .sort((left, right) => right.scores.total - left.scores.total)
      .slice(0, Math.min(20, Math.max(1, command.limit ?? 15)));
  }

  async proposeQuest(command: ProposeQuestCommand, observe?: QuestPipelineObserver): Promise<QuestRun> {
    if (command.idempotencyKey) {
      const existing = await this.dependencies.store.findQuestByIdempotencyKey(command.idempotencyKey);
      if (existing) return existing;
    }

    const initiator = await this.dependencies.store.findMemory(command.initiatingCandidateId);
    if (!initiator) throw new Error("Initiating candidate was not found");
    const now = new Date().toISOString();
    const runId = `quest_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const base: QuestRun = {
      runId,
      initiatingCandidateId: command.initiatingCandidateId,
      idempotencyKey: command.idempotencyKey ?? null,
      status: "processing",
      proposal: null,
      validation: null,
      safety: null,
      coordination: null,
      createdAt: now,
      updatedAt: now,
    };
    const reservation = await this.dependencies.store.createQuestRun(base);
    if (!reservation.created) return reservation.run;

    try {
      await observe?.({ stage: "retrieval", status: "started", message: "Searching eligible neighbours", kind: "system" });
      const candidates = await this.retrieveCandidates({
        initiatingCandidateId: command.initiatingCandidateId,
        limit: command.candidateLimit,
      });
      await observe?.({ stage: "retrieval", status: "completed", message: `Found ${candidates.length} eligible neighbours`, kind: "system" });
      await observe?.({ stage: "synthesis", status: "started", message: "Matchmaker is designing a relevant quest", kind: "agent" });
      let synthesis = await this.dependencies.agents.synthesizeQuest({
        initiator: initiator.profile,
        candidates,
        auditContext: { conversationId: command.conversationId ?? "", questRunId: runId },
      });
      if (synthesis.outcome === "no_match") {
        await observe?.({ stage: "synthesis", status: "completed", message: "No strong match is available yet", kind: "agent" });
        return this.dependencies.store.saveQuestRun({
          ...base,
          status: "no_match",
          noMatch: { reason: synthesis.reason, missingCapabilities: synthesis.missingCapabilities },
          updatedAt: new Date().toISOString(),
        });
      }
      if (synthesis.primaryIntentRef !== stableFactRef("need", initiator.profile.need)) {
        await observe?.({ stage: "synthesis", status: "completed", message: "The proposal did not preserve the current request", kind: "agent" });
        return this.dependencies.store.saveQuestRun({
          ...base,
          status: "no_match",
          noMatch: {
            reason: "The available proposal did not directly address the current request.",
            missingCapabilities: initiator.profile.interests,
          },
          updatedAt: new Date().toISOString(),
        });
      }
      let proposal = synthesis.proposal;
      await observe?.({ stage: "synthesis", status: "completed", message: "Matchmaker proposed a quest", kind: "agent" });
      const cards = await this.dependencies.store.listMemories();
      const profiles = new Map(cards.map((card) => [card.profile.candidateId, card.profile]));
      await observe?.({ stage: "validation", status: "started", message: "Checking constraints and factual references", kind: "system" });
      let validation = this.validator.validate(proposal, profiles);
      validation = this.requireInitiator(proposal, command.initiatingCandidateId, validation);
      if (!validation.valid) {
        await observe?.({ stage: "synthesis", status: "started", message: "Matchmaker is correcting the proposal", kind: "agent" });
        synthesis = await this.dependencies.agents.synthesizeQuest({
          initiator: initiator.profile,
          candidates,
          validationErrors: validation.errors,
          proposalToCorrect: proposal,
          auditContext: { conversationId: command.conversationId ?? "", questRunId: runId },
        });
        if (synthesis.outcome === "no_match") {
          await observe?.({ stage: "synthesis", status: "completed", message: "No valid strong match is available yet", kind: "agent" });
          return this.dependencies.store.saveQuestRun({
            ...base,
            status: "no_match",
            noMatch: { reason: synthesis.reason, missingCapabilities: synthesis.missingCapabilities },
            updatedAt: new Date().toISOString(),
          });
        }
        proposal = synthesis.proposal;
        await observe?.({ stage: "synthesis", status: "completed", message: "Matchmaker corrected the proposal", kind: "agent" });
        validation = this.validator.validate(proposal, profiles);
        validation = this.requireInitiator(proposal, command.initiatingCandidateId, validation);
      }

      if (!validation.valid) {
        await observe?.({ stage: "validation", status: "failed", message: "The proposal needs human review", kind: "system" });
        return this.dependencies.store.saveQuestRun({
          ...base,
          status: "human_review",
          proposal,
          validation,
          updatedAt: new Date().toISOString(),
        });
      }

      await observe?.({ stage: "validation", status: "completed", message: "All quest rules passed", kind: "system" });
      await observe?.({ stage: "safety", status: "started", message: "Safety Guardian is reviewing the quest", kind: "agent" });
      const safety = await this.dependencies.agents.reviewSafety({
        proposal,
        profiles,
        auditContext: { conversationId: command.conversationId ?? "", questRunId: runId },
      });
      await observe?.({ stage: "safety", status: "completed", message: safety.status === "approved" ? "Safety review approved" : "Safety review requires attention", kind: "agent" });
      const approved = safety.status === "approved";
      if (approved) {
        await Promise.all(proposal.proposedParticipants.map((participant) =>
          this.invitations.send({ runId, candidateId: participant.candidateId })
        ));
      }
      return this.dependencies.store.saveQuestRun({
        ...base,
        status: approved ? "awaiting_acceptance" : "human_review",
        proposal,
        validation,
        safety,
        coordination: approved
          ? {
              questId: runId,
              state: "awaiting_acceptance",
              invitations: proposal.proposedParticipants.map((participant) => ({
                candidateId: participant.candidateId,
                status: "pending",
              })),
              nextAction: "Collect explicit acceptance, then confirm the venue and exact schedule.",
            }
          : null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      await observe?.({ stage: "synthesis", status: "failed", message: "Quest preparation could not finish", kind: "agent" });
      await this.dependencies.store.saveQuestRun({
        ...base,
        status: "failed",
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  getQuest(runId: string): Promise<QuestRun | null> {
    return this.dependencies.store.findQuestRun(runId);
  }

  async applyCoordinationEvent(command: CoordinationEventCommand): Promise<QuestRun> {
    const run = await this.dependencies.store.findQuestRun(command.runId);
    if (!run) throw new Error("Quest run was not found");
    if (!run.coordination) throw new Error("Quest is not available for coordination");

    const coordination = structuredClone(run.coordination);
    if (command.type === "participant_accepted") {
      if (run.status !== "awaiting_acceptance" || !command.candidateId) {
        throw new Error("Participant acceptance is not valid for this quest state");
      }
      const invitation = coordination.invitations.find(
        (candidate) => candidate.candidateId === command.candidateId,
      );
      if (!invitation || invitation.status !== "pending") {
        throw new Error("A pending invitation was not found for this participant");
      }
      invitation.status = "accepted";
      const currentParticipantIds = new Set(
        run.proposal?.proposedParticipants.map((participant) => participant.candidateId) ?? [],
      );
      const currentInvitations = coordination.invitations.filter((candidate) =>
        currentParticipantIds.has(candidate.candidateId)
      );
      const allAccepted = currentInvitations.length === currentParticipantIds.size &&
        currentInvitations.every((candidate) => candidate.status === "accepted");
      const venue = allAccepted && run.proposal
        ? await this.venues.confirm({ runId: run.runId, proposal: run.proposal })
        : null;
      const confirmed = venue?.confirmed === true;
      coordination.state = confirmed ? "confirmed" : allAccepted ? "human_review" : "awaiting_acceptance";
      coordination.nextAction = confirmed
        ? "Venue confirmed by the demo adapter; prepare participant reminders."
        : allAccepted
          ? "A human coordinator must confirm a compatible venue."
          : "Wait for the remaining participants to accept.";
      return this.persistCoordinationTransition(run, {
        ...run,
        status: confirmed ? "confirmed" : allAccepted ? "human_review" : "awaiting_acceptance",
        coordination,
        updatedAt: this.nextUpdatedAt(run.updatedAt),
      }, command);
    }

    if (command.type === "participant_declined" || command.type === "participant_timed_out") {
      if (run.status !== "awaiting_acceptance" || !command.candidateId || !run.proposal) {
        throw new Error("Participant recovery is not valid for this quest state");
      }
      const invitation = coordination.invitations.find(
        (candidate) => candidate.candidateId === command.candidateId,
      );
      if (!invitation || invitation.status !== "pending") {
        throw new Error("A pending invitation was not found for this participant");
      }
      invitation.status = "declined";
      const recovery = await this.dependencies.agents.recoverQuest({
        run,
        unavailableCandidateId: command.candidateId,
      });
      const reserve = run.proposal.reserveCandidates.find(
        (candidate) => candidate.candidateId === recovery.replacementCandidateId,
      );
      const replacementMemory = reserve
        ? await this.dependencies.store.findMemory(reserve.candidateId)
        : null;

      if (!reserve || !replacementMemory) {
        coordination.state = "human_review";
        coordination.nextAction = "A human coordinator must find a safe replacement.";
        return this.persistCoordinationTransition(run, {
          ...run,
          status: "human_review",
          coordination,
          updatedAt: this.nextUpdatedAt(run.updatedAt),
        }, command);
      }

      const proposal = structuredClone(run.proposal);
      proposal.proposedParticipants = proposal.proposedParticipants.map((participant) =>
        participant.candidateId === command.candidateId
          ? {
              candidateId: replacementMemory.profile.candidateId,
              proposedRole: reserve.possibleRole,
              needsAddressed: [replacementMemory.profile.need],
              contributionsUsed: [
                replacementMemory.profile.offers[0] ?? "participate and support the group",
              ],
            }
          : participant,
      );
      proposal.reserveCandidates = proposal.reserveCandidates.filter(
        (candidate) => candidate.candidateId !== reserve.candidateId,
      );
      const cards = await this.dependencies.store.listMemories();
      const profiles = new Map(cards.map((card) => [card.profile.candidateId, card.profile]));
      const validation = this.requireInitiator(
        proposal,
        run.initiatingCandidateId,
        this.validator.validate(proposal, profiles),
      );
      const safety = validation.valid
        ? await this.dependencies.agents.reviewSafety({ proposal, profiles })
        : null;
      const approved = validation.valid && safety?.status === "approved";
      if (approved) {
        await this.invitations.send({ runId: run.runId, candidateId: reserve.candidateId });
        invitation.status = "replaced";
        coordination.invitations.push({ candidateId: reserve.candidateId, status: "pending" });
        coordination.nextAction = "Collect acceptance from the replacement participant.";
      } else {
        coordination.state = "human_review";
        coordination.nextAction = "A human coordinator must review the attempted replacement.";
      }
      return this.persistCoordinationTransition(run, {
        ...run,
        status: approved ? "awaiting_acceptance" : "human_review",
        proposal,
        validation,
        safety,
        coordination,
        updatedAt: this.nextUpdatedAt(run.updatedAt),
      }, command);
    }

    if (command.type === "quest_cancelled") {
      if (["completed", "cancelled", "failed"].includes(run.status)) {
        throw new Error("Quest cancellation is not valid for this quest state");
      }
      coordination.state = "cancelled";
      coordination.nextAction = "No further action is scheduled.";
      return this.persistCoordinationTransition(run, {
        ...run,
        status: "cancelled",
        coordination,
        updatedAt: this.nextUpdatedAt(run.updatedAt),
      }, command);
    }

    if (command.type === "quest_completed") {
      if (run.status !== "confirmed") throw new Error("Only a confirmed quest can be completed");
      coordination.state = "completed";
      coordination.nextAction = "Collect feedback and update participant memories.";
      return this.persistCoordinationTransition(run, {
        ...run,
        status: "completed",
        coordination,
        updatedAt: this.nextUpdatedAt(run.updatedAt),
      }, command);
    }

    throw new Error("This coordination event requires recovery handling");
  }

  private persistCoordinationTransition(
    previous: QuestRun,
    updated: QuestRun,
    command: CoordinationEventCommand,
  ): Promise<QuestRun> {
    return this.dependencies.store.saveQuestRunWithEvent(updated, {
      ...command,
      eventId: `event_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      occurredAt: command.occurredAt ?? new Date().toISOString(),
    }, previous.updatedAt);
  }

  private nextUpdatedAt(previous: string): string {
    return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
  }

  private passesHardFilters(initiator: CandidateProfile, candidate: CandidateProfile): boolean {
    if (
      candidate.candidateId === initiator.candidateId ||
      candidate.source === "test" ||
      candidate.memoryStatus !== "active" ||
      !candidate.constraints.verified ||
      !candidate.constraints.invitationConsent ||
      candidate.alreadyCommitted ||
      candidate.relationshipBlocked
    ) return false;

    const minimumGroupSize = Math.max(
      initiator.constraints.minimumGroupSize,
      candidate.constraints.minimumGroupSize,
    );
    const maximumGroupSize = Math.min(
      initiator.constraints.maximumGroupSize,
      candidate.constraints.maximumGroupSize,
    );
    if (minimumGroupSize > maximumGroupSize) return false;

    if (!initiator.constraints.languages.some((language) => candidate.constraints.languages.includes(language))) {
      return false;
    }
    const distance = candidate.distanceFromInitiatorM;
    if (
      distance !== null &&
      distance > Math.min(initiator.constraints.maximumDistanceM, candidate.constraints.maximumDistanceM)
    ) return false;

    return initiator.constraints.availableWindows.some((left) =>
      candidate.constraints.availableWindows.some((right) =>
        Math.min(Date.parse(left.end), Date.parse(right.end)) -
          Math.max(Date.parse(left.start), Date.parse(right.start)) >=
        30 * 60_000,
      ),
    );
  }

  private round(value: number): number {
    return Math.round(value * 10_000) / 10_000;
  }

  private requireInitiator(
    proposal: QuestRun["proposal"] & {},
    initiatorId: string,
    validation: NonNullable<QuestRun["validation"]>,
  ): NonNullable<QuestRun["validation"]> {
    if (proposal.proposedParticipants.some((participant) => participant.candidateId === initiatorId)) {
      return validation;
    }
    return {
      valid: false,
      errors: [...validation.errors, {
        candidateId: initiatorId,
        field: "proposedParticipants",
        message: "The initiating candidate must be included in the proposed group.",
      }],
    };
  }
}
