CREATE SCHEMA IF NOT EXISTS assistant;

CREATE TABLE IF NOT EXISTS assistant.conversations (
  conversation_id text PRIMARY KEY,
  candidate_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'collecting', 'ready_for_review', 'confirmed', 'processing', 'complete', 'no_match', 'failed'
  )),
  revision integer NOT NULL,
  brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_field text,
  suggested_replies jsonb NOT NULL DEFAULT '[]'::jsonb,
  quest_run_id text,
  error_message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant.messages (
  message_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES assistant.conversations(conversation_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx
  ON assistant.messages (conversation_id, created_at, message_id);

CREATE TABLE IF NOT EXISTS assistant.workflow_events (
  conversation_id text NOT NULL REFERENCES assistant.conversations(conversation_id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  stage text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  message text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('agent', 'system')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, sequence)
);

UPDATE memory.candidates
SET profile = jsonb_set(profile, '{source}', '"test"'::jsonb, true)
WHERE candidate_id LIKE 'integration\_%' ESCAPE '\' OR candidate_id LIKE 'smoke\_%' ESCAPE '\';

UPDATE memory.memory_versions
SET profile = jsonb_set(profile, '{source}', '"test"'::jsonb, true)
WHERE candidate_id LIKE 'integration\_%' ESCAPE '\' OR candidate_id LIKE 'smoke\_%' ESCAPE '\';
