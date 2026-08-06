# Event Coordinator implementation plan

> Status: historical delivery plan updated with current-state context. The implementation now includes server-backed rosters, invitations, memberships, open recruitment, private/group coordination, arrangement confirmation, lifecycle recovery, tasks, and rewards. Use [`current-web-state.md`](current-web-state.md) and the [developer file map](developer-guide.md#where-to-edit) as the editing guide; this document preserves the original decisions and phased plan.

## Current implementation snapshot

The original “replace demo authority” work has landed in the current codebase. Start edits in [`src/server/features/event-coordinator.ts`](../src/server/features/event-coordinator.ts), [`src/server/domain/event-coordination.ts`](../src/server/domain/event-coordination.ts), [`src/features/events/client.ts`](../src/features/events/client.ts), and the event route handlers under [`src/app/api/v1/event-quests`](../src/app/api/v1/event-quests). Current Activities and My Activities are server-backed; the browser does not own invitations or memberships. Use [`api-reference.md`](api-reference.md) for exact implemented endpoint names because the route names in the historical plan sections below are design-era names.

## Purpose

Replace the current demo-only invitation and activity-decision behavior with one durable, authorization-protected quest lifecycle. The result must treat times as availability until coordination is complete, support recommended and manually selected participants, deliver real invitations, provide private quest-scoped coordination conversations, finalize schedules and venues through explicit confirmation, and show each member the correct server-backed Activities and My Activities state.

This plan is based on the current implementation in the Senior Quest assistant, `KampungQuestEngine`, synthesis/retrieval/validation/safety services, quest and identity repositories, chat APIs, Activities and My Activities pages, migrations, and tests.

## Decisions agreed during grilling

1. Recommended seniors and manually selected friends share one editable roster.
2. The initiator may add friends, remove recommendations, or replace every recommended guest.
3. Every roster edit revalidates the complete group before it can be confirmed.
4. Invitations are created only after the initiator confirms the roster.
5. Natural-language recurring availability is preserved as a timezone-aware recurring rule and expanded deterministically into concrete windows for matching and coordination.
6. The UI must show how natural-language availability was interpreted and require confirmation.
7. The expansion horizon is deliberately deferred; it must be configurable and must not be hard-coded as an implicit product decision.
8. The coordination agent proposes a final arrangement but cannot finalize it.
9. The initiator approves the proposed arrangement first; every accepted participant then confirms it.
10. Material changes invalidate applicable confirmations. Date/time, venue, accessibility or safety conditions, roster, role, activity type, and core-purpose changes are material. Duration changes are material unless they are 15 minutes or less and remain inside every affected participant's confirmed availability. Copy edits, reminders, and public directions are non-material.
11. The initiator becomes the organizer/member when the roster is confirmed and does not receive an invitation.
12. Invitation acceptance means willingness to participate and enter coordination, not confirmation of a final schedule.
13. My Activities uses: Awaiting coordination, Awaiting confirmation, Upcoming, Completed, and Cancelled.
14. Pending invitations remain in Activities -> Invited. Membership and page placement are evaluated independently for each user.

## Current-state findings that shape the implementation

- Availability is represented as one or more concrete timestamp windows. Recurring rules and a recurrence expansion horizon are not part of the current schema.
- Proposals retain provisional availability separately from finalized arrangements; UI labels use “availability being coordinated” until an arrangement is finalized.
- Formation creates a durable event coordination state. Roster confirmation creates the organizer membership and guest invitations through the event coordinator; the initiator is not invited to themself.
- Invitation, membership, recruitment, join-request, coordination-thread, arrangement, notification, audit, outbox, task-plan, and reward data are persisted in the event state and mirrored by the PostgreSQL event tables.
- Quest list/detail/activity APIs return role-safe views to organizers, selected participants, invitees, accepted members, and eligible recruiting applicants.
- Activities and My Activities are server-backed. The client owns tab selection and transient loading/error state, not invitation or membership decisions.
- Private and group quest coordination threads are event-owned and are merged into the Messages view as quest conversation summaries.
- The coordination agent emits structured intents. `EventCoordinator` applies deterministic requirement, appointment, lifecycle, role, and task mutations with optimistic revisions.
- PostgreSQL state, audit, outbox, and reward writes are transactional within the event repository; the in-memory repository mirrors the same contract for tests and no-database development.
- Existing tests cover core synthesis, validation, safety, recruitment, access, coordination, chat, rewards, and PostgreSQL persistence. Browser/e2e coverage should still expand with new UI behavior.

## Architectural direction

### One authoritative quest aggregate

Keep `KampungQuestEngine` and the modular agent sequence. Extend the quest store into the sole authority for quest lifecycle, roster, invitations, membership, participant availability, arrangements, confirmations, notifications, private coordination threads, and coordination events.

Do not make chat, React state, or `localStorage` authoritative for quest state. The Messages UI may render quest coordination threads beside ordinary chats, but a quest thread's data and permissions come from the quest aggregate/store.

Retain `quest_runs` as the durable root produced by the synthesis pipeline. Normalize lifecycle entities that must be queried or updated independently into relational tables keyed to `run_id`. Keep the root payload as a validated snapshot or rebuild it from normalized records, but define exactly one write path through the quest repository so the JSON payload and normalized rows cannot diverge.

Recommended implementation: make normalized rows authoritative after formation and update the `QuestRun` response DTO from those rows. The original synthesis proposal remains an immutable/auditable proposal version rather than a second mutable source of truth.

### Application-owned mutations

Agents may return structured proposals only:

- assistant: proposed interpretation of natural-language availability;
- synthesis: proposed quest, recommended roster, roles, and reserves;
- coordination: proposed requirement summary and arrangement options;
- recovery: proposed replacement or recovery action;
- safety: review result.

Application services remain responsible for authorization, schema validation, deterministic constraint checks, safety gates, idempotency, transactions, persistence, participant changes, invitation delivery, notifications, and state transitions.

### Transaction boundary

Add an application-level quest transaction contract used by both PostgreSQL and in-memory implementations. A command such as roster confirmation or invitation acceptance must atomically persist all related quest state, invitations/memberships, coordination events, coordination-thread system cards, and notification/outbox records.

Do not coordinate correctness through best-effort calls between `KampungStore` and `IdentityStore`. Identity lookup/privacy checks may happen before the transaction, but the validated identity facts needed by the command must be rechecked or locked at commit where PostgreSQL allows it. The in-memory implementation must apply the command to cloned state and commit only after every validation succeeds.

Use a transactional outbox for external delivery. Committing an invitation creates the authoritative invitation, in-app notification, quest-thread card, coordination event, and outbox job once. Delivery workers/adapters retry outbox jobs without duplicating user-visible records.

## Domain model

### Availability

Extend the existing availability model rather than adding an unrelated scheduling model.

Define an availability entry as a discriminated union:

- `explicit_window`: `start`, `end`, and `timeZone`;
- `weekly_recurrence`: weekdays, local start/end times, `timeZone`, and optional validity bounds.

Existing `{start, end}` data must migrate or normalize as `explicit_window` without changing its meaning. A deterministic `AvailabilityExpansionService` expands confirmed recurrence entries into concrete `AvailabilityWindow[]` for a supplied coordination horizon. The horizon is an explicit input/configuration value and remains a deferred product decision.

Rules:

- Availability is never the confirmed event schedule.
- Store the confirmed rule/entry as authoritative and generated windows as derived data tied to rule version and horizon.
- Record timezone explicitly; never infer it from server timezone.
- Merge overlapping/adjacent generated windows and reject invalid or zero-length windows.
- Preserve multiple windows and multiple recurrence entries.
- Natural-language parsing produces a proposed structured interpretation only. The user must confirm or edit it before persistence as authoritative availability.
- Changes to participant availability create a coordination event and trigger deterministic overlap recalculation.

### Quest lifecycle

Use the smallest coherent extension of current statuses:

```text
processing
  -> no_match | human_review | forming | failed

forming
  -> awaiting_responses | cancelled

awaiting_responses
  -> coordinating | forming | human_review | cancelled

coordinating
  -> awaiting_confirmation | forming | human_review | cancelled

awaiting_confirmation
  -> scheduled | coordinating | forming | human_review | cancelled

scheduled
  -> coordinating | in_progress | cancelled

in_progress
  -> completed | cancelled
```

Terminal states are `no_match`, `completed`, `cancelled`, and `failed`. `human_review` is a gated state with explicit reviewed transitions rather than a silent terminal state.

Migration mapping:

- current `awaiting_acceptance` -> `awaiting_responses`;
- current `confirmed` -> `scheduled` only when a valid finalized arrangement exists; otherwise -> `coordinating`;
- preserve `processing`, `no_match`, `human_review`, `completed`, `cancelled`, and `failed`.

`forming` means synthesis and safety have produced a recommendation, but the initiator is still editing the roster. No invitations exist yet.

### Roster selection

Before confirmation, roster entries have:

- user/candidate ID;
- source: `initiator`, `recommended`, or `manual`;
- proposed role;
- recommendation explanation categories safe for display;
- validation status and public reason when invalid;
- proposal version.

The initiator is immutable in the roster. Non-initiator entries are editable. Duplicate IDs are rejected at schema and database levels. Every mutation runs the complete deterministic validator and, when needed, safety review. A failed edit remains a draft with actionable errors and cannot be confirmed.

Recommendation explanations must be derived from safe categories such as shared interests, complementary skills, compatible availability, acceptable distance band, or previous positive interaction. Never return exact distance/address, memory text not already permitted for display, sensitive constraints, or internal scores.

Manual candidates must pass the same eligibility, block/privacy, consent, distance, language, group-size, availability, current-commitment, validation, and safety checks as recommended candidates. Manual selection never directly inserts an invitation or membership.

### Invitation lifecycle

Roster `selected` is a pre-invitation state, not an invitation status. Once the roster is confirmed, create one invitation per guest with:

```text
pending -> accepted
pending -> declined
pending -> expired
pending -> withdrawn
pending -> replaced
pending -> cancelled
accepted -> withdrawn | replaced | cancelled
```

Keep the requested durable statuses: `pending`, `accepted`, `declined`, `expired`, `withdrawn`, `replaced`, and `cancelled`.

Invitation records include inviter, guest, quest, roster/proposal version, current arrangement version if any, delivery state, timestamps, and idempotency key. Status transitions are append-audited and compare-and-set against the current version/status. Repeating the same command returns the existing result; conflicting transitions return a conflict.

The initiator receives an organizer membership directly and never receives an invitation.

### Membership lifecycle

Separate invitation history from current membership:

```text
organizer: coordinating -> awaiting_confirmation -> confirmed -> completed
guest:     coordinating -> awaiting_confirmation -> confirmed -> completed

any active membership -> withdrawn | replaced | cancelled
```

Guest membership is created atomically when an invitation is accepted. Acceptance does not create final schedule confirmation. Membership contains role, source, joined/left timestamps, current confirmation status/version, and visibility-safe participant metadata.

Page placement is computed per membership/user:

- pending invitation: Activities -> Invited;
- active membership while collecting requirements: My Activities -> Awaiting coordination;
- arrangement awaiting that user's or others' confirmation: Awaiting confirmation;
- finalized arrangement: Upcoming;
- completed membership/quest: Completed;
- cancelled quest/membership: Cancelled.

For the initiating user, confirming the validated roster is the authoritative “accept recommended quest” command. It atomically persists organizer membership, moves that quest out of their actionable Suggested list, places it in My Activities -> Awaiting coordination, and delivers guest invitations. Merely opening or editing a recommendation does not count as acceptance.

### Coordination requirements and privacy

Create one private coordination thread per quest and participant, including the organizer. The participant and authorized coordinator/system roles can access it. Other participants cannot read it.

Store structured requirement revisions separately from chat text:

- confirmed availability entries;
- accessibility requirements;
- travel/distance constraints;
- dietary/environmental requirements;
- venue preferences;
- temporary conflicts;
- other participant-confirmed constraints.

Agent extraction creates proposed requirement changes. Application validation and explicit participant confirmation make them authoritative. Arrangement calculation consumes structured confirmed requirements, not raw conversation text.

Quest-wide views expose only aggregate compatibility and permitted summaries. They must not expose another participant's private thread, raw constraints, exact address, private memory, or internal scores.

### Arrangement and confirmation versions

Persist immutable arrangement versions containing:

- start/end and duration;
- venue ID/name plus public directions and accessibility attributes;
- participant/role roster version;
- requirement versions used;
- proposal reason and compatibility summary;
- state: `proposed`, `initiator_approved`, `awaiting_participant_confirmation`, `finalized`, `superseded`, or `rejected`;
- deterministic material-change classification and diff from the prior version.

Workflow:

1. Coordination agent proposes options from de-identified structured requirements.
2. Application code validates availability overlap, duration, travel, venue opening/availability, accessibility, capacity, safety, and roster viability.
3. Persist the valid proposal and notify the initiator.
4. Initiator approves or rejects.
5. On approval, create confirmation requests for every accepted participant.
6. Finalize only when all required confirmations for that exact arrangement version are present.
7. Transition quest to `scheduled`, record an event, and notify all members.

Material changes supersede the prior arrangement and invalidate required confirmations. Apply the agreed material-change policy deterministically. Non-material changes append a new informational version/event without invalidating confirmations.

## Persistence changes

Add a migration under the existing `quest` schema for tables equivalent to:

- `quest.roster_versions` and `quest.roster_members`;
- `quest.invitations`;
- `quest.memberships`;
- `quest.participant_availability` and derived occurrence/version metadata;
- `quest.coordination_threads` and `quest.coordination_messages`;
- `quest.participant_requirements`;
- `quest.arrangements` and `quest.arrangement_confirmations`;
- `quest.notifications`;
- `quest.outbox`.

Extend `quest.coordination_events` with actor ID, aggregate revision, idempotency key, event schema version, and richer event types. Keep events immutable.

Required constraints/indexes include:

- unique quest/user roster membership per roster version;
- unique active invitation per quest/guest/roster version;
- unique active membership per quest/user;
- unique coordination thread per quest/user;
- unique confirmation per arrangement version/user;
- unique idempotency key in each command scope;
- indexes for pending invitations by guest, memberships by user/status, unread notifications, arrangement confirmations, and outbox delivery;
- foreign keys to quest run and identity user where deployment ordering permits;
- check constraints for all lifecycle statuses.

Migration code must validate old JSON payloads, map compatible statuses, and leave ambiguous old demo runs visibly marked as legacy/demo instead of pretending they sent real invitations.

Extend `KampungStore` and `PostgresKampungStore` together. Add equivalent behavior to `InMemoryKampungStore`; no method may silently degrade to mock delivery or client state when PostgreSQL is absent.

## Service changes

### Availability service

Add deterministic parsing-validation boundaries and recurrence expansion. The AI conversation can suggest a parse, but server code validates supported recurrence forms and the user confirms them. Update overlap calculation to consume generated concrete windows and retain the rule references that justified a match.

### Formation service

Split “approved synthesis result” from “confirmed roster”:

- pipeline ends in `forming` with recommendations and safe explanations;
- roster commands add/remove participants and run full validation;
- confirmation revalidates against current identity/privacy/block/consent/memory state inside the command;
- only roster confirmation creates organizer membership, guest invitations, notifications, private coordination threads/cards, events, and outbox jobs.

The synthesis agent must not send invitations. Replace `MockInvitationAdapter` as a correctness dependency with transactional invitation creation plus an outbox delivery adapter.

### Invitation service

Implement list, detail, accept, decline, withdraw, expire, replace, and cancel commands. Each command enforces actor authorization, expected status/version, and idempotency.

Acceptance atomically:

- marks only that guest's invitation accepted;
- creates/activates that guest's membership;
- updates quest viability/state when applicable;
- removes the invitation from that guest's actionable Activities query;
- places the membership in My Activities -> Awaiting coordination;
- appends a coordination event;
- creates notifications/cards without duplication.

Decline/timeout/replacement must preserve history. A reserve is proposed by the recovery agent, then deterministically revalidated and safety-reviewed. The organizer confirms a roster-changing replacement before a new invitation is delivered unless a future product rule explicitly authorizes automatic reserve invitation.

### Coordination conversation service

Follow the durable assistant-conversation pattern: conversation snapshot, revision, ordered messages, client turn IDs, optimistic concurrency, structured agent output, and persisted workflow events. Scope every read/write to quest plus participant.

The coordination agent may propose requirement updates, arrangement options, or recovery actions. It cannot mutate quest state directly. Use participant aliases and provider minimization, and audit agent runs with quest/thread IDs.

### Arrangement service

Build deterministic availability intersection and venue validation before model ranking. Opening hours/external venue availability belong behind an adapter with explicit failure states; never claim confirmation when the adapter is unavailable.

Implement initiator approval, participant confirmation, supersession, material-change diffing, and finalization as versioned commands. Every transition emits notifications and a coordination event in the same transaction.

### Activity query service

Provide user-centric queries rather than filtering initiator-owned runs in the client:

- suggested/forming quests owned by the initiator;
- received pending invitations;
- sent invitations for the organizer;
- My Activities grouped by the current user's membership and quest/confirmation state.

The server returns display DTOs that contain only fields authorized for that viewer.

## API plan

Keep versioned App Router routes and authenticated member binding. Exact route naming may follow repository conventions, but the capabilities should be:

- read a quest as organizer, invited guest, or member with role-sensitive fields;
- retrieve safe recommended participants and explanations;
- search eligible manual contacts through existing identity discovery/privacy rules;
- add/remove roster members and retrieve current validation;
- confirm the roster with an idempotency key and expected revision;
- list received/sent invitations;
- accept/decline an invitation with an idempotency key and expected version;
- withdraw/cancel/replace invitations with organizer authorization;
- list user-centric Activities and grouped My Activities;
- create/read/update the current user's private quest coordination thread;
- submit and confirm participant requirements;
- retrieve arrangement proposals and diffs;
- approve/reject as initiator;
- confirm/reject as the current participant;
- cancel, start, and complete quests under explicit role/state rules;
- mark notifications read.

Do not accept a candidate/user ID from the request body as proof of identity. Bind actor identity from `requireUser()`. Verify quest role and ownership inside the application service as well as the route.

Use HTTP semantics consistently:

- `404` when a resource is absent or intentionally hidden;
- `403` for an authenticated actor who lacks a permitted role when disclosure is safe;
- `409` for stale revisions or invalid state transitions;
- `422` for deterministic validation failures;
- replay the prior success for a repeated idempotent command.

## Messaging and notification integration

Surface private quest coordination threads in the existing Messages experience by extending its conversation DTO with a `quest_coordination` type and typed message/card payloads. Reuse the existing thread list, unread badge, polling/refresh behavior, message bubbles, and composer where suitable.

Invitation delivery creates a typed invitation card containing only permitted data:

- quest title and description;
- inviter identity;
- visible participant summary;
- provisional availability labeled as availability;
- venue status;
- Accept and Decline actions;
- link into the private coordination thread.

Quest coordination messages must be distinguishable from ordinary direct/group chat and cannot be deleted/left in a way that erases the underlying invitation or membership. Read state is per user. Notification preferences control delivery channels, not persistence of authoritative invitations.

Use the outbox for push/email adapters if added later. In-app records are committed transactionally; external failures remain visible/retryable and never roll back an already-authoritative user decision.

## Frontend plan

### Talk to Senior Quest

- Rename time prompts and review labels to “When are you available?” and “Available times.”
- Support multiple explicit windows and recurring entries.
- Allow natural-language entry, show the structured interpretation, timezone, and generated examples, and require confirmation.
- Keep editing additive; do not replace all availability when adding another window.
- Label synthesis output “Provisional availability” or “Schedule to be coordinated.”
- Never render `proposedTimeWindow` as a confirmed date/time before finalization.

### Roster editor after synthesis

- End synthesis on an editable roster screen rather than sending invitations.
- Show safe recommendation explanations and source badges.
- Search known users using the server contact/eligibility endpoint.
- Prevent duplicate selection immediately and show server validation errors accessibly.
- Enforce participant limits in UI and server.
- Allow add, remove, and full replacement of recommended guests.
- Disable roster confirmation until the complete current roster passes validation and safety gates.

### Activities

- Suggested tab uses server formation/recommendation state.
- The initiator's recommendation acceptance is the roster-confirmation action; it persists organizer membership and invitation delivery together.
- Invited tab uses current user's persistent pending invitations.
- Received and Sent views come from server data.
- Accept/Decline actions show pending/error/success states and refresh affected queries.
- On acceptance, remove only that user's invitation from the actionable list and add only that user's membership to My Activities.
- Never fall back to mock invitations or `localStorage` after API failure.

### My Activities

Replace mock data with membership-backed groups:

- Awaiting coordination;
- Awaiting confirmation;
- Upcoming;
- Completed;
- Cancelled.

Show action-needed indicators, arrangement version/diff, participant-visible venue status, and per-user confirmation state. Revalidate/refetch after commands so changes appear without logout or storage reset.

### Quest detail

Render role-sensitive actions and data:

- organizer roster management before invitations;
- guest invitation response;
- private coordination link;
- initiator arrangement approval;
- participant arrangement confirmation;
- visible coordination history and material-change diff;
- cancellation/withdrawal actions permitted by state.

Clearly distinguish availability, proposed arrangement, and finalized schedule.

### Remove obsolete client authority

Remove invite/activity decisions from `AppStateProvider` and the `senior-quest-ui-state` payload once server slices replace them. Saved/bookmarked quest state may remain client-side only if explicitly considered non-authoritative. Remove mock invitation and My Activities imports from production routes. Demo content must remain explicitly labeled and must not activate when a backend request fails.

## Authorization and privacy matrix

- Organizer: edit/confirm roster, view sent invitations, approve arrangements, cancel quest, view only aggregate participant requirement compatibility.
- Invited guest: view permitted quest summary and own invitation, respond to own invitation, use own private coordination thread.
- Accepted member: view permitted quest/member summary, use own private coordination thread, confirm own arrangement, withdraw under lifecycle rules.
- Other authenticated user: no quest/invitation/thread access.
- Agent provider: de-identified aliases and minimum structured facts only.

Blocking, profile visibility, message privacy, invitation consent, eligibility, and current commitment must be checked when searching/recommending and rechecked when roster confirmation or replacement commits. A later block or consent change must create a recovery/human-review event rather than silently exposing or retaining access.

## Idempotency, concurrency, and audit rules

- Require idempotency keys for roster confirmation, invitation responses, replacement delivery, arrangement approval/confirmation, cancellation, and material updates.
- Enforce unique keys at the database layer and retain response identity for replay.
- Add aggregate revisions and optimistic compare-and-set to every mutable quest command.
- Lock or compare invitation and arrangement rows during transitions.
- Never perform external delivery before the state transaction commits.
- Deduplicate notifications/cards by event and recipient.
- Record actor, event type, previous/new state, quest revision, arrangement/roster version, safe diff, idempotency key, and timestamp.
- Preserve prior roster, invitation, requirement, arrangement, and confirmation versions.

## Recovery behavior

Implement explicit handlers for:

- no common availability: remain coordinating, request more availability, propose scope/duration adjustment, or return to formation;
- decline/expiry: reassess minimum viable group, propose a validated reserve, or return to formation/human review;
- unavailability after acceptance: withdraw/supersede confirmation, recalculate, and notify affected users;
- venue unavailable: supersede arrangement and propose a validated alternative;
- below minimum group size: stop finalization and return to formation or cancel after organizer decision;
- replacement: preserve original invitation/membership history and create a new invitation only after validation and required organizer confirmation;
- initiator cancellation: cancel quest, invitations, memberships, active arrangement, and outbox future reminders in one transaction; notify all affected users once;
- provider/adapter failure: persist an explicit retryable or human-review state without mock success.

## Testing plan

### Domain and service tests

- multiple explicit availability windows;
- recurring availability parsing proposals, confirmation, timezone handling, and deterministic expansion;
- generated-window merging and overlap calculation;
- availability never treated as a finalized schedule;
- recommendation explanations exclude private facts and scores;
- manual plus recommended roster editing, full replacement, duplicates, limits, blocked/ineligible/unauthorized users;
- complete-group revalidation and safety review after every roster change;
- initiator membership without self-invitation;
- transactional/idempotent invitation creation and delivery records;
- invitation accept, decline, expire, withdraw, replace, and cancel transitions;
- per-user invitation authorization and replay/conflict behavior;
- acceptance creates only the accepting user's membership;
- pending invitation remains only for other pending guests;
- private coordination thread isolation between participants;
- structured requirement confirmation and privacy-safe aggregate output;
- arrangement overlap, venue, duration, accessibility, travel, opening-hours, and safety validation;
- initiator-first and all-participant confirmation sequence;
- material-change classification, confirmation invalidation, diff, and deduplicated notifications;
- minor duration exception;
- decline, timeout, late unavailability, reserve replacement, venue failure, below-minimum group, and cancellation recovery;
- Activities/My Activities grouping for each participant independently;
- persistence across reload/restart;
- outbox retries without duplicate invitations, cards, messages, or notifications.

### API contract and authorization tests

- actor identity always comes from session;
- organizer, invited guest, member, and outsider access matrix;
- stale revision `409`, validation `422`, forbidden/hidden resource behavior;
- request schemas reject unsupported states/actions and duplicate roster IDs;
- idempotency keys replay prior results;
- quest detail redacts private participant requirements by viewer role.

### Repository parity tests

Create a shared repository contract suite and run it against in-memory and PostgreSQL implementations. Cover every transaction and lifecycle transition, not only CRUD. PostgreSQL integration tests must recreate the engine/store and verify state, events, unread state, and idempotency survive restart.

### Frontend/component tests

- availability labels and provisional schedule wording;
- multiple/recurring availability editing and interpretation confirmation;
- roster source badges, explanations, duplicate prevention, and validation errors;
- invitation card actions and loading/error states;
- accepted invitation moves from Activities to Awaiting coordination without logout;
- independent participant views;
- My Activities five-group mapping;
- arrangement diffs and reconfirmation prompts;
- private coordination thread routing and unread indicators;
- no fallback to mock data after backend failure.

### Baseline environment

Run checks under Node 22 or newer as required by `package.json`. The current shell uses Node 18.19.1, which prevents Vitest from starting because `node:util.styleText` is unavailable. Type-check currently passes; lint currently passes with nine pre-existing warnings in the unused root prototype `page.tsx`.

## Ordered delivery plan

### Phase 0: baseline and characterization

1. Run the current suite under Node 22+ and capture the baseline.
2. Add characterization tests around current assistant, proposal, authorization, and coordination behavior.
3. Decide whether the legacy synchronous `QuestPipeline` remains supported or is retired in favor of `KampungQuestEngine`; do not evolve two production pipelines independently.

### Phase 1: lifecycle vocabulary and repository transaction foundation

1. Add schemas for quest, roster, invitation, membership, arrangement, confirmation, notification, and event states.
2. Implement transition functions as pure domain code with exhaustive tests.
3. Add aggregate revisions, idempotency contracts, and an atomic quest command transaction to both stores.
4. Add migrations and shared in-memory/PostgreSQL repository contract tests.

### Phase 2: availability as availability

1. Extend availability entries with explicit and recurring forms.
2. Add deterministic recurrence expansion and overlap services with a configurable horizon.
3. Update assistant schemas/service/UI for multiple entries and confirmed natural-language interpretation.
4. Change proposal/detail wording and DTOs so no pre-finalized time appears scheduled.
5. Update synthesis/validation to use derived windows while preserving source rule references.

### Phase 3: editable roster formation

1. End approved synthesis at `forming` without delivery.
2. Produce safe recommendation explanations.
3. Add eligible manual-contact search and roster mutation APIs.
4. Revalidate and safety-review the complete roster after each edit.
5. Build the mixed-source roster editor and confirmation gate.

### Phase 4: persistent invitations, membership, and Activities

1. Confirm roster transactionally into organizer membership, guest invitations, events, private threads/cards, notifications, and outbox jobs.
2. Implement invitation queries and state-transition commands.
3. Implement membership creation on acceptance and independent per-user views.
4. Map “accept recommended quest” to validated roster confirmation and the resulting organizer membership.
5. Replace Activities invites, activity actions, and My Activities mock/client state with server queries.
6. Add unread indicators and sent-invitation status.

### Phase 5: private coordination conversations

1. Add quest/participant-scoped durable threads and ordered messages.
2. Add the coordination agent's structured requirement proposal output.
3. Add explicit requirement confirmation and private persistence.
4. Integrate coordination threads/cards into Messages without exposing cross-participant data.

### Phase 6: arrangement coordination and confirmation

1. Add deterministic availability, venue, travel, accessibility, duration, capacity, opening-hours, and safety checks.
2. Add versioned arrangement proposals and safe diffs.
3. Implement initiator approval and participant confirmation.
4. Finalize only after all confirmations for the current version.
5. Implement material-change invalidation and the minor-duration exception.
6. Populate Awaiting confirmation and Upcoming views from arrangement state.

### Phase 7: recovery, replacement, and cancellation

1. Expand recovery-agent proposals but keep mutations application-owned.
2. Implement no-overlap, decline/expiry, late unavailability, venue failure, below-minimum, reserve replacement, and cancellation flows.
3. Add reconfirmation, notifications, audit history, and outbox deduplication for every recovery path.

### Phase 8: hardening and removal of demo authority

1. Run the shared repository suite against in-memory and PostgreSQL.
2. Add route/component/end-to-end coverage for all required scenarios.
3. Verify restart/reload behavior and concurrent/idempotent commands.
4. Remove obsolete invite/activity `localStorage` decisions and production mock fallbacks.
5. Audit authorization, provider privacy, logs, events, and UI redaction.
6. Run type-check, lint, tests, production build, migrations, and responsive/accessibility review.

## Definition of done

- Availability and finalized schedule are visibly and structurally distinct.
- A mixed recommended/manual roster can be edited and fully revalidated before delivery.
- Every guest receives exactly one durable, actionable invitation after roster confirmation.
- Invitation and membership state survive restart and are independent per participant.
- Invited/accepted participants can use private quest-scoped coordination conversations without seeing others' private requirements.
- A quest becomes scheduled only after a valid arrangement, initiator approval, and every accepted participant's confirmation.
- Material changes create an audit diff, notify affected users once, and invalidate required confirmations.
- Activities and My Activities are server-backed and reflect the five agreed groups without logout or local reset.
- Declines, expiries, replacements, venue failures, no-overlap cases, below-minimum groups, and cancellations have explicit tested recovery paths.
- All mutations are authorization-protected, transactional, optimistic-concurrency-safe, retry-safe, and covered in both in-memory and PostgreSQL repository implementations.
- No backend failure silently activates mock or client-only behavior.

## Deferred product decision

The default and maximum coordination horizon used to expand recurring availability remain undecided. Implementation must expose this as an explicit configuration/product policy and must not encode an invisible permanent default before that decision is made.
