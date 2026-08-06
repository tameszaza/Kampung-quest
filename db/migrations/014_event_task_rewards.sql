CREATE TABLE IF NOT EXISTS quest.event_task_plans (
  plan_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  roster_revision integer NOT NULL CHECK (roster_revision > 0),
  arrangement_version integer NOT NULL CHECK (arrangement_version > 0),
  status text NOT NULL CHECK (status IN (
    'generation_pending', 'awaiting_acknowledgement', 'active',
    'generation_failed', 'suspended', 'superseded'
  )),
  quest_goal_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

DROP INDEX IF EXISTS quest.event_task_plans_active_idx;
CREATE UNIQUE INDEX event_task_plans_active_idx
  ON quest.event_task_plans (run_id, roster_revision, quest_goal_hash)
  WHERE status NOT IN ('superseded', 'suspended');

CREATE TABLE IF NOT EXISTS quest.event_final_roles (
  plan_id text NOT NULL REFERENCES quest.event_task_plans(plan_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  name text NOT NULL,
  responsibility text NOT NULL,
  main_contribution text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'acknowledged', 'concern_raised')),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (plan_id, user_id)
);

CREATE TABLE IF NOT EXISTS quest.event_tasks (
  task_id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES quest.event_task_plans(plan_id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  title text NOT NULL,
  instruction text NOT NULL,
  role_user_id text NOT NULL,
  reviewer_id text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  points integer NOT NULL CHECK (points IN (10, 20, 30)),
  status text NOT NULL CHECK (status IN ('assigned', 'acknowledged', 'submitted', 'approved', 'needs_retry')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS event_tasks_assignee_lookup_idx
  ON quest.event_tasks (run_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS quest.event_task_assignees (
  task_id text NOT NULL REFERENCES quest.event_tasks(task_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  acknowledged_at timestamptz,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS quest.event_task_reassignments (
  request_id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES quest.event_tasks(task_id) ON DELETE CASCADE,
  requester_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_admin', 'approved', 'rejected')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE SCHEMA IF NOT EXISTS rewards;

CREATE TABLE IF NOT EXISTS rewards.point_ledger (
  entry_id text PRIMARY KEY,
  user_id text NOT NULL,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES quest.event_tasks(task_id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points <> 0),
  kind text NOT NULL CHECK (kind IN ('task_award', 'reversal')),
  reverses_entry_id text REFERENCES rewards.point_ledger(entry_id),
  actor_id text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_task_award_once_idx
  ON rewards.point_ledger (task_id, user_id)
  WHERE kind = 'task_award';

CREATE INDEX IF NOT EXISTS point_ledger_user_history_idx
  ON rewards.point_ledger (user_id, created_at DESC);
