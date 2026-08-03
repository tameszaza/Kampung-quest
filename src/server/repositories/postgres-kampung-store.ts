import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { stableFactRef } from "@/server/agents/provider-privacy";
import type {
  AssistantConversationSnapshot,
  AssistantWorkflowEvent,
  CandidateEmbedding,
  AgentRunAudit,
  CoordinationEventRecord,
  MemoryCard,
  MemoryUpdateCommand,
  QuestRun,
} from "@/server/domain/schemas";
import type {
  ActivateMemoryInput,
  KampungStore,
  MemoryUpdateAttempt,
} from "@/server/repositories/kampung-store";

interface MemoryRow {
  profile: MemoryCard["profile"];
  markdown: string;
  narrative: string;
  version: number;
  retrieval_ready: boolean;
  updated_at: Date | string;
}

export class PostgresKampungStore implements KampungStore {
  readonly pool: Pool;

  constructor(connectionString: string, pool?: Pool) {
    this.pool = pool ?? new Pool({ connectionString, max: 10 });
  }

  async createAssistantConversation(
    conversation: AssistantConversationSnapshot,
  ): Promise<AssistantConversationSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.insertConversation(client, conversation);
      await this.insertConversationChildren(client, conversation);
      await client.query("COMMIT");
      return structuredClone(conversation);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findAssistantConversation(conversationId: string): Promise<AssistantConversationSnapshot | null> {
    const conversation = await this.pool.query<{
      conversation_id: string;
      candidate_id: string;
      status: AssistantConversationSnapshot["status"];
      revision: number;
      brief: AssistantConversationSnapshot["brief"];
      next_field: AssistantConversationSnapshot["nextField"];
      suggested_replies: string[];
      quest_run_id: string | null;
      error_message: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    }>("SELECT * FROM assistant.conversations WHERE conversation_id = $1", [conversationId]);
    const row = conversation.rows[0];
    if (!row) return null;
    const [messages, events] = await Promise.all([
      this.pool.query<{
        message_id: string;
        role: "user" | "assistant";
        content: string;
        created_at: Date | string;
      }>(
        `SELECT message_id, role, content, created_at FROM assistant.messages
         WHERE conversation_id = $1 ORDER BY position`,
        [conversationId],
      ),
      this.pool.query<{
        sequence: number;
        stage: AssistantWorkflowEvent["stage"];
        status: AssistantWorkflowEvent["status"];
        message: string;
        kind: AssistantWorkflowEvent["kind"];
        created_at: Date | string;
      }>(
        `SELECT sequence, stage, status, message, kind, created_at FROM assistant.workflow_events
         WHERE conversation_id = $1 ORDER BY sequence`,
        [conversationId],
      ),
    ]);
    return {
      conversationId: row.conversation_id,
      candidateId: row.candidate_id,
      status: row.status,
      revision: Number(row.revision),
      brief: row.brief,
      nextField: row.next_field,
      suggestedReplies: row.suggested_replies,
      questRunId: row.quest_run_id,
      error: row.error_message,
      messages: messages.rows.map((message) => ({
        messageId: message.message_id,
        role: message.role,
        content: message.content,
        createdAt: new Date(message.created_at).toISOString(),
      })),
      events: events.rows.map((event) => ({
        sequence: Number(event.sequence),
        stage: event.stage,
        status: event.status,
        message: event.message,
        kind: event.kind,
        createdAt: new Date(event.created_at).toISOString(),
      })),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async saveAssistantConversation(
    conversation: AssistantConversationSnapshot,
    expectedRevision: number,
  ): Promise<AssistantConversationSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE assistant.conversations
         SET status = $2, revision = $3, brief = $4::jsonb, next_field = $5,
             suggested_replies = $6::jsonb, quest_run_id = $7, error_message = $8, updated_at = $9
         WHERE conversation_id = $1 AND revision = $10`,
        [
          conversation.conversationId,
          conversation.status,
          conversation.revision,
          JSON.stringify(conversation.brief),
          conversation.nextField,
          JSON.stringify(conversation.suggestedReplies),
          conversation.questRunId,
          conversation.error,
          conversation.updatedAt,
          expectedRevision,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("Assistant conversation conflict; reload and retry");
      await this.insertConversationChildren(client, conversation);
      await client.query("COMMIT");
      return structuredClone(conversation);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertConversation(
    client: PoolClient,
    conversation: AssistantConversationSnapshot,
  ): Promise<void> {
    await client.query(
      `INSERT INTO assistant.conversations
         (conversation_id, candidate_id, status, revision, brief, next_field,
          suggested_replies, quest_run_id, error_message, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11)`,
      [
        conversation.conversationId,
        conversation.candidateId,
        conversation.status,
        conversation.revision,
        JSON.stringify(conversation.brief),
        conversation.nextField,
        JSON.stringify(conversation.suggestedReplies),
        conversation.questRunId,
        conversation.error,
        conversation.createdAt,
        conversation.updatedAt,
      ],
    );
  }

  private async insertConversationChildren(
    client: PoolClient,
    conversation: AssistantConversationSnapshot,
  ): Promise<void> {
    for (const [position, message] of conversation.messages.entries()) {
      await client.query(
        `INSERT INTO assistant.messages (message_id, conversation_id, position, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (message_id) DO NOTHING`,
        [message.messageId, conversation.conversationId, position, message.role, message.content, message.createdAt],
      );
    }
    for (const event of conversation.events) {
      await client.query(
        `INSERT INTO assistant.workflow_events
           (conversation_id, sequence, stage, status, message, kind, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (conversation_id, sequence) DO NOTHING`,
        [
          conversation.conversationId,
          event.sequence,
          event.stage,
          event.status,
          event.message,
          event.kind,
          event.createdAt,
        ],
      );
    }
  }

  async beginMemoryUpdate(command: MemoryUpdateCommand): Promise<MemoryUpdateAttempt> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO memory.candidates (candidate_id, profile)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (candidate_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()`,
        [command.profile.candidateId, JSON.stringify(command.profile)],
      );
      await client.query(
        "SELECT candidate_id FROM memory.candidates WHERE candidate_id = $1 FOR UPDATE",
        [command.profile.candidateId],
      );
      const versionResult = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM memory.memory_versions WHERE candidate_id = $1`,
        [command.profile.candidateId],
      );
      const version = Number(versionResult.rows[0].version);
      const attemptId = `memory_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      await client.query(
        `INSERT INTO memory.memory_events
           (event_id, candidate_id, version, narrative, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [attemptId, command.profile.candidateId, version, command.narrative],
      );
      await client.query(
        `INSERT INTO memory.memory_versions
           (candidate_id, version, profile, narrative, status)
         VALUES ($1, $2, $3::jsonb, $4, 'pending')`,
        [command.profile.candidateId, version, JSON.stringify(command.profile), command.narrative],
      );
      await client.query(
        `INSERT INTO retrieval.indexing_jobs
           (job_id, candidate_id, memory_version, status)
         VALUES ($1, $2, $3, 'pending')`,
        [attemptId, command.profile.candidateId, version],
      );
      const currentMemory = await this.findMemoryWithClient(client, command.profile.candidateId);
      await client.query("COMMIT");
      return { attemptId, version, currentMemory };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async activateMemory(input: ActivateMemoryInput): Promise<MemoryCard> {
    if (input.embeddings.length !== 3 || input.embeddings.some((embedding) => embedding.dimensions !== 1536)) {
      throw new Error("Exactly three 1536-dimensional embeddings are required");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const attempt = await client.query<{ candidate_id: string; version: number }>(
        `SELECT candidate_id, version FROM memory.memory_events
         WHERE event_id = $1 AND status = 'pending' FOR UPDATE`,
        [input.attemptId],
      );
      const row = attempt.rows[0];
      if (!row || row.candidate_id !== input.command.profile.candidateId || row.version !== input.version) {
        throw new Error("Memory update attempt was not found or has changed");
      }
      const candidate = await client.query<{ active_version: number }>(
        "SELECT active_version FROM memory.candidates WHERE candidate_id = $1 FOR UPDATE",
        [row.candidate_id],
      );
      if (Number(candidate.rows[0]?.active_version ?? 0) >= row.version) {
        throw new Error("Memory version conflict: a newer memory is already active");
      }

      await client.query(
        `UPDATE memory.memory_versions
         SET status = 'superseded'
         WHERE candidate_id = $1 AND status = 'active'`,
        [row.candidate_id],
      );
      await client.query(
        `UPDATE memory.memory_versions
         SET profile = $3::jsonb, markdown = $4, retrieval_ready = true,
             status = 'active', updated_at = now()
         WHERE candidate_id = $1 AND version = $2`,
        [row.candidate_id, row.version, JSON.stringify(input.command.profile), input.markdown],
      );
      await client.query(
        `INSERT INTO memory.constraint_versions (candidate_id, memory_version, constraints)
         VALUES ($1, $2, $3::jsonb)`,
        [row.candidate_id, row.version, JSON.stringify(input.command.profile.constraints)],
      );
      const facts: Array<{ factRef: string; kind: "need" | "interest" | "offer"; factText: string }> = [
        { factRef: stableFactRef("need", input.command.profile.need), kind: "need", factText: input.command.profile.need },
        ...input.command.profile.interests.map((fact) => ({
          factRef: stableFactRef("interest", fact), kind: "interest" as const, factText: fact,
        })),
        ...input.command.profile.offers.map((fact) => ({
          factRef: stableFactRef("offer", fact), kind: "offer" as const, factText: fact,
        })),
      ];
      const uniqueFacts = new Map(facts.map((fact) => [fact.factRef, fact] as const));
      for (const { factRef, kind, factText } of uniqueFacts.values()) {
        await client.query(
          `INSERT INTO memory.memory_facts
             (candidate_id, memory_version, fact_ref, kind, fact_text)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.candidate_id, row.version, factRef, kind, factText],
        );
      }
      await client.query(
        "UPDATE retrieval.candidate_embeddings SET active = false WHERE candidate_id = $1",
        [row.candidate_id],
      );
      for (const embedding of input.embeddings) {
        await client.query(
          `INSERT INTO retrieval.candidate_embeddings
             (candidate_id, memory_version, kind, model, dimensions, embedding, active)
           VALUES ($1, $2, $3, $4, $5, $6::vector, true)`,
          [
            embedding.candidateId,
            embedding.memoryVersion,
            embedding.kind,
            embedding.model,
            embedding.dimensions,
            this.vectorLiteral(embedding.vector),
          ],
        );
      }
      await client.query(
        `UPDATE memory.candidates
         SET profile = $3::jsonb, active_version = $2, updated_at = now()
         WHERE candidate_id = $1`,
        [row.candidate_id, row.version, JSON.stringify(input.command.profile)],
      );
      await client.query(
        "UPDATE memory.memory_events SET status = 'active' WHERE event_id = $1",
        [input.attemptId],
      );
      await client.query(
        `UPDATE retrieval.indexing_jobs SET status = 'completed', updated_at = now()
         WHERE job_id = $1`,
        [input.attemptId],
      );
      await client.query("COMMIT");
      return {
        profile: structuredClone(input.command.profile),
        markdown: input.markdown,
        narrative: input.command.narrative,
        version: input.version,
        retrievalReady: true,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async failMemoryUpdate(attemptId: string, error: string): Promise<void> {
    await this.pool.query(
      `WITH failed_event AS (
         UPDATE memory.memory_events
         SET status = 'failed', error_message = $2
         WHERE event_id = $1 AND status = 'pending'
         RETURNING candidate_id, version
       ), failed_version AS (
         UPDATE memory.memory_versions version
         SET status = 'failed', updated_at = now()
         FROM failed_event event
         WHERE version.candidate_id = event.candidate_id AND version.version = event.version
       )
       UPDATE retrieval.indexing_jobs
       SET status = 'failed', error_message = $2, updated_at = now()
       WHERE job_id = $1`,
      [attemptId, error.slice(0, 2_000)],
    );
  }

  async findMemory(candidateId: string): Promise<MemoryCard | null> {
    return this.findMemoryWithClient(this.pool, candidateId);
  }

  async listMemories(): Promise<MemoryCard[]> {
    const result = await this.pool.query<MemoryRow>(
      `SELECT version.profile, version.markdown, version.narrative, version.version,
              version.retrieval_ready, version.updated_at
       FROM memory.candidates candidate
       JOIN memory.memory_versions version
         ON version.candidate_id = candidate.candidate_id
        AND version.version = candidate.active_version
       WHERE version.status = 'active' AND version.retrieval_ready = true`,
    );
    return result.rows.map((row) => this.memoryCard(row));
  }

  async findEmbeddings(candidateId: string): Promise<CandidateEmbedding[]> {
    const result = await this.pool.query<{
      candidate_id: string;
      memory_version: number;
      kind: CandidateEmbedding["kind"];
      model: string;
      dimensions: number;
      embedding: string;
    }>(
      `SELECT candidate_id, memory_version, kind, model, dimensions, embedding::text
       FROM retrieval.candidate_embeddings
       WHERE candidate_id = $1 AND active = true`,
      [candidateId],
    );
    return result.rows.map((row) => ({
      candidateId: row.candidate_id,
      memoryVersion: row.memory_version,
      kind: row.kind,
      model: row.model,
      dimensions: row.dimensions,
      vector: this.parseVector(row.embedding),
    }));
  }

  async searchEmbeddings(input: {
    kind: CandidateEmbedding["kind"];
    query: number[];
    model: string;
    dimensions: number;
    limit: number;
  }): Promise<Array<{ candidateId: string; similarity: number }>> {
    const result = await this.pool.query<{ candidate_id: string; similarity: string | number }>(
      `SELECT candidate_id, 1 - (embedding <=> $1::vector) AS similarity
       FROM retrieval.candidate_embeddings
       WHERE kind = $2 AND model = $3 AND dimensions = $4 AND active = true
       ORDER BY embedding <=> $1::vector
       LIMIT $5`,
      [this.vectorLiteral(input.query), input.kind, input.model, input.dimensions, input.limit],
    );
    return result.rows.map((row) => ({
      candidateId: row.candidate_id,
      similarity: Number(row.similarity),
    }));
  }

  async saveQuestRun(run: QuestRun): Promise<QuestRun> {
    await this.pool.query(
      `INSERT INTO quest.quest_runs
         (run_id, initiating_candidate_id, idempotency_key, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (run_id) DO UPDATE
         SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
      [
        run.runId,
        run.initiatingCandidateId,
        run.idempotencyKey,
        run.status,
        JSON.stringify(run),
        run.createdAt,
        run.updatedAt,
      ],
    );
    return structuredClone(run);
  }

  async createQuestRun(run: QuestRun): Promise<{ run: QuestRun; created: boolean }> {
    const inserted = await this.pool.query(
      `INSERT INTO quest.quest_runs
         (run_id, initiating_candidate_id, idempotency_key, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING run_id`,
      [
        run.runId,
        run.initiatingCandidateId,
        run.idempotencyKey,
        run.status,
        JSON.stringify(run),
        run.createdAt,
        run.updatedAt,
      ],
    );
    if (inserted.rowCount === 1) return { run: structuredClone(run), created: true };
    if (!run.idempotencyKey) throw new Error("Quest run conflict");
    const existing = await this.findQuestByIdempotencyKey(run.idempotencyKey);
    if (!existing) throw new Error("Quest idempotency reservation conflict");
    return { run: existing, created: false };
  }

  async findQuestRun(runId: string): Promise<QuestRun | null> {
    const result = await this.pool.query<{ payload: QuestRun }>(
      "SELECT payload FROM quest.quest_runs WHERE run_id = $1",
      [runId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async saveQuestRunWithEvent(
    run: QuestRun,
    event: CoordinationEventRecord,
    expectedUpdatedAt: string,
  ): Promise<QuestRun> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE quest.quest_runs
         SET status = $2, payload = $3::jsonb, updated_at = $4
         WHERE run_id = $1 AND updated_at = $5
         RETURNING run_id`,
        [run.runId, run.status, JSON.stringify(run), run.updatedAt, expectedUpdatedAt],
      );
      if (updated.rowCount !== 1) throw new Error("Quest state conflict; reload and retry the event");
      await client.query(
        `INSERT INTO quest.coordination_events
           (event_id, run_id, event_type, candidate_id, occurred_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [event.eventId, event.runId, event.type, event.candidateId ?? null, event.occurredAt, JSON.stringify(event)],
      );
      await client.query("COMMIT");
      return structuredClone(run);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findQuestByIdempotencyKey(key: string): Promise<QuestRun | null> {
    const result = await this.pool.query<{ payload: QuestRun }>(
      "SELECT payload FROM quest.quest_runs WHERE idempotency_key = $1",
      [key],
    );
    return result.rows[0]?.payload ?? null;
  }

  async listQuestRuns(candidateId: string, limit: number): Promise<QuestRun[]> {
    const result = await this.pool.query<{ payload: QuestRun }>(
      `SELECT payload
       FROM quest.quest_runs
       WHERE initiating_candidate_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [candidateId, Math.min(50, Math.max(1, limit))],
    );
    return result.rows.map((row) => row.payload);
  }

  async listAcceptedCandidateIds(): Promise<string[]> {
    const result = await this.pool.query<{ candidate_id: string }>(
      `SELECT DISTINCT invitation->>'candidateId' AS candidate_id
       FROM quest.quest_runs run
       CROSS JOIN LATERAL jsonb_array_elements(
         COALESCE(run.payload->'coordination'->'invitations', '[]'::jsonb)
       ) AS invitation
       WHERE run.status IN ('awaiting_acceptance', 'confirmed', 'human_review')
         AND invitation->>'status' = 'accepted'
         AND invitation->>'candidateId' IS NOT NULL`,
    );
    return result.rows.map((row) => row.candidate_id);
  }

  async appendCoordinationEvent(event: CoordinationEventRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO quest.coordination_events
         (event_id, run_id, event_type, candidate_id, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [event.eventId, event.runId, event.type, event.candidateId ?? null, event.occurredAt, JSON.stringify(event)],
    );
  }

  async healthCheck(): Promise<{ database: boolean; vector: boolean }> {
    try {
      const result = await this.pool.query<{ vector_ready: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS vector_ready",
      );
      return { database: true, vector: result.rows[0]?.vector_ready === true };
    } catch {
      return { database: false, vector: false };
    }
  }

  async recordAgentRun(record: AgentRunAudit): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory.agent_runs
         (run_id, role, model, prompt_version, outcome, latency_ms,
          input_tokens, output_tokens, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        record.runId,
        record.role,
        record.model,
        record.promptVersion,
        record.outcome,
        record.latencyMs,
        record.inputTokens,
        record.outputTokens,
        JSON.stringify(record.metadata),
      ],
    );
  }

  private async findMemoryWithClient(
    client: Pick<PoolClient, "query"> | Pool,
    candidateId: string,
  ): Promise<MemoryCard | null> {
    const result = await client.query<MemoryRow>(
      `SELECT version.profile, version.markdown, version.narrative, version.version,
              version.retrieval_ready, version.updated_at
       FROM memory.candidates candidate
       JOIN memory.memory_versions version
         ON version.candidate_id = candidate.candidate_id
        AND version.version = candidate.active_version
       WHERE candidate.candidate_id = $1 AND version.status = 'active'`,
      [candidateId],
    );
    return result.rows[0] ? this.memoryCard(result.rows[0]) : null;
  }

  private memoryCard(row: MemoryRow): MemoryCard {
    return {
      profile: row.profile,
      markdown: row.markdown,
      narrative: row.narrative,
      version: Number(row.version),
      retrievalReady: row.retrieval_ready,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private vectorLiteral(vector: number[]): string {
    return `[${vector.join(",")}]`;
  }

  private parseVector(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  }
}
