CREATE TABLE IF NOT EXISTS quest.event_coordination_states (
  run_id text PRIMARY KEY REFERENCES quest.quest_runs(run_id) ON DELETE CASCADE,
  initiator_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  lifecycle text NOT NULL CHECK (lifecycle IN (
    'forming', 'awaiting_responses', 'coordinating', 'awaiting_confirmation',
    'scheduled', 'in_progress', 'completed', 'cancelled', 'human_review'
  )),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS event_coordination_initiator_updated_idx
  ON quest.event_coordination_states (initiator_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS event_coordination_payload_idx
  ON quest.event_coordination_states USING gin (payload jsonb_path_ops);

CREATE TABLE IF NOT EXISTS quest.event_roster_versions (
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  roster_revision integer NOT NULL CHECK (roster_revision > 0),
  validation jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, roster_revision)
);

CREATE TABLE IF NOT EXISTS quest.event_roster_members (
  run_id text NOT NULL,
  roster_revision integer NOT NULL,
  user_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('initiator', 'recommended', 'manual')),
  proposed_role text NOT NULL,
  explanation jsonb NOT NULL,
  PRIMARY KEY (run_id, roster_revision, user_id),
  FOREIGN KEY (run_id, roster_revision)
    REFERENCES quest.event_roster_versions(run_id, roster_revision) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quest.event_invitations (
  invitation_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  inviter_id text NOT NULL,
  guest_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn', 'replaced', 'cancelled')),
  version integer NOT NULL CHECK (version > 0),
  roster_revision integer NOT NULL,
  delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'delivered', 'failed', 'cancelled')),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS event_invitations_active_guest_idx
  ON quest.event_invitations (run_id, guest_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS event_invitations_pending_guest_idx
  ON quest.event_invitations (guest_id, updated_at DESC) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS quest.event_memberships (
  membership_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('organizer', 'participant')),
  roster_source text NOT NULL CHECK (roster_source IN ('initiator', 'recommended', 'manual')),
  status text NOT NULL CHECK (status IN ('coordinating', 'awaiting_confirmation', 'confirmed', 'completed', 'withdrawn', 'replaced', 'cancelled')),
  joined_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS event_memberships_active_user_idx
  ON quest.event_memberships (run_id, user_id)
  WHERE status IN ('coordinating', 'awaiting_confirmation', 'confirmed');
CREATE INDEX IF NOT EXISTS event_memberships_user_status_idx
  ON quest.event_memberships (user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS quest.event_coordination_threads (
  thread_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  last_read_at timestamptz,
  updated_at timestamptz NOT NULL,
  UNIQUE (run_id, user_id)
);

CREATE TABLE IF NOT EXISTS quest.event_coordination_messages (
  message_id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES quest.event_coordination_threads(thread_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('participant', 'assistant', 'system')),
  kind text NOT NULL CHECK (kind IN ('text', 'invitation_card', 'arrangement_card', 'change_card')),
  body text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS event_coordination_messages_order_idx
  ON quest.event_coordination_messages (thread_id, created_at, message_id);

CREATE TABLE IF NOT EXISTS quest.event_participant_requirements (
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  thread_revision integer NOT NULL,
  confirmed jsonb NOT NULL,
  pending jsonb,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, user_id, thread_revision)
);

CREATE TABLE IF NOT EXISTS quest.event_participant_availability (
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  requirement_revision integer NOT NULL,
  windows jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, user_id, requirement_revision)
);

CREATE TABLE IF NOT EXISTS quest.event_arrangements (
  arrangement_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'initiator_approved', 'awaiting_participant_confirmation', 'finalized', 'superseded', 'rejected')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (run_id, version)
);

CREATE TABLE IF NOT EXISTS quest.event_arrangement_confirmations (
  arrangement_id text NOT NULL REFERENCES quest.event_arrangements(arrangement_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  responded_at timestamptz,
  PRIMARY KEY (arrangement_id, user_id)
);

CREATE INDEX IF NOT EXISTS event_arrangement_confirmations_pending_idx
  ON quest.event_arrangement_confirmations (user_id, arrangement_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS quest.event_notifications (
  notification_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  deduplication_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS event_notifications_unread_idx
  ON quest.event_notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS quest.event_coordination_audit_events (
  event_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id text,
  aggregate_revision integer NOT NULL CHECK (aggregate_revision > 0),
  previous_lifecycle text NOT NULL,
  new_lifecycle text NOT NULL,
  idempotency_key text,
  safe_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS event_coordination_audit_idempotency_idx
  ON quest.event_coordination_audit_events (run_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS quest.event_outbox (
  job_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invitation', 'notification')),
  recipient_id text NOT NULL,
  deduplication_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS event_outbox_delivery_idx
  ON quest.event_outbox (status, updated_at)
  WHERE status IN ('pending', 'failed');
