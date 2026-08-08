import type {
  AssistantConversationSnapshot,
  CandidateEmbedding,
  AgentRunAudit,
  CoordinationEventRecord,
  MemoryCard,
  MemoryUpdateCommand,
  QuestRun,
} from "@/server/domain/schemas";
import type { EventCoordinationState, EventRecruitmentEligibilityGuard } from "@/server/domain/event-coordination";
import { canViewQuestRun } from "@/server/quest/quest-access";

export interface ActivateMemoryInput {
  attemptId: string;
  command: MemoryUpdateCommand;
  markdown: string;
  version: number;
  embeddings: CandidateEmbedding[];
}

export interface MemoryUpdateAttempt {
  attemptId: string;
  version: number;
  currentMemory: MemoryCard | null;
}

export interface EmbeddingSearchInput {
  kind: CandidateEmbedding["kind"];
  query: number[];
  model: string;
  dimensions: number;
  limit: number;
  /** Apply hard eligibility before nearest-neighbour limiting. */
  candidateIds?: string[];
}

export interface CandidateCommitment {
  candidateId: string;
  questId: string;
  /** Null means the commitment has no reliable schedule and remains exclusive. */
  start: string | null;
  end: string | null;
}

export type CandidateEmbeddingStatus = Omit<CandidateEmbedding, "vector">;

export interface KampungStore {
  createEventCoordinationState(state: EventCoordinationState): Promise<EventCoordinationState>;
  findEventCoordinationState(runId: string): Promise<EventCoordinationState | null>;
  saveEventCoordinationState(
    state: EventCoordinationState,
    expectedRevision: number,
    eligibilityGuard?: EventRecruitmentEligibilityGuard,
  ): Promise<EventCoordinationState>;
  listEventCoordinationStates(userId: string): Promise<EventCoordinationState[]>;
  listRecruitingEventCoordinationStates(): Promise<EventCoordinationState[]>;
  listHiddenEventSuggestionIds(userId: string): Promise<string[]>;
  hideEventSuggestion(userId: string, runId: string): Promise<void>;
  listAllEventCoordinationStates(limit?: number): Promise<EventCoordinationState[]>;
  saveQuestRunWithFormation(run: QuestRun, state: EventCoordinationState, expectedUpdatedAt: string): Promise<QuestRun>;
  createAssistantConversation(conversation: AssistantConversationSnapshot): Promise<AssistantConversationSnapshot>;
  findAssistantConversation(conversationId: string): Promise<AssistantConversationSnapshot | null>;
  findLatestAssistantConversation(candidateId: string): Promise<AssistantConversationSnapshot | null>;
  saveAssistantConversation(
    conversation: AssistantConversationSnapshot,
    expectedRevision: number,
  ): Promise<AssistantConversationSnapshot>;
  beginMemoryUpdate(command: MemoryUpdateCommand): Promise<MemoryUpdateAttempt>;
  activateMemory(input: ActivateMemoryInput): Promise<MemoryCard>;
  failMemoryUpdate(attemptId: string, error: string): Promise<void>;
  findMemory(candidateId: string): Promise<MemoryCard | null>;
  listMemories(): Promise<MemoryCard[]>;
  findEmbeddings(candidateId: string): Promise<CandidateEmbedding[]>;
  findEmbeddingStatuses(candidateIds: string[]): Promise<CandidateEmbeddingStatus[]>;
  replaceActiveEmbeddings(
    candidateId: string,
    memoryVersion: number,
    embeddings: CandidateEmbedding[],
  ): Promise<void>;
  searchEmbeddings(input: EmbeddingSearchInput): Promise<Array<{ candidateId: string; similarity: number }>>;
  createQuestRun(run: QuestRun): Promise<{ run: QuestRun; created: boolean }>;
  saveQuestRun(run: QuestRun): Promise<QuestRun>;
  /** Updates only the generated thumbnail when the run has not changed. */
  saveQuestImage(runId: string, imageUrl: string, expectedUpdatedAt: string): Promise<boolean>;
  saveQuestRunWithEvent(
    run: QuestRun,
    event: CoordinationEventRecord,
    expectedUpdatedAt: string,
  ): Promise<QuestRun>;
  findQuestRun(runId: string): Promise<QuestRun | null>;
  findQuestRuns(runIds: string[]): Promise<QuestRun[]>;
  findQuestByIdempotencyKey(key: string): Promise<QuestRun | null>;
  listQuestRuns(candidateId: string, limit: number): Promise<QuestRun[]>;
  /** Active future quests that may accept another compatible participant. */
  listJoinableQuestRuns(limit: number): Promise<QuestRun[]>;
  /** Candidates who accepted an invitation on a still-active quest. */
  listAcceptedCandidateIds(): Promise<string[]>;
  /** Accepted, non-terminal commitments with their best-known time window. */
  listAcceptedCommitments(): Promise<CandidateCommitment[]>;
  appendCoordinationEvent(event: CoordinationEventRecord): Promise<void>;
  healthCheck(): Promise<{ database: boolean; vector: boolean }>;
  recordAgentRun(record: AgentRunAudit): Promise<void>;
}

export class InMemoryKampungStore implements KampungStore {
  private readonly assistantConversations = new Map<string, AssistantConversationSnapshot>();
  private readonly memories = new Map<string, MemoryCard>();
  private readonly embeddings = new Map<string, CandidateEmbedding[]>();
  private readonly questRuns = new Map<string, QuestRun>();
  private readonly coordinationEvents: CoordinationEventRecord[] = [];
  private readonly memoryAttempts = new Map<string, MemoryUpdateCommand>();
  private readonly agentRuns: AgentRunAudit[] = [];
  private readonly eventCoordinationStates = new Map<string, EventCoordinationState>();
  private readonly hiddenEventSuggestions = new Map<string, Set<string>>();

  async saveQuestRunWithFormation(
    run: QuestRun,
    state: EventCoordinationState,
    expectedUpdatedAt: string,
  ): Promise<QuestRun> {
    const current = this.questRuns.get(run.runId);
    if (!current || current.updatedAt !== expectedUpdatedAt || this.eventCoordinationStates.has(run.runId)) {
      throw new Error("Quest state conflict; reload and retry formation");
    }
    this.questRuns.set(run.runId, structuredClone(run));
    this.eventCoordinationStates.set(run.runId, structuredClone(state));
    return structuredClone(run);
  }

  async createEventCoordinationState(state: EventCoordinationState): Promise<EventCoordinationState> {
    if (this.eventCoordinationStates.has(state.runId)) throw new Error("Event coordination state already exists");
    this.eventCoordinationStates.set(state.runId, structuredClone(state));
    return structuredClone(state);
  }

  async findEventCoordinationState(runId: string): Promise<EventCoordinationState | null> {
    const state = this.eventCoordinationStates.get(runId);
    return state ? structuredClone(state) : null;
  }

  async saveEventCoordinationState(
    state: EventCoordinationState,
    expectedRevision: number,
    eligibilityGuard?: EventRecruitmentEligibilityGuard,
  ): Promise<EventCoordinationState> {
    const current = this.eventCoordinationStates.get(state.runId);
    if (!current || current.revision !== expectedRevision) throw new Error("Quest state conflict; reload and retry");
    if (eligibilityGuard) {
      const profilesChanged = eligibilityGuard.profileVersions.some(({ candidateId, memoryVersion }) =>
        this.memories.get(candidateId)?.version !== memoryVersion);
      if (profilesChanged) {
        throw new Error("The applicant's profile changed during approval; review the request again");
      }
      const commitments = this.acceptedCommitments();
      const overlap = commitments.some((commitment) => commitment.candidateId === eligibilityGuard.candidateId
        && commitment.questId !== eligibilityGuard.excludeRunId
        && (commitment.start === null || commitment.end === null
          || (Date.parse(commitment.start) < Date.parse(eligibilityGuard.end)
            && Date.parse(commitment.end) > Date.parse(eligibilityGuard.start))));
      if (overlap) throw new Error("The applicant gained an overlapping commitment during approval");
    }
    this.eventCoordinationStates.set(state.runId, structuredClone(state));
    return structuredClone(state);
  }

  async listEventCoordinationStates(userId: string): Promise<EventCoordinationState[]> {
    return [...this.eventCoordinationStates.values()]
      .filter((state) => state.initiatorId === userId
        || state.roster.some((member) => member.userId === userId)
        || state.invitations.some((invitation) => invitation.guestId === userId)
        || state.memberships.some((membership) => membership.userId === userId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((state) => structuredClone(state));
  }

  async listAllEventCoordinationStates(limit = 50): Promise<EventCoordinationState[]> {
    return [...this.eventCoordinationStates.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map((state) => structuredClone(state));
  }

  async listRecruitingEventCoordinationStates(): Promise<EventCoordinationState[]> {
    return [...this.eventCoordinationStates.values()]
      .filter((state) => state.lifecycle === "recruiting" && state.recruitment?.status === "open")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((state) => structuredClone(state));
  }

  async listHiddenEventSuggestionIds(userId: string): Promise<string[]> {
    return [...(this.hiddenEventSuggestions.get(userId) ?? [])];
  }

  async hideEventSuggestion(userId: string, runId: string): Promise<void> {
    if (!this.eventCoordinationStates.has(runId)) throw new Error("Event coordination state was not found");
    const hidden = this.hiddenEventSuggestions.get(userId) ?? new Set<string>();
    hidden.add(runId);
    this.hiddenEventSuggestions.set(userId, hidden);
  }

  async createAssistantConversation(
    conversation: AssistantConversationSnapshot,
  ): Promise<AssistantConversationSnapshot> {
    if (this.assistantConversations.has(conversation.conversationId)) {
      throw new Error("Assistant conversation already exists");
    }
    this.assistantConversations.set(conversation.conversationId, structuredClone(conversation));
    return structuredClone(conversation);
  }

  async findAssistantConversation(conversationId: string): Promise<AssistantConversationSnapshot | null> {
    const conversation = this.assistantConversations.get(conversationId);
    return conversation ? structuredClone(conversation) : null;
  }

  async findLatestAssistantConversation(candidateId: string): Promise<AssistantConversationSnapshot | null> {
    const latest = [...this.assistantConversations.values()]
      .filter((conversation) => conversation.candidateId === candidateId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    return latest ? structuredClone(latest) : null;
  }

  async saveAssistantConversation(
    conversation: AssistantConversationSnapshot,
    expectedRevision: number,
  ): Promise<AssistantConversationSnapshot> {
    const current = this.assistantConversations.get(conversation.conversationId);
    if (!current || current.revision !== expectedRevision) {
      throw new Error("Assistant conversation conflict; reload and retry");
    }
    this.assistantConversations.set(conversation.conversationId, structuredClone(conversation));
    return structuredClone(conversation);
  }

  async beginMemoryUpdate(command: MemoryUpdateCommand): Promise<MemoryUpdateAttempt> {
    const currentMemory = await this.findMemory(command.profile.candidateId);
    const version = (currentMemory?.version ?? 0) + 1;
    const attemptId = `${command.profile.candidateId}:${version}`;
    this.memoryAttempts.set(attemptId, structuredClone(command));
    return { attemptId, version, currentMemory };
  }

  async activateMemory(input: ActivateMemoryInput): Promise<MemoryCard> {
    if (!this.memoryAttempts.has(input.attemptId)) throw new Error("Memory update attempt was not found");
    const current = this.memories.get(input.command.profile.candidateId);
    if ((current?.version ?? 0) + 1 !== input.version) {
      throw new Error("Memory version conflict");
    }
    if (input.embeddings.length !== 3) {
      throw new Error("All memory embeddings must be ready before activation");
    }

    const card: MemoryCard = {
      profile: structuredClone(input.command.profile),
      narrative: input.command.narrative,
      markdown: input.markdown,
      version: input.version,
      retrievalReady: true,
      updatedAt: new Date().toISOString(),
    };
    this.memories.set(card.profile.candidateId, structuredClone(card));
    this.embeddings.set(card.profile.candidateId, structuredClone(input.embeddings));
    this.memoryAttempts.delete(input.attemptId);
    return structuredClone(card);
  }

  async failMemoryUpdate(attemptId: string): Promise<void> {
    this.memoryAttempts.delete(attemptId);
  }

  async findMemory(candidateId: string): Promise<MemoryCard | null> {
    const card = this.memories.get(candidateId);
    return card ? structuredClone(card) : null;
  }

  async listMemories(): Promise<MemoryCard[]> {
    return [...this.memories.values()].map((card) => structuredClone(card));
  }

  async findEmbeddings(candidateId: string): Promise<CandidateEmbedding[]> {
    return structuredClone(this.embeddings.get(candidateId) ?? []);
  }

  async findEmbeddingStatuses(candidateIds: string[]): Promise<CandidateEmbeddingStatus[]> {
    const included = new Set(candidateIds);
    return [...this.embeddings.entries()]
      .filter(([candidateId]) => included.has(candidateId))
      .flatMap(([, embeddings]) => embeddings.map(({ vector: _vector, ...status }) => structuredClone(status)));
  }

  async replaceActiveEmbeddings(
    candidateId: string,
    memoryVersion: number,
    embeddings: CandidateEmbedding[],
  ): Promise<void> {
    const memory = this.memories.get(candidateId);
    if (!memory || memory.version !== memoryVersion) throw new Error("Active memory changed during reindexing");
    if (embeddings.length !== 3 || embeddings.some((embedding) =>
      embedding.candidateId !== candidateId || embedding.memoryVersion !== memoryVersion)) {
      throw new Error("Reindexed embeddings do not match the active memory");
    }
    this.embeddings.set(candidateId, structuredClone(embeddings));
  }

  async searchEmbeddings(input: EmbeddingSearchInput): Promise<Array<{ candidateId: string; similarity: number }>> {
    const allowedCandidateIds = input.candidateIds ? new Set(input.candidateIds) : null;
    return [...this.embeddings.entries()]
      .flatMap(([candidateId, embeddings]) =>
        allowedCandidateIds && !allowedCandidateIds.has(candidateId) ? [] :
        embeddings
          .filter((embedding) =>
            embedding.kind === input.kind
            && embedding.model === input.model
            && embedding.dimensions === input.dimensions,
          )
          .map((embedding) => ({
            candidateId,
            similarity: this.cosine(input.query, embedding.vector),
          })),
      )
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, input.limit);
  }

  private cosine(left: number[], right: number[]): number {
    if (left.length !== right.length || left.length === 0) return 0;
    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftMagnitude += left[index] * left[index];
      rightMagnitude += right[index] * right[index];
    }
    const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
    return denominator === 0 ? 0 : dot / denominator;
  }

  async saveQuestRun(run: QuestRun): Promise<QuestRun> {
    this.questRuns.set(run.runId, structuredClone(run));
    return structuredClone(run);
  }

  async saveQuestImage(runId: string, imageUrl: string, expectedUpdatedAt: string): Promise<boolean> {
    const current = this.questRuns.get(runId);
    if (!current || current.updatedAt !== expectedUpdatedAt) return false;
    const updated: QuestRun = {
      ...current,
      imageUrl,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
    };
    this.questRuns.set(runId, structuredClone(updated));
    return true;
  }

  async createQuestRun(run: QuestRun): Promise<{ run: QuestRun; created: boolean }> {
    if (run.idempotencyKey) {
      const idempotencyKey = run.idempotencyKey;
      const existing = [...this.questRuns.values()].find(
        (candidate) => candidate.idempotencyKey === idempotencyKey ||
          candidate.participantIdempotencyKeys?.includes(idempotencyKey),
      );
      if (existing) return { run: structuredClone(existing), created: false };
    }
    this.questRuns.set(run.runId, structuredClone(run));
    return { run: structuredClone(run), created: true };
  }

  async findQuestRun(runId: string): Promise<QuestRun | null> {
    const run = this.questRuns.get(runId);
    return run ? structuredClone(run) : null;
  }

  async findQuestRuns(runIds: string[]): Promise<QuestRun[]> {
    return runIds.flatMap((runId) => {
      const run = this.questRuns.get(runId);
      return run ? [structuredClone(run)] : [];
    });
  }

  async saveQuestRunWithEvent(
    run: QuestRun,
    event: CoordinationEventRecord,
    expectedUpdatedAt: string,
  ): Promise<QuestRun> {
    const current = this.questRuns.get(run.runId);
    if (!current || current.updatedAt !== expectedUpdatedAt) {
      throw new Error("Quest state conflict; reload and retry the event");
    }
    this.questRuns.set(run.runId, structuredClone(run));
    this.coordinationEvents.push(structuredClone(event));
    return structuredClone(run);
  }

  async findQuestByIdempotencyKey(key: string): Promise<QuestRun | null> {
    const run = [...this.questRuns.values()].find(
      (candidate) => candidate.idempotencyKey === key || candidate.participantIdempotencyKeys?.includes(key),
    );
    return run ? structuredClone(run) : null;
  }

  async listQuestRuns(candidateId: string, limit: number): Promise<QuestRun[]> {
    return [...this.questRuns.values()]
      .filter((run) => canViewQuestRun(run, candidateId))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map((run) => structuredClone(run));
  }

  async listJoinableQuestRuns(limit: number): Promise<QuestRun[]> {
    return [...this.questRuns.values()]
      .filter(isJoinableQuestRun)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map((run) => structuredClone(run));
  }

  async listAcceptedCandidateIds(): Promise<string[]> {
    return [...new Set((await this.listAcceptedCommitments()).map((commitment) => commitment.candidateId))];
  }

  async listAcceptedCommitments(): Promise<CandidateCommitment[]> {
    return this.acceptedCommitments();
  }

  private acceptedCommitments(): CandidateCommitment[] {
    const commitments = new Map<string, CandidateCommitment>();
    for (const run of this.questRuns.values()) {
      if (!run.coordination || isTerminalQuestStatus(run.status)) continue;
      const window = run.proposal?.quest.proposedTimeWindow ?? null;
      if (window && Date.parse(window.end) <= Date.now()) continue;
      for (const invitation of run.coordination.invitations) {
        if (invitation.status !== "accepted") continue;
        const commitment = {
          candidateId: invitation.candidateId,
          questId: run.runId,
          start: window?.start ?? null,
          end: window?.end ?? null,
        };
        commitments.set(`${run.runId}:${invitation.candidateId}`, commitment);
      }
    }
    for (const state of this.eventCoordinationStates.values()) {
      if (["completed", "cancelled"].includes(state.lifecycle)) continue;
      const finalized = [...state.arrangements]
        .filter((arrangement) => arrangement.status === "finalized")
        .sort((left, right) => right.version - left.version)[0];
      const window = finalized ?? state.proposal.quest.proposedTimeWindow;
      if (Date.parse(window.end) <= Date.now()) continue;
      for (const membership of state.memberships) {
        if (!["coordinating", "awaiting_confirmation", "confirmed"].includes(membership.status)) continue;
        commitments.set(`${state.runId}:${membership.userId}`, {
          candidateId: membership.userId,
          questId: state.runId,
          start: window.start,
          end: window.end,
        });
      }
    }
    return [...commitments.values()].map((commitment) => structuredClone(commitment));
  }

  async appendCoordinationEvent(event: CoordinationEventRecord): Promise<void> {
    this.coordinationEvents.push(structuredClone(event));
  }

  async healthCheck(): Promise<{ database: boolean; vector: boolean }> {
    return { database: true, vector: true };
  }

  async recordAgentRun(record: AgentRunAudit): Promise<void> {
    this.agentRuns.push(structuredClone(record));
  }
}

function isTerminalQuestStatus(status: QuestRun["status"]): boolean {
  return status === "completed" || status === "cancelled" || status === "failed";
}

export function isJoinableQuestRun(run: QuestRun): boolean {
  if (run.status !== "awaiting_acceptance" && run.status !== "confirmed") return false;
  if (!run.proposal || !run.coordination) return false;
  if (run.coordination.state !== "awaiting_acceptance" && run.coordination.state !== "confirmed") return false;
  return Date.parse(run.proposal.quest.proposedTimeWindow.start) > Date.now();
}
