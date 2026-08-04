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
import type { EventCoordinationState, EventRecruitmentEligibilityGuard } from "@/server/domain/event-coordination";
import type {
  ActivateMemoryInput,
  CandidateCommitment,
  EmbeddingSearchInput,
  KampungStore,
  MemoryUpdateAttempt,
} from "@/server/repositories/kampung-store";
import { isJoinableQuestRun } from "@/server/repositories/kampung-store";
import { canViewQuestRun } from "@/server/quest/quest-access";

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

  async saveQuestRunWithFormation(
    run: QuestRun,
    state: EventCoordinationState,
    expectedUpdatedAt: string,
  ): Promise<QuestRun> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE quest.quest_runs
         SET status = $2, payload = $3::jsonb, updated_at = $4
         WHERE run_id = $1 AND updated_at = $5`,
        [run.runId, run.status, JSON.stringify(run), run.updatedAt, expectedUpdatedAt],
      );
      if (updated.rowCount !== 1) throw new Error("Quest state conflict; reload and retry formation");
      await client.query(
        `INSERT INTO quest.event_coordination_states (run_id, initiator_id, revision, lifecycle, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [state.runId, state.initiatorId, state.revision, state.lifecycle, JSON.stringify(state), state.updatedAt],
      );
      await this.persistEventCoordinationChildren(client, state);
      await client.query("COMMIT");
      return structuredClone(run);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createEventCoordinationState(state: EventCoordinationState): Promise<EventCoordinationState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO quest.event_coordination_states (run_id, initiator_id, revision, lifecycle, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [state.runId, state.initiatorId, state.revision, state.lifecycle, JSON.stringify(state), state.updatedAt],
      );
      await this.persistEventCoordinationChildren(client, state);
      await client.query("COMMIT");
      return structuredClone(state);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findEventCoordinationState(runId: string): Promise<EventCoordinationState | null> {
    const result = await this.pool.query<{ payload: EventCoordinationState }>(
      "SELECT payload FROM quest.event_coordination_states WHERE run_id = $1",
      [runId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async saveEventCoordinationState(
    state: EventCoordinationState,
    expectedRevision: number,
    eligibilityGuard?: EventRecruitmentEligibilityGuard,
  ): Promise<EventCoordinationState> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (eligibilityGuard) await this.assertRecruitmentEligibilityGuard(client, eligibilityGuard);
      const result = await client.query(
        `UPDATE quest.event_coordination_states
         SET revision = $2, lifecycle = $3, payload = $4::jsonb, updated_at = $5
         WHERE run_id = $1 AND revision = $6`,
        [state.runId, state.revision, state.lifecycle, JSON.stringify(state), state.updatedAt, expectedRevision],
      );
      if (result.rowCount !== 1) throw new Error("Quest state conflict; reload and retry");
      await this.persistEventCoordinationChildren(client, state);
      await client.query("COMMIT");
      return structuredClone(state);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertRecruitmentEligibilityGuard(
    client: PoolClient,
    guard: EventRecruitmentEligibilityGuard,
  ): Promise<void> {
    await client.query("LOCK TABLE quest.event_memberships IN SHARE MODE");
    await client.query("LOCK TABLE quest.event_arrangements IN SHARE MODE");
    await client.query("LOCK TABLE quest.quest_runs IN SHARE MODE");
    const profileIds = guard.profileVersions.map((profile) => profile.candidateId);
    const memory = await client.query<{ candidate_id: string; active_version: number }>(
      "SELECT candidate_id, active_version FROM memory.candidates WHERE candidate_id = ANY($1::text[]) FOR SHARE",
      [profileIds],
    );
    const activeVersions = new Map(memory.rows.map((row) => [row.candidate_id, Number(row.active_version)]));
    if (guard.profileVersions.some((profile) => activeVersions.get(profile.candidateId) !== profile.memoryVersion)) {
      throw new Error("The applicant's profile changed during approval; review the request again");
    }
    const conflict = await client.query<{ conflict: boolean }>(
      `WITH event_commitments AS (
         SELECT state.run_id AS quest_id,
                COALESCE(
                  (arrangement.payload->>'start')::timestamptz,
                  (state.payload->'proposal'->'quest'->'proposedTimeWindow'->>'start')::timestamptz
                ) AS starts_at,
                COALESCE(
                  (arrangement.payload->>'end')::timestamptz,
                  (state.payload->'proposal'->'quest'->'proposedTimeWindow'->>'end')::timestamptz
                ) AS ends_at
         FROM quest.event_coordination_states state
         JOIN quest.event_memberships membership ON membership.run_id = state.run_id
         LEFT JOIN LATERAL (
           SELECT payload FROM quest.event_arrangements candidate
           WHERE candidate.run_id = state.run_id AND candidate.status = 'finalized'
           ORDER BY candidate.version DESC LIMIT 1
         ) arrangement ON true
         WHERE membership.user_id = $1
           AND state.run_id <> $2
           AND state.lifecycle NOT IN ('completed', 'cancelled')
           AND membership.status IN ('coordinating', 'awaiting_confirmation', 'confirmed')
       ), legacy_commitments AS (
         SELECT run.run_id AS quest_id,
                (run.payload->'proposal'->'quest'->'proposedTimeWindow'->>'start')::timestamptz AS starts_at,
                (run.payload->'proposal'->'quest'->'proposedTimeWindow'->>'end')::timestamptz AS ends_at
         FROM quest.quest_runs run
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(run.payload->'coordination'->'invitations', '[]'::jsonb)) invitation
         WHERE run.run_id <> $2
           AND run.status IN ('awaiting_acceptance', 'confirmed', 'human_review')
           AND invitation->>'candidateId' = $1
           AND invitation->>'status' = 'accepted'
       )
       SELECT EXISTS (
         SELECT 1 FROM (SELECT * FROM event_commitments UNION ALL SELECT * FROM legacy_commitments) commitments
         WHERE starts_at IS NULL OR ends_at IS NULL OR (starts_at < $4::timestamptz AND ends_at > $3::timestamptz)
       ) AS conflict`,
      [guard.candidateId, guard.excludeRunId, guard.start, guard.end],
    );
    if (conflict.rows[0]?.conflict) throw new Error("The applicant gained an overlapping commitment during approval");
  }

  async listEventCoordinationStates(userId: string): Promise<EventCoordinationState[]> {
    const result = await this.pool.query<{ payload: EventCoordinationState }>(
      `SELECT payload
       FROM quest.event_coordination_states
       WHERE initiator_id = $1
          OR payload @> jsonb_build_object('roster', jsonb_build_array(jsonb_build_object('userId', $1::text)))
          OR payload @> jsonb_build_object('invitations', jsonb_build_array(jsonb_build_object('guestId', $1::text)))
          OR payload @> jsonb_build_object('memberships', jsonb_build_array(jsonb_build_object('userId', $1::text)))
       ORDER BY updated_at DESC`,
      [userId],
    );
    return result.rows.map((row) => row.payload);
  }

  async listAllEventCoordinationStates(limit = 50): Promise<EventCoordinationState[]> {
    const result = await this.pool.query<{ payload: EventCoordinationState }>(
      `SELECT payload FROM quest.event_coordination_states
       ORDER BY updated_at DESC LIMIT $1`,
      [Math.min(50, Math.max(1, limit))],
    );
    return result.rows.map((row) => row.payload);
  }

  async listRecruitingEventCoordinationStates(): Promise<EventCoordinationState[]> {
    const result = await this.pool.query<{ payload: EventCoordinationState }>(
      `SELECT payload FROM quest.event_coordination_states
       WHERE lifecycle = 'recruiting'
         AND payload @> '{"recruitment":{"status":"open"}}'::jsonb
       ORDER BY updated_at DESC`,
    );
    return result.rows.map((row) => row.payload);
  }

  private async persistEventCoordinationChildren(client: PoolClient, state: EventCoordinationState): Promise<void> {
    await client.query(
      `INSERT INTO quest.event_roster_versions (run_id, roster_revision, validation, created_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (run_id, roster_revision) DO UPDATE SET validation = EXCLUDED.validation`,
      [state.runId, state.rosterRevision, JSON.stringify(state.rosterValidation), state.updatedAt],
    );
    for (const member of state.roster) {
      await client.query(
        `INSERT INTO quest.event_roster_members
          (run_id, roster_revision, user_id, source, proposed_role, explanation)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (run_id, roster_revision, user_id) DO UPDATE
         SET source = EXCLUDED.source, proposed_role = EXCLUDED.proposed_role, explanation = EXCLUDED.explanation`,
        [state.runId, state.rosterRevision, member.userId, member.source, member.proposedRole, JSON.stringify(member.explanation)],
      );
    }
    for (const invitation of state.invitations) {
      await client.query(
        `INSERT INTO quest.event_invitations
          (invitation_id, run_id, inviter_id, guest_id, status, version, roster_revision,
           delivery_state, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (invitation_id) DO UPDATE
         SET status = EXCLUDED.status, version = EXCLUDED.version,
             delivery_state = EXCLUDED.delivery_state, updated_at = EXCLUDED.updated_at`,
        [invitation.invitationId, state.runId, invitation.inviterId, invitation.guestId,
          invitation.status, invitation.version, invitation.rosterRevision, invitation.deliveryState,
          invitation.idempotencyKey, invitation.createdAt, invitation.updatedAt],
      );
    }
    for (const request of state.joinRequests ?? []) {
      await client.query(
        `INSERT INTO quest.event_join_requests
          (request_id, run_id, applicant_id, status, version, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (request_id) DO UPDATE
         SET status = EXCLUDED.status, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
        [request.requestId, state.runId, request.applicantId, request.status, request.version,
          request.idempotencyKey, request.createdAt, request.updatedAt],
      );
    }
    for (const membership of state.memberships) {
      await client.query(
        `INSERT INTO quest.event_memberships
          (membership_id, run_id, user_id, role, roster_source, status, joined_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (membership_id) DO UPDATE
         SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
        [membership.membershipId, state.runId, membership.userId, membership.role,
          membership.rosterSource, membership.status, membership.joinedAt, membership.updatedAt],
      );
    }
    for (const thread of state.threads) {
      await client.query(
        `INSERT INTO quest.event_coordination_threads
          (thread_id, run_id, user_id, revision, last_read_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (thread_id) DO UPDATE
         SET revision = EXCLUDED.revision, last_read_at = EXCLUDED.last_read_at, updated_at = EXCLUDED.updated_at`,
        [thread.threadId, state.runId, thread.userId, thread.revision, thread.lastReadAt, thread.updatedAt],
      );
      for (const message of thread.messages) {
        await client.query(
          `INSERT INTO quest.event_coordination_messages
            (message_id, thread_id, role, kind, body, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (message_id) DO NOTHING`,
          [message.messageId, thread.threadId, message.role, message.kind, message.body, message.createdAt],
        );
      }
      await client.query(
        `INSERT INTO quest.event_participant_requirements
          (run_id, user_id, thread_revision, confirmed, pending, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         ON CONFLICT (run_id, user_id, thread_revision) DO UPDATE
         SET confirmed = EXCLUDED.confirmed, pending = EXCLUDED.pending, updated_at = EXCLUDED.updated_at`,
        [state.runId, thread.userId, thread.revision, JSON.stringify(thread.confirmedRequirements),
          thread.pendingRequirements ? JSON.stringify(thread.pendingRequirements) : null, thread.updatedAt],
      );
      await client.query(
        `INSERT INTO quest.event_participant_availability
          (run_id, user_id, requirement_revision, windows, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (run_id, user_id, requirement_revision) DO UPDATE
         SET windows = EXCLUDED.windows, updated_at = EXCLUDED.updated_at`,
        [state.runId, thread.userId, thread.revision,
          JSON.stringify(thread.confirmedRequirements.availableWindows), thread.updatedAt],
      );
    }
    for (const arrangement of state.arrangements) {
      await client.query(
        `INSERT INTO quest.event_arrangements
          (arrangement_id, run_id, version, status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (arrangement_id) DO UPDATE
         SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
        [arrangement.arrangementId, state.runId, arrangement.version, arrangement.status,
          JSON.stringify(arrangement), arrangement.createdAt, arrangement.updatedAt],
      );
      for (const confirmation of arrangement.confirmations) {
        await client.query(
          `INSERT INTO quest.event_arrangement_confirmations
            (arrangement_id, user_id, status, responded_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (arrangement_id, user_id) DO UPDATE
           SET status = EXCLUDED.status, responded_at = EXCLUDED.responded_at`,
          [arrangement.arrangementId, confirmation.userId, confirmation.status, confirmation.respondedAt],
        );
      }
    }
    for (const notification of state.notifications) {
      await client.query(
        `INSERT INTO quest.event_notifications
          (notification_id, run_id, user_id, kind, title, body, read_at, deduplication_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (notification_id) DO UPDATE SET read_at = EXCLUDED.read_at`,
        [notification.notificationId, state.runId, notification.userId, notification.kind,
          notification.title, notification.body, notification.readAt,
          notification.deduplicationKey, notification.createdAt],
      );
    }
    for (const event of state.auditEvents) {
      await client.query(
        `INSERT INTO quest.event_coordination_audit_events
          (event_id, run_id, event_type, actor_id, aggregate_revision, previous_lifecycle,
           new_lifecycle, idempotency_key, safe_diff, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
         ON CONFLICT (event_id) DO NOTHING`,
        [event.eventId, state.runId, event.type, event.actorId, event.aggregateRevision,
          event.previousLifecycle, event.newLifecycle, event.idempotencyKey,
          JSON.stringify(event.safeDiff), event.createdAt],
      );
    }
    for (const job of state.outbox) {
      await client.query(
        `INSERT INTO quest.event_outbox
          (job_id, run_id, kind, recipient_id, deduplication_key, payload, status, attempts, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         ON CONFLICT (job_id) DO UPDATE
         SET status = EXCLUDED.status, attempts = EXCLUDED.attempts, updated_at = EXCLUDED.updated_at`,
        [job.jobId, state.runId, job.kind, job.recipientId, job.deduplicationKey,
          JSON.stringify(job.payload), job.status, job.attempts, job.createdAt, job.updatedAt],
      );
    }
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

  async findLatestAssistantConversation(candidateId: string): Promise<AssistantConversationSnapshot | null> {
    const result = await this.pool.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM assistant.conversations
       WHERE candidate_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [candidateId],
    );
    const conversationId = result.rows[0]?.conversation_id;
    return conversationId ? this.findAssistantConversation(conversationId) : null;
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

  async replaceActiveEmbeddings(
    candidateId: string,
    memoryVersion: number,
    embeddings: CandidateEmbedding[],
  ): Promise<void> {
    if (embeddings.length !== 3 || embeddings.some((embedding) =>
      embedding.candidateId !== candidateId
      || embedding.memoryVersion !== memoryVersion
      || embedding.dimensions !== 1536)) {
      throw new Error("Exactly three embeddings for the active memory are required");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const active = await client.query<{ active_version: number }>(
        "SELECT active_version FROM memory.candidates WHERE candidate_id = $1 FOR UPDATE",
        [candidateId],
      );
      if (Number(active.rows[0]?.active_version ?? 0) !== memoryVersion) {
        throw new Error("Active memory changed during reindexing");
      }
      await client.query(
        "UPDATE retrieval.candidate_embeddings SET active = false WHERE candidate_id = $1",
        [candidateId],
      );
      for (const embedding of embeddings) {
        await client.query(
          `INSERT INTO retrieval.candidate_embeddings
             (candidate_id, memory_version, kind, model, dimensions, embedding, active)
           VALUES ($1, $2, $3, $4, $5, $6::vector, true)
           ON CONFLICT (candidate_id, memory_version, kind) DO UPDATE SET
             model = EXCLUDED.model,
             dimensions = EXCLUDED.dimensions,
             embedding = EXCLUDED.embedding,
             active = true,
             created_at = now()`,
          [
            candidateId,
            memoryVersion,
            embedding.kind,
            embedding.model,
            embedding.dimensions,
            this.vectorLiteral(embedding.vector),
          ],
        );
      }
      await client.query(
        `INSERT INTO retrieval.indexing_jobs
           (job_id, candidate_id, memory_version, status, updated_at)
         VALUES ($1, $2, $3, 'completed', now())`,
        [`reindex_${randomUUID().replaceAll("-", "").slice(0, 16)}`, candidateId, memoryVersion],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async searchEmbeddings(input: EmbeddingSearchInput): Promise<Array<{ candidateId: string; similarity: number }>> {
    if (input.candidateIds?.length === 0) return [];
    const result = await this.pool.query<{ candidate_id: string; similarity: string | number }>(
      `SELECT candidate_id, 1 - (embedding <=> $1::vector) AS similarity
       FROM retrieval.candidate_embeddings
       WHERE kind = $2 AND model = $3 AND dimensions = $4 AND active = true
         AND ($6::text[] IS NULL OR candidate_id = ANY($6::text[]))
       ORDER BY embedding <=> $1::vector
       LIMIT $5`,
      [
        this.vectorLiteral(input.query),
        input.kind,
        input.model,
        input.dimensions,
        input.limit,
        input.candidateIds ?? null,
      ],
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

  async saveQuestImage(runId: string, imageUrl: string, expectedUpdatedAt: string): Promise<boolean> {
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1)).toISOString();
    const result = await this.pool.query(
      `UPDATE quest.quest_runs
       SET payload = jsonb_set(
         jsonb_set(payload, '{imageUrl}', to_jsonb($2::text), true),
         '{updatedAt}', to_jsonb($3::text), true
       ), updated_at = $3
       WHERE run_id = $1 AND updated_at = $4
       RETURNING run_id`,
      [runId, imageUrl, updatedAt, expectedUpdatedAt],
    );
    return result.rowCount === 1;
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
    const result = await this.pool.query<{ payload: QuestRun; updated_at: Date | string }>(
      "SELECT payload, updated_at FROM quest.quest_runs WHERE run_id = $1",
      [runId],
    );
    const row = result.rows[0];
    return row ? { ...row.payload, updatedAt: new Date(row.updated_at).toISOString() } : null;
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
      "SELECT payload FROM quest.quest_runs WHERE idempotency_key = $1 OR payload->'participantIdempotencyKeys' ? $1",
      [key],
    );
    return result.rows[0]?.payload ?? null;
  }

  async listQuestRuns(candidateId: string, limit: number): Promise<QuestRun[]> {
    const result = await this.pool.query<{ payload: QuestRun }>(
      `SELECT payload
       FROM quest.quest_runs
       WHERE initiating_candidate_id = $1
          OR payload->'proposal'->'proposedParticipants' @> jsonb_build_array(jsonb_build_object('candidateId', $1))
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(payload->'coordination'->'invitations', '[]'::jsonb)) AS invitation
            WHERE invitation->>'candidateId' = $1
          )
       ORDER BY created_at DESC
       LIMIT $2`,
      [candidateId, Math.min(50, Math.max(1, limit))],
    );
    return result.rows.map((row) => row.payload).filter((run) => canViewQuestRun(run, candidateId));
  }

  async listJoinableQuestRuns(limit: number): Promise<QuestRun[]> {
    const result = await this.pool.query<{ payload: QuestRun }>(
      `SELECT payload FROM quest.quest_runs
       WHERE status IN ('awaiting_acceptance', 'confirmed')
         AND payload->'proposal' IS NOT NULL AND payload->'coordination' IS NOT NULL
         AND (payload->'proposal'->'quest'->'proposedTimeWindow'->>'start')::timestamptz > NOW()
       ORDER BY updated_at DESC LIMIT $1`,
      [Math.min(50, Math.max(1, limit))],
    );
    return result.rows.map((row) => row.payload).filter(isJoinableQuestRun);
  }

  async listAcceptedCandidateIds(): Promise<string[]> {
    return [...new Set((await this.listAcceptedCommitments()).map((commitment) => commitment.candidateId))];
  }

  async listAcceptedCommitments(): Promise<CandidateCommitment[]> {
    const result = await this.pool.query<{
      candidate_id: string;
      quest_id: string;
      starts_at: string | Date | null;
      ends_at: string | Date | null;
    }>(
      `WITH legacy AS (
         SELECT invitation->>'candidateId' AS candidate_id,
                run.run_id AS quest_id,
                (run.payload->'proposal'->'quest'->'proposedTimeWindow'->>'start')::timestamptz AS starts_at,
                (run.payload->'proposal'->'quest'->'proposedTimeWindow'->>'end')::timestamptz AS ends_at,
                2 AS source_priority
         FROM quest.quest_runs run
         CROSS JOIN LATERAL jsonb_array_elements(
           COALESCE(run.payload->'coordination'->'invitations', '[]'::jsonb)
         ) AS invitation
         WHERE run.status IN ('awaiting_acceptance', 'confirmed', 'human_review')
           AND invitation->>'status' = 'accepted'
           AND invitation->>'candidateId' IS NOT NULL
           AND (run.payload->'proposal' IS NULL
             OR (run.payload->'proposal'->'quest'->'proposedTimeWindow'->>'end')::timestamptz > NOW())
       ), event_commitments AS (
         SELECT membership.user_id AS candidate_id,
                state.run_id AS quest_id,
                COALESCE(
                  (arrangement.payload->>'start')::timestamptz,
                  (state.payload->'proposal'->'quest'->'proposedTimeWindow'->>'start')::timestamptz
                ) AS starts_at,
                COALESCE(
                  (arrangement.payload->>'end')::timestamptz,
                  (state.payload->'proposal'->'quest'->'proposedTimeWindow'->>'end')::timestamptz
                ) AS ends_at,
                1 AS source_priority
         FROM quest.event_coordination_states state
         JOIN quest.event_memberships membership ON membership.run_id = state.run_id
         LEFT JOIN LATERAL (
           SELECT payload FROM quest.event_arrangements candidate
           WHERE candidate.run_id = state.run_id AND candidate.status = 'finalized'
           ORDER BY candidate.version DESC LIMIT 1
         ) arrangement ON true
         WHERE state.lifecycle NOT IN ('completed', 'cancelled')
           AND membership.status IN ('coordinating', 'awaiting_confirmation', 'confirmed')
       )
       SELECT DISTINCT ON (candidate_id, quest_id)
              candidate_id, quest_id, starts_at, ends_at
       FROM (SELECT * FROM legacy UNION ALL SELECT * FROM event_commitments) commitments
       WHERE ends_at IS NULL OR ends_at > NOW()
       ORDER BY candidate_id, quest_id, source_priority, starts_at NULLS FIRST`,
    );
    return result.rows.map((row) => ({
      candidateId: row.candidate_id,
      questId: row.quest_id,
      start: row.starts_at === null
        ? null
        : row.starts_at instanceof Date ? row.starts_at.toISOString() : new Date(row.starts_at).toISOString(),
      end: row.ends_at === null
        ? null
        : row.ends_at instanceof Date ? row.ends_at.toISOString() : new Date(row.ends_at).toISOString(),
    }));
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
