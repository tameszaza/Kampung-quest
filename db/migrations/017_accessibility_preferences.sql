ALTER TABLE identity.user_preferences
  ADD COLUMN IF NOT EXISTS stairs_allowed boolean,
  ADD COLUMN IF NOT EXISTS maximum_distance_m integer,
  ADD COLUMN IF NOT EXISTS quest_language text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_preferences_maximum_distance_check'
      AND conrelid = 'identity.user_preferences'::regclass
  ) THEN
    ALTER TABLE identity.user_preferences
      ADD CONSTRAINT user_preferences_maximum_distance_check
      CHECK (maximum_distance_m IS NULL OR maximum_distance_m > 0);
  END IF;
END $$;
