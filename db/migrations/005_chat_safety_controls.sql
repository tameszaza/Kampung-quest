CREATE TABLE IF NOT EXISTS chat.user_blocks (
  blocker_id text NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON chat.user_blocks(blocked_id, blocker_id);
