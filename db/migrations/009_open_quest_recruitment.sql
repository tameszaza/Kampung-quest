ALTER TABLE quest.event_roster_members
  DROP CONSTRAINT IF EXISTS event_roster_members_source_check;
ALTER TABLE quest.event_roster_members
  ADD CONSTRAINT event_roster_members_source_check
  CHECK (source IN ('initiator', 'recommended', 'manual', 'application'));

ALTER TABLE quest.event_memberships
  DROP CONSTRAINT IF EXISTS event_memberships_roster_source_check;
ALTER TABLE quest.event_memberships
  ADD CONSTRAINT event_memberships_roster_source_check
  CHECK (roster_source IN ('initiator', 'recommended', 'manual', 'application'));

CREATE TABLE IF NOT EXISTS quest.event_join_requests (
  request_id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES quest.event_coordination_states(run_id) ON DELETE CASCADE,
  applicant_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  version integer NOT NULL CHECK (version > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS event_join_requests_pending_applicant_idx
  ON quest.event_join_requests (run_id, applicant_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS event_join_requests_applicant_status_idx
  ON quest.event_join_requests (applicant_id, status, updated_at DESC);
