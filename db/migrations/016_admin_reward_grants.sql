-- Explicit positive administrative grants keep manual balance changes
-- auditable without pretending that a task or activity occurred.
ALTER TABLE rewards.point_ledger
  DROP CONSTRAINT IF EXISTS point_ledger_kind_check,
  DROP CONSTRAINT IF EXISTS point_ledger_kind_sign_source_check;

ALTER TABLE rewards.point_ledger
  ADD CONSTRAINT point_ledger_kind_check
    CHECK (kind IN ('activity_award', 'task_award', 'admin_award', 'reversal', 'redemption_debit', 'redemption_refund')),
  ADD CONSTRAINT point_ledger_kind_sign_source_check
    CHECK (
      (kind = 'activity_award' AND points > 0 AND source_type = 'legacy_activity' AND redemption_id IS NULL)
      OR (kind = 'task_award' AND points > 0 AND source_type = 'event_task' AND redemption_id IS NULL)
      OR (kind = 'admin_award' AND points > 0 AND source_type = 'admin'
          AND redemption_id IS NULL AND run_id IS NULL AND task_id IS NULL)
      OR (kind = 'reversal' AND points < 0 AND source_type IN ('event_task', 'admin') AND redemption_id IS NULL)
      OR (kind = 'redemption_debit' AND points < 0 AND source_type = 'redemption' AND redemption_id IS NOT NULL)
      OR (kind = 'redemption_refund' AND points > 0 AND source_type = 'redemption' AND redemption_id IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_admin_grant_once_idx
  ON rewards.point_ledger (user_id, source_id)
 WHERE kind = 'admin_award';
