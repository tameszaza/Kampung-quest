import type {
  AssistantConversationSnapshot,
  CandidateEmbedding,
  AgentRunAudit,
  CoordinationEventRecord,
  MemoryCard,
  MemoryUpdateCommand,
  QuestRun,
} from "@/server/domain/schemas";

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

export interface KampungStore {
  createAssistantConversation(conversation: AssistantConversationSnapshot): Promise<AssistantConversationSnapshot>;
  findAssistantConversation(conversationId: string): Promise<AssistantConversationSnapshot | null>;
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
  searchEmbeddings(input: {
    kind: CandidateEmbedding["kind"];
    query: number[];
    model: string;
    dimensions: number;
    limit: number;
  }): Promise<Array<{ candidateId: string; similarity: number }>>;
  createQuestRun(run: QuestRun): Promise<{ run: QuestRun; created: boolean }>;
  saveQuestRun(run: QuestRun): Promise<QuestRun>;
  saveQuestRunWithEvent(
    run: QuestRun,
    event: CoordinationEventRecord,
    expectedUpdatedAt: string,
  ): Promise<QuestRun>;
  findQuestRun(runId: string): Promise<QuestRun | null>;
  findQuestByIdempotencyKey(key: string): Promise<QuestRun | null>;
  listQuestRuns(candidateId: string, limit: number): Promise<QuestRun[]>;
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

  async searchEmbeddings(input: {
    kind: CandidateEmbedding["kind"];
    query: number[];
    model: string;
    dimensions: number;
    limit: number;
  }): Promise<Array<{ candidateId: string; similarity: number }>> {
    return [...this.embeddings.entries()]
      .flatMap(([candidateId, embeddings]) =>
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

  async createQuestRun(run: QuestRun): Promise<{ run: QuestRun; created: boolean }> {
    if (run.idempotencyKey) {
      const existing = [...this.questRuns.values()].find(
        (candidate) => candidate.idempotencyKey === run.idempotencyKey,
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
    const run = [...this.questRuns.values()].find((candidate) => candidate.idempotencyKey === key);
    return run ? structuredClone(run) : null;
  }

  async listQuestRuns(candidateId: string, limit: number): Promise<QuestRun[]> {
    return [...this.questRuns.values()]
      .filter((run) => run.initiatingCandidateId === candidateId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, Math.min(50, Math.max(1, limit)))
      .map((run) => structuredClone(run));
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
