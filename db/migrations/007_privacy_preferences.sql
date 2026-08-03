ALTER TABLE identity.user_preferences
  ADD COLUMN IF NOT EXISTS profile_visibility text NOT NULL DEFAULT 'community',
  ADD COLUMN IF NOT EXISTS message_privacy text NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS show_online_status boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_preferences_profile_visibility_check'
      AND conrelid = 'identity.user_preferences'::regclass
  ) THEN
    ALTER TABLE identity.user_preferences
      ADD CONSTRAINT user_preferences_profile_visibility_check
      CHECK (profile_visibility IN ('community', 'connections', 'private'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_preferences_message_privacy_check'
      AND conrelid = 'identity.user_preferences'::regclass
  ) THEN
    ALTER TABLE identity.user_preferences
      ADD CONSTRAINT user_preferences_message_privacy_check
      CHECK (message_privacy IN ('everyone', 'connections', 'nobody'));
  END IF;
END $$;
