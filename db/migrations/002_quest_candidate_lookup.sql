CREATE INDEX IF NOT EXISTS quest_runs_candidate_created_idx
  ON quest.quest_runs (initiating_candidate_id, created_at DESC);
