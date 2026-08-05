CREATE TABLE IF NOT EXISTS quest.event_suggestion_dismissals (
  user_id text NOT NULL,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, run_id)
);
