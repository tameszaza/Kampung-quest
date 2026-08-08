CREATE INDEX IF NOT EXISTS messages_conversation_order_idx
  ON chat.messages(conversation_id, created_at DESC, message_id DESC);

CREATE INDEX IF NOT EXISTS conversation_members_user_conversation_idx
  ON chat.conversation_members(user_id, conversation_id);

CREATE INDEX IF NOT EXISTS event_roster_members_user_run_revision_idx
  ON quest.event_roster_members(user_id, run_id, roster_revision);

CREATE INDEX IF NOT EXISTS event_invitations_guest_run_idx
  ON quest.event_invitations(guest_id, run_id);
