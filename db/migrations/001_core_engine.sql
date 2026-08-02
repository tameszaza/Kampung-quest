CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS memory;
CREATE SCHEMA IF NOT EXISTS retrieval;
CREATE SCHEMA IF NOT EXISTS quest;

CREATE TABLE IF NOT EXISTS memory.candidates (
  candidate_id text PRIMARY KEY,
  profile jsonb NOT NULL,
  active_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory.memory_events (
  event_id text PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES memory.candidates(candidate_id) ON DELETE CASCADE,
  version integer NOT NULL,
  narrative text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, version)
);

CREATE TABLE IF NOT EXISTS memory.memory_versions (
  candidate_id text NOT NULL REFERENCES memory.candidates(candidate_id) ON DELETE CASCADE,
  version integer NOT NULL,
  profile jsonb NOT NULL,
  narrative text NOT NULL,
  markdown text,
  retrieval_ready boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'superseded', 'failed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, version)
);

CREATE TABLE IF NOT EXISTS memory.constraint_versions (
  candidate_id text NOT NULL,
  memory_version integer NOT NULL,
  constraints jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, memory_version),
  FOREIGN KEY (candidate_id, memory_version)
    REFERENCES memory.memory_versions(candidate_id, version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory.memory_facts (
  candidate_id text NOT NULL,
  memory_version integer NOT NULL,
  fact_ref text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('need', 'interest', 'offer')),
  fact_text text NOT NULL,
  confidence double precision NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, memory_version, fact_ref),
  FOREIGN KEY (candidate_id, memory_version)
    REFERENCES memory.memory_versions(candidate_id, version) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory.agent_runs (
  run_id text PRIMARY KEY,
  role text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  outcome text NOT NULL,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retrieval.indexing_jobs (
  job_id text PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES memory.candidates(candidate_id) ON DELETE CASCADE,
  memory_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retrieval.candidate_embeddings (
  candidate_id text NOT NULL,
  memory_version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('need', 'interest', 'offer')),
  model text NOT NULL,
  dimensions integer NOT NULL,
  embedding vector(1536) NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, memory_version, kind),
  FOREIGN KEY (candidate_id, memory_version)
    REFERENCES memory.memory_versions(candidate_id, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS candidate_embeddings_active_kind_idx
  ON retrieval.candidate_embeddings (active, kind);
CREATE INDEX IF NOT EXISTS candidate_embeddings_vector_idx
  ON retrieval.candidate_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS quest.quest_runs (
  run_id text PRIMARY KEY,
  initiating_candidate_id text NOT NULL REFERENCES memory.candidates(candidate_id),
  idempotency_key text UNIQUE,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS quest.coordination_events (
  event_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.quest_runs(run_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  candidate_id text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS coordination_events_run_idx
  ON quest.coordination_events (run_id, occurred_at);
