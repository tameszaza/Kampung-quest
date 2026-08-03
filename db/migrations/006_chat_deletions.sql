CREATE TABLE IF NOT EXISTS chat.conversation_deletions (
  conversation_id text NOT NULL REFERENCES chat.conversations(conversation_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES identity.users(user_id) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_deletions_user_idx
  ON chat.conversation_deletions(user_id, deleted_at DESC);
