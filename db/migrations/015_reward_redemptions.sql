CREATE SCHEMA IF NOT EXISTS rewards;

CREATE TABLE IF NOT EXISTS rewards.accounts (
  user_id text PRIMARY KEY REFERENCES identity.users(user_id) ON DELETE RESTRICT,
  balance integer NOT NULL DEFAULT 0 CONSTRAINT reward_accounts_balance_check CHECK (balance >= 0),
  lifetime_points integer NOT NULL DEFAULT 0 CONSTRAINT reward_accounts_lifetime_points_check CHECK (lifetime_points >= 0),
  version integer NOT NULL DEFAULT 1 CONSTRAINT reward_accounts_version_check CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rewards.accounts
  DROP CONSTRAINT IF EXISTS reward_accounts_balance_check,
  DROP CONSTRAINT IF EXISTS reward_accounts_lifetime_points_check,
  DROP CONSTRAINT IF EXISTS reward_accounts_version_check,
  ADD CONSTRAINT reward_accounts_balance_check CHECK (balance >= 0),
  ADD CONSTRAINT reward_accounts_lifetime_points_check CHECK (lifetime_points >= 0),
  ADD CONSTRAINT reward_accounts_version_check CHECK (version > 0);

CREATE TABLE IF NOT EXISTS rewards.offers (
  offer_id text PRIMARY KEY,
  company text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  value_text text NOT NULL,
  points_cost integer NOT NULL CHECK (points_cost > 0),
  status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'retired')),
  starts_at timestamptz,
  ends_at timestamptz NOT NULL,
  max_redemptions_per_user integer NOT NULL CHECK (max_redemptions_per_user > 0),
  locations text NOT NULL,
  terms text NOT NULL,
  presentation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rewards.offer_codes (
  code_id text PRIMARY KEY,
  offer_id text NOT NULL REFERENCES rewards.offers(offer_id) ON DELETE RESTRICT,
  code_fingerprint text NOT NULL UNIQUE,
  encrypted_code bytea NOT NULL,
  encryption_key_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('available', 'issued', 'void')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_codes_available_idx
  ON rewards.offer_codes (offer_id, status, expires_at, created_at);

CREATE TABLE IF NOT EXISTS rewards.redemptions (
  redemption_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES identity.users(user_id) ON DELETE RESTRICT,
  offer_id text NOT NULL REFERENCES rewards.offers(offer_id) ON DELETE RESTRICT,
  code_id text NOT NULL UNIQUE REFERENCES rewards.offer_codes(code_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('issued', 'used', 'cancelled')),
  points_cost integer NOT NULL CHECK (points_cost > 0),
  offer_title_snapshot text NOT NULL,
  company_snapshot text NOT NULL,
  description_snapshot text NOT NULL,
  value_snapshot text NOT NULL,
  locations_snapshot text NOT NULL,
  terms_snapshot text NOT NULL,
  effective_expires_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  redeemed_at timestamptz NOT NULL,
  used_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS redemptions_user_idempotency_idx
  ON rewards.redemptions (user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS redemptions_user_status_idx
  ON rewards.redemptions (user_id, status, effective_expires_at, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS redemptions_offer_user_idx
  ON rewards.redemptions (offer_id, user_id, status);

ALTER TABLE rewards.point_ledger
  ALTER COLUMN run_id DROP NOT NULL,
  ALTER COLUMN task_id DROP NOT NULL;

ALTER TABLE rewards.point_ledger
  DROP CONSTRAINT IF EXISTS point_ledger_run_id_fkey,
  DROP CONSTRAINT IF EXISTS point_ledger_task_id_fkey,
  DROP CONSTRAINT IF EXISTS point_ledger_kind_check,
  DROP CONSTRAINT IF EXISTS point_ledger_points_check,
  DROP CONSTRAINT IF EXISTS point_ledger_source_type_check,
  DROP CONSTRAINT IF EXISTS point_ledger_kind_sign_source_check;

ALTER TABLE rewards.point_ledger
  ADD COLUMN IF NOT EXISTS redemption_id text REFERENCES rewards.redemptions(redemption_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'event_task',
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE rewards.point_ledger
   SET source_id = entry_id
 WHERE source_id IS NULL;

ALTER TABLE rewards.point_ledger
  ALTER COLUMN source_id SET NOT NULL,
  ADD CONSTRAINT point_ledger_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES quest.event_coordination_states(run_id) ON DELETE SET NULL,
  ADD CONSTRAINT point_ledger_task_id_fkey
    FOREIGN KEY (task_id) REFERENCES quest.event_tasks(task_id) ON DELETE SET NULL,
  ADD CONSTRAINT point_ledger_kind_check
    CHECK (kind IN ('activity_award', 'task_award', 'reversal', 'redemption_debit', 'redemption_refund')),
  ADD CONSTRAINT point_ledger_points_check CHECK (points <> 0),
  ADD CONSTRAINT point_ledger_source_type_check
    CHECK (source_type IN ('legacy_activity', 'event_task', 'redemption', 'admin')),
  ADD CONSTRAINT point_ledger_kind_sign_source_check
    CHECK (
      (kind = 'activity_award' AND points > 0 AND source_type = 'legacy_activity' AND redemption_id IS NULL)
      OR (kind = 'task_award' AND points > 0 AND source_type = 'event_task' AND redemption_id IS NULL)
      OR (kind = 'reversal' AND points < 0 AND source_type IN ('event_task', 'admin') AND redemption_id IS NULL)
      OR (kind = 'redemption_debit' AND points < 0 AND source_type = 'redemption' AND redemption_id IS NOT NULL)
      OR (kind = 'redemption_refund' AND points > 0 AND source_type = 'redemption' AND redemption_id IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_redemption_debit_once_idx
  ON rewards.point_ledger (redemption_id)
 WHERE kind = 'redemption_debit';
CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_redemption_refund_once_idx
  ON rewards.point_ledger (redemption_id)
 WHERE kind = 'redemption_refund';
CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_activity_award_once_idx
  ON rewards.point_ledger (run_id, user_id)
 WHERE kind = 'activity_award';
CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_reversal_once_idx
  ON rewards.point_ledger (reverses_entry_id)
 WHERE kind = 'reversal' AND reverses_entry_id IS NOT NULL;

INSERT INTO rewards.offers
  (offer_id, company, title, description, category, value_text, points_cost, status,
   ends_at, max_redemptions_per_user, locations, terms, presentation)
VALUES
  ('sunrise-cafe-set', 'Toast Box', 'Free Drink or Snack Set',
   'Choose one drink and one snack from the selected menu at participating neighbourhood outlets.',
   'Food & drink', 'One drink and one snack set', 250, 'active',
   '2026-12-31T23:59:59.999Z', 1, 'Selected neighbourhood outlets',
   'Valid at participating neighbourhood outlets. One code per member.',
   '{"initials":"SC","tone":"amber","partnerDescription":"Toast Box brings familiar food, drinks, and a welcoming café setting together for a relaxed community break.","redemptionSteps":["Complete or attend any Senior Quest activity.","Choose this reward when you have enough points.","Show the reward code to the café team.","Enjoy your drink or snack set."]}'::jsonb),
  ('green-garden-credit', 'Green Garden Centre', '$5 gardening credit',
   'Use towards herbs, seeds, or small gardening supplies.',
   'Hobbies', '$5 off gardening supplies', 350, 'active',
   '2026-12-31T23:59:59.999Z', 1, 'Participating garden centres',
   'Valid at participating garden centres. One code per member.',
   '{"initials":"GG","tone":"green","partnerDescription":"Green Garden Centre helps neighbours keep growing with practical supplies for balconies, windowsills, and community gardens.","redemptionSteps":["Complete or attend any Senior Quest activity.","Choose this reward when you have enough points.","Show the reward code at a participating centre.","Use the credit on eligible gardening supplies."]}'::jsonb),
  ('community-cinema-ticket', 'Community Cinema', 'Weekday movie ticket',
   'One standard weekday admission at selected community screenings.',
   'Leisure', 'One weekday cinema ticket', 400, 'active',
   '2026-11-30T23:59:59.999Z', 1, 'Selected community screenings',
   'Valid for selected weekday screenings. One code per member.',
   '{"initials":"CC","tone":"violet","partnerDescription":"Community Cinema brings people together for affordable weekday screenings and relaxed shared experiences.","redemptionSteps":["Complete or attend any Senior Quest activity.","Choose this reward when you have enough points.","Show the reward code at the cinema desk.","Enjoy the film with your community."]}'::jsonb),
  ('neighbourhood-grocer-voucher', 'Neighbourhood Grocer', '$5 grocery voucher',
   'Save on fresh food and daily essentials at participating stores.',
   'Daily essentials', '$5 toward fresh food and essentials', 500, 'active',
   '2026-12-31T23:59:59.999Z', 1, 'Participating neighbourhood stores',
   'Valid at participating neighbourhood stores. One code per member.',
   '{"initials":"NG","tone":"mint","partnerDescription":"Neighbourhood Grocer supports everyday wellbeing with fresh food, household essentials, and friendly local service.","redemptionSteps":["Complete or attend any Senior Quest activity.","Choose this reward when you have enough points.","Show the reward code at checkout.","Use the credit on eligible items."]}'::jsonb),
  ('city-rides-credit', 'City Rides', '$5 ride credit',
   'A little help getting to your next community activity.',
   'Transport', '$5 toward a community trip', 600, 'active',
   '2026-10-31T23:59:59.999Z', 1, 'Within participating service areas',
   'Valid within participating service areas. One code per member.',
   '{"initials":"CR","tone":"blue","partnerDescription":"City Rides helps members travel to community activities, appointments, and the people who matter to them.","redemptionSteps":["Complete or attend any Senior Quest activity.","Choose this reward when you have enough points.","Apply the reward code to an eligible trip.","Travel safely to your next destination."]}'::jsonb),
  ('wellness-pharmacy-voucher', 'Wellness Pharmacy', '$8 wellbeing voucher',
   'Use on selected personal care and wellbeing essentials.',
   'Wellbeing', '$8 toward selected wellbeing essentials', 700, 'active',
   '2026-12-31T23:59:59.999Z', 1, 'Participating Wellness Pharmacy outlets',
   'Valid at participating Wellness Pharmacy outlets. One code per member.',
   '{"initials":"WP","tone":"rose","partnerDescription":"Wellness Pharmacy offers approachable personal care and wellbeing essentials for everyday routines.","redemptionSteps":["Complete or attend any Senior Quest activity.","Choose this reward when you have enough points.","Show the reward code to staff.","Use it on selected eligible products."]}'::jsonb)
ON CONFLICT (offer_id) DO NOTHING;

-- Convert legacy completed-event points into durable entries before the new
-- wallet is used. Events with a non-superseded task plan are intentionally
-- excluded because their task ledger is the authoritative award path.
INSERT INTO rewards.point_ledger
  (entry_id, user_id, run_id, task_id, redemption_id, points, kind,
   source_type, source_id, reverses_entry_id, actor_id, reason, metadata, created_at)
SELECT
  'legacy_activity:' || state.run_id || ':' || (membership->>'userId'),
  membership->>'userId',
  state.run_id,
  NULL,
  NULL,
  100,
  'activity_award',
  'legacy_activity',
  state.run_id,
  NULL,
  state.initiator_id,
  'Legacy completed activity award',
  '{}'::jsonb,
  state.updated_at
FROM quest.event_coordination_states state
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(state.payload->'memberships', '[]'::jsonb)) AS membership
WHERE state.lifecycle = 'completed'
  AND membership->>'status' = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(state.payload->'taskPlans', '[]'::jsonb)) AS task_plan
    WHERE task_plan->>'status' NOT IN ('superseded', 'generation_failed')
  )
ON CONFLICT (entry_id) DO NOTHING;

INSERT INTO rewards.accounts (user_id, balance, lifetime_points, version, created_at, updated_at)
SELECT user_id,
       COALESCE(sum(points), 0),
       GREATEST(0, COALESCE(sum(points) FILTER (WHERE kind IN ('activity_award', 'task_award', 'reversal')), 0)),
       1,
       now(),
       now()
FROM rewards.point_ledger
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
SET balance = EXCLUDED.balance,
    lifetime_points = EXCLUDED.lifetime_points,
    version = rewards.accounts.version + 1,
    updated_at = EXCLUDED.updated_at;
