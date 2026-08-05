CREATE TABLE IF NOT EXISTS quest.event_group_coordination_threads (
  thread_id text PRIMARY KEY,
  run_id text NOT NULL UNIQUE REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS quest.event_group_coordination_messages (
  message_id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES quest.event_group_coordination_threads(thread_id) ON DELETE CASCADE,
  sender_id text,
  role text NOT NULL CHECK (role IN ('participant', 'assistant', 'system')),
  kind text NOT NULL CHECK (kind IN ('text', 'invitation_card', 'arrangement_card', 'change_card')),
  body text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS event_group_coordination_messages_order_idx
  ON quest.event_group_coordination_messages (thread_id, created_at, message_id);

CREATE TABLE IF NOT EXISTS quest.event_group_coordination_reads (
  thread_id text NOT NULL REFERENCES quest.event_group_coordination_threads(thread_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS quest.event_appointment_suggestions (
  suggestion_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  based_on_revision integer NOT NULL CHECK (based_on_revision > 0),
  source_message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('offered', 'accepted', 'expired')),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS event_appointment_suggestions_current_idx
  ON quest.event_appointment_suggestions (run_id, created_at DESC)
  WHERE status = 'offered';
