ALTER TABLE quest.event_coordination_states
  DROP CONSTRAINT IF EXISTS event_coordination_states_lifecycle_check;

ALTER TABLE quest.event_coordination_states
  ADD CONSTRAINT event_coordination_states_lifecycle_check
  CHECK (lifecycle IN (
    'forming', 'recruiting', 'awaiting_responses', 'coordinating',
    'awaiting_confirmation', 'scheduled', 'in_progress', 'completed',
    'cancelled', 'human_review'
  ));
