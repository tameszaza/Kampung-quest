ALTER TABLE assistant.messages
  ADD COLUMN IF NOT EXISTS position integer;

WITH ranked AS (
  SELECT message_id,
         row_number() OVER (PARTITION BY conversation_id ORDER BY created_at, message_id) - 1 AS position
  FROM assistant.messages
)
UPDATE assistant.messages AS message
SET position = ranked.position
FROM ranked
WHERE message.message_id = ranked.message_id
  AND message.position IS NULL;

ALTER TABLE assistant.messages
  ALTER COLUMN position SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS assistant_messages_conversation_position_idx
  ON assistant.messages (conversation_id, position);

UPDATE memory.candidates
SET profile = jsonb_set(profile, '{source}', '"real"'::jsonb, true)
WHERE NOT profile ? 'source';

UPDATE memory.memory_versions
SET profile = jsonb_set(profile, '{source}', '"real"'::jsonb, true)
WHERE NOT profile ? 'source';
