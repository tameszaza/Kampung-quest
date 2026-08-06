# Event Task Rewards Requirements

> Status: implemented reference. The current owners are [`event-tasks.ts`](../src/server/domain/event-tasks.ts), [`EventCoordinator`](../src/server/features/event-coordinator.ts), [`event-task-board.tsx`](../src/components/event-task-board.tsx), and [`reward-service.ts`](../src/server/features/reward-service.ts). `/rewards` shows real balances and approved task history; partner redemption remains preview-only.

## 1. Purpose

After an event's participants, venue, and appointment time are finalised, Senior Quest must turn the event into a small, clear quest.

The system must:

- give each participant a clear final role;
- create a small set of useful tasks for the event;
- assign tasks according to each participant's role and contribution; and
- award points only for tasks that an event admin verifies as complete.

The AI agent creates and explains the tasks. Participants earn the points.

## 2. Finalisation trigger

Task generation starts only after:

1. the participant roster is final;
2. the venue is final;
3. the appointment time is final; and
4. every active participant confirms the same appointment version.

This is the existing transition to the `scheduled` event state.

The system must not create reward tasks for an event that is still coordinating, awaiting confirmation, cancelled, or rejected.

## 3. Final roles

When the appointment becomes final, the agent must create one final role for each active participant.

Each role must include:

- a short role name;
- one short explanation of the responsibility; and
- the participant's main task or contribution.

Role text must be short, clear, and easy to understand.

Example:

> Anne — Welcome helper: greet everyone and help new members feel comfortable.

The role must be based on the participant's proposed role, stated contribution, needs, and the event goal. The agent must not assign a role that conflicts with a known accessibility or safety requirement.

The role summary must be shown to the group. Each participant must be able to acknowledge the role or raise a concern.

Participants must not freely replace their role with an unrelated role. A reassignment request must go through the agent and preserve the event's required responsibilities.

## 4. Task generation

The agent must create **3–5 tasks total per event**, not 3–5 tasks per participant.

Tasks must be:

- necessary or meaningfully useful for the event;
- matched to a participant's final role;
- realistic for the participant's ability and available time;
- clear enough to understand without extra explanation;
- small enough to complete as one contribution; and
- non-duplicative.

The system must reject or regenerate tasks that are vague, unsafe, unreasonable, unrelated to the event, or duplicates of another task.

Every active participant should receive one meaningful task where possible. A task may involve more than one participant only when the work genuinely requires collaboration.

Each task must contain:

- a short title;
- a short instruction;
- the assigned participant;
- the related role;
- a difficulty: `easy`, `medium`, or `hard`;
- the point value; and
- the task status.

## 5. Points

Use fixed point values:

| Difficulty | Points |
| --- | ---: |
| Easy | 10 |
| Medium | 20 |
| Hard | 30 |

The agent chooses the difficulty from the task's effort and importance. It must not invent arbitrary point values.

Points must be awarded only after the assigned participant submits the task as complete and the event admin approves it.

Submitting a task must never award points by itself.

## 6. Task lifecycle

Each task must use this lifecycle:

1. `assigned` — the agent created and assigned the task;
2. `acknowledged` — the participant accepted the role and task;
3. `submitted` — the participant marked the task complete;
4. `approved` — the event admin verified the task; or
5. `needs_retry` — the admin did not accept the submission.

Points are added only when the task changes to `approved`.

The event admin must be able to approve or reject each task separately. A rejected task must include a short, clear reason and allow the participant to try again when appropriate.

## 7. Reassignment and locking

Tasks are quest objectives, not freely editable to-do items.

Before the event starts:

- a participant may request reassignment through the agent;
- the agent may offer only an equivalent task that fits the participant and event;
- the replacement must keep the same difficulty and point value unless an admin explicitly changes it; and
- the admin or configured event authority must approve the reassignment.

Once the event starts, task titles, instructions, assignments, difficulty, and points are locked. Only the event admin may make an exception.

## 8. Reward-system integration

Task approval must use the existing reward system as the single point-award path.

The reward system must:

- record the event, task, participant, admin, approval time, difficulty, and points;
- add approved task points to the participant's balance and lifetime total;
- show task earnings in the Rewards view;
- prevent the same task approval from awarding points twice; and
- preserve an audit trail for every award, rejection, and reversal.

For this task-based event workflow, the fixed completed-activity award must not be added on top of the same contribution. The reward service must choose one authoritative award path so participants are not paid twice.

## 9. Permissions

- The agent may draft roles and tasks.
- Application code must validate task count, assignment, difficulty, points, and safety.
- Participants may acknowledge, submit, or request reassignment for their own tasks.
- Only the event admin may approve, reject, or override task completion.
- The AI agent must never directly award points or mark a task approved.

## 10. Privacy and safety

- Group-visible role and task text must not expose private health, accessibility, travel, or personal information.
- A task must not require a participant to reveal private information.
- The system must not assign a task that conflicts with confirmed participant requirements.
- The admin view may show the information needed to verify a task, subject to existing privacy rules.

## 11. Acceptance criteria

### 11.1 Generate tasks after finalisation

Given all active participants confirm the same appointment version, when the event becomes `scheduled`, the system creates 3–5 useful tasks and final roles.

### 11.2 No early rewards

Given an event is not yet scheduled, the system creates no reward tasks and awards no task points.

### 11.3 Clear role summary

Given the event is scheduled, each participant sees a short role name, responsibility, and assigned task, and can acknowledge or raise a concern.

### 11.4 Role-matched assignment

Given participants have proposed roles and contributions, each task is assigned to the best-fit participant and does not conflict with known requirements.

### 11.5 Fixed point values

Given a task is created, its points are exactly 10, 20, or 30 according to its difficulty.

### 11.6 Admin verification

Given a participant submits a task, the task becomes `submitted` and no points are added until the event admin approves it.

### 11.7 Rejection and retry

Given an admin rejects a task, it becomes `needs_retry`, includes a clear reason, and does not award points.

### 11.8 Idempotent reward

Given an approved task is processed more than once, the participant receives its points only once.

### 11.9 Task locking

Given the event has started, participants cannot freely change task assignments, wording, difficulty, or points.

### 11.10 Rewards view

Given one or more tasks are approved, the approved point awards appear in the participant's balance, lifetime total, and earning history.
