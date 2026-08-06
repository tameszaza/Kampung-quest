# Agentic Event Coordination Implementation Plan

> Status: historical delivery plan. Most of the durable private/group coordination, structured intents, arrangement versions, confirmation flow, lifecycle commands, and task/reward hooks described here now exist. Use [`current-web-state.md`](current-web-state.md), [`developer-guide.md`](developer-guide.md), and [`api-reference.md`](api-reference.md) before changing code. The plan below is retained for design rationale and remaining extensions.

## Current implementation snapshot

- The implemented private and group message routes are `GET/POST /api/v1/event-quests/[questId]/coordination` and `GET/POST /api/v1/event-quests/[questId]/coordination/group`.
- [`EventCoordinator`](../src/server/features/event-coordinator.ts) owns authorization, structured intent handling, requirements, arrangements, confirmations, lifecycle, audit, notifications, task plans, and reward entries.
- [`event-coordination.ts`](../src/server/domain/event-coordination.ts) already contains the discriminated `CoordinationIntent` contract proposed below.
- [`event-coordination-conversation.tsx`](../src/components/event-coordination-conversation.tsx) and [`chat-center.tsx`](../src/components/chat-center.tsx) expose the event threads in the web UI.
- Remaining work is integration/product scope: recurring availability, external venue/delivery adapters, partner redemption, and broader browser coverage. The [API reference](api-reference.md) is the implemented route list.

## Objective

Implement the behavior defined in [Agentic Event Coordination Requirements](./agentic-event-coordination-requirements.md): private and group coordination chats must share one activity state and one action engine; authorized natural-language requests must make real appointment changes; incompatible requests must produce privacy-safe compromises; and the appointment becomes final only after every active participant confirms the same version.

## Recommended architecture

### One quest-owned coordination aggregate

Keep `EventCoordinator` as the application boundary for activity state, authorization, deterministic validation, appointment versioning, confirmations, audit events, notifications, and coordination messages.

Quest coordination must not use the generic identity chat store as its source of truth. The existing `chat.conversations` quest group is created best-effort by `QuestChatNotifier`, cannot commit atomically with quest changes, permits members to leave or delete it independently of activity membership, and does not invoke the coordination agent. Replace that event-specific path with a quest-owned group coordination thread. Continue using the generic identity chat subsystem for ordinary direct and user-created group conversations.

The Messages screen can still show quest group chats by merging ordinary conversation summaries with quest coordination summaries at its server/query boundary.

### Agent interprets; application decides and mutates

Replace the current coordination agent result:

```ts
{ reply, requirementPatch }
```

with a discriminated structured interpretation:

```ts
type CoordinationIntent =
  | { type: "social" }
  | { type: "question"; topic: "status" | "confirmations" | "compatibility" | "other" }
  | { type: "update_requirement"; patch: Partial<CoordinationRequirements>; ambiguity: string[] }
  | { type: "change_appointment"; patch: AppointmentPatch; referencesSuggestionId?: string }
  | { type: "confirm_appointment"; appointmentVersion: number | null }
  | { type: "reject_appointment"; appointmentVersion: number | null; reason?: string }
  | { type: "organizer_action"; action: "change_roster" | "cancel" | "start" | "complete"; details: unknown }
  | { type: "unsupported"; reason: string };
```

The model may classify a message, resolve conversational references, and extract candidate values. Application code must bind the actor and quest from the authenticated request, resolve dates in the quest timezone, enforce permissions, validate compatibility, calculate alternatives, commit state, and generate the final response/card payload.

Do not let model prose determine whether a mutation succeeded. The response shown to the user must be derived from the committed command result.

### Two-stage message processing

Use this turn sequence:

1. Authorize thread membership and persist the participant message with a client message ID.
2. Read the current quest/appointment snapshot and call the agent outside the database transaction.
3. Validate the structured intent against its schema.
4. Execute the intent through a deterministic command using the snapshot revision.
5. Inside one quest transaction, commit the appointment/requirement/confirmation changes, audit event, notifications, group card, and private response.
6. Return the committed turn result.

If step 4 encounters a newer quest revision, re-read and deterministically re-evaluate the extracted intent once. If its meaning depends on stale conversational context, persist a clarification response instead of overwriting newer state.

The persisted user message remains valid if the provider fails. Append a retryable assistant error without changing activity state.

## Domain model changes

### Coordination threads

Generalize `EventCoordinationThread`:

- `scope: "private" | "group"`;
- `ownerUserId: string | null` — required for private, null for group;
- one private thread per quest/member;
- exactly one group thread per quest;
- group access derived from active membership, never from a separately editable chat member list;
- independent per-user read state for the group thread.

Private requirement state should remain associated with the participant rather than the group thread.

### Coordination messages

Extend `EventCoordinationMessage` with:

- `senderId: string | null`;
- `senderRole: "participant" | "assistant" | "system"`;
- `scope` or thread relation;
- `kind: "text" | "appointment_change" | "appointment_conflict" | "appointment_confirmation" | "appointment_finalized" | "status" | existing card kinds`;
- typed `payload` for cards and public diffs;
- `clientMessageId`/idempotency key;
- `replyToMessageId` when an agent result belongs to a participant message;
- ordered creation metadata.

Keep private requirement details out of group message payloads. Group conflict cards contain only aggregate categories and compatible public alternatives.

### Working appointment

Evolve `EventArrangement` so there is one explicit current version:

- statuses: `working`, `finalized`, `superseded`, and `rejected`;
- `requestedBy`, `sourceThreadId`, and `sourceMessageId`;
- immutable version number;
- timezone;
- requirement and roster revisions used for validation;
- typed public diff;
- deterministic validation summary;
- confirmation records created immediately for all active members.

Remove the separate organizer-approval step for date, time, duration, and venue changes. A compatible authorized request becomes the current `working` version immediately. Keep organizer-only commands for roster, cancellation, lifecycle, activity type, and core purpose.

When a working version is created:

- supersede the previous current version;
- set every active membership to `awaiting_confirmation`;
- create pending confirmations for every active participant, including the organizer;
- optionally mark the requesting participant confirmed only when their message explicitly combines the change with confirmation; the safer default is pending for everyone;
- set lifecycle to `awaiting_confirmation`;
- finalize and transition to `scheduled` only when all confirmation rows for that version are confirmed.

### Requirement revisions

Replace `pendingRequirements` as the only chat-to-state path with versioned requirement commands:

- unambiguous, low-risk requirements can commit immediately and return a correction affordance;
- ambiguous or safety-sensitive extractions create a clarification/pending proposal;
- every committed requirement revision triggers compatibility evaluation of the current appointment;
- if the current appointment becomes incompatible, retain the new requirement, mark the appointment as needing adjustment, and generate alternatives without leaking the cause.

### Compromise suggestions

Persist suggestions so “Okay, use that” has a stable referent:

```ts
interface AppointmentSuggestion {
  suggestionId: string;
  runId: string;
  basedOnRevision: number;
  requestedPatch: AppointmentPatch;
  alternative: CompleteAppointment;
  publicReasonCategories: string[];
  status: "offered" | "accepted" | "expired";
  expiresAt: string;
}
```

Accepting a suggestion must revalidate it against current requirements and roster state before mutation.

## Deterministic services

Extract the following pure or application-owned services instead of expanding one monolithic `EventCoordinator` method:

### `CoordinationPolicy`

- determines whether the agent should respond in group chat;
- authorizes intents by actor role;
- permits all accepted participants to change time, venue, and duration;
- restricts roster, cancellation, start, completion, activity type, and core-purpose changes to the organizer;
- returns stable public denial codes/messages.

### `AppointmentPatchResolver`

- combines a partial natural-language change with the current appointment;
- resolves relative dates/times using quest timezone and message timestamp;
- rejects unresolved ambiguity;
- validates start/end/duration invariants;
- resolves references to persisted suggestions.

### `AppointmentCompatibilityService`

- checks every active member's confirmed availability;
- checks accessibility, travel, environmental, venue, opening-hours, capacity, duration, and safety constraints;
- returns internal participant-specific failures for server use;
- produces a separate privacy-safe public summary;
- never sends raw private requirements to the group or provider.

### `CompromiseFinder`

- deterministically generates candidate times around the requested time from confirmed availability intersections;
- filters candidates through the full compatibility service;
- optionally uses the model only to rank already-valid candidates;
- scores closeness to the request before secondary group-fit criteria;
- returns no result explicitly when no candidate is valid.

### `AppointmentCommandService`

- atomically activates compatible working appointment versions;
- supersedes prior versions;
- invalidates and recreates confirmation records;
- finalizes after all active participants confirm;
- emits typed cards, notifications, audit events, and outbox jobs;
- implements idempotency and optimistic concurrency.

### `CoordinationTurnService`

- owns the two-stage message flow;
- invokes the interpreter;
- dispatches structured intents to deterministic services;
- formats committed results for private or group context;
- applies the group-chat intervention policy;
- provides the single entry point used by both chat surfaces.

## Persistence plan

Add migration `012_agentic_event_coordination.sql` rather than rewriting migration 008.

### Schema changes

1. Add `scope` and nullable `owner_user_id` to coordination threads; migrate existing `user_id` values to private owners.
2. Replace the old unique `(run_id, user_id)` rule with partial uniqueness for private owners and one group thread per run.
3. Add a group-thread read-state table keyed by `(thread_id, user_id)`.
4. Add `sender_id`, structured `payload`, `client_message_id`, and `reply_to_message_id` to coordination messages.
5. Add appointment provenance, timezone, requirement revision map, and validation summary to arrangement payload/schema.
6. Extend the arrangement status constraint with `working`; retain legacy statuses while old rows are migrated or read-normalized.
7. Add an appointment-suggestions table with expiry and source-message references.
8. Add unique indexes for message client IDs, one current appointment per quest, suggestion acceptance, and command idempotency.
9. Extend outbox kinds to cover group updates and confirmation requests if external delivery uses them.

### Repository work

Update together:

- `EventCoordinationStore`;
- `InMemoryKampungStore`;
- `PostgresKampungStore`;
- shared state parsers/normalizers.

Add transaction-oriented repository commands rather than continuing to replace every child collection blindly for new turn processing. At minimum expose compare-and-set operations for:

- append user coordination message;
- commit interpreted turn result;
- activate appointment version;
- confirm/reject appointment version;
- update group read state;
- synchronize group access from memberships.

Run the same repository contract suite against in-memory and PostgreSQL implementations.

## Agent runtime changes

Update:

- `src/server/agents/agent-runtime.ts`;
- `src/server/agents/openai-agent-runtime.ts`;
- `src/server/agents/deterministic-agent-runtime.ts`;
- `src/server/agents/agent-instructions.ts`;
- provider privacy minimization and audit tests.

Use separate input contexts for private and group turns:

- private: current participant's private thread, their own confirmed requirements, public appointment, and public quest facts;
- group: recent group messages, public appointment, public participant identities, and only aggregate compatibility facts;
- never provide one participant's private thread or raw requirements to another participant or to a group prompt.

The group interpreter must classify ordinary social messages as `social`. The application should produce no assistant message for that intent unless deterministic conflict detection identifies a coordination consequence.

The deterministic runtime must support all key intents with predictable phrases so tests and local development exercise real mutations without a hosted provider.

## API plan

### Quest coordination endpoints

Generalize the existing route while preserving private-chat compatibility:

- `GET /api/v1/event-quests/:questId/coordination/private`
- `POST /api/v1/event-quests/:questId/coordination/private/messages`
- `GET /api/v1/event-quests/:questId/coordination/group`
- `POST /api/v1/event-quests/:questId/coordination/group/messages`
- `POST /api/v1/event-quests/:questId/arrangements/:version/confirm`
- `POST /api/v1/event-quests/:questId/arrangements/:version/reject`
- `POST /api/v1/event-quests/:questId/suggestions/:suggestionId/accept`

The message POST response should return a complete committed turn:

```ts
interface CoordinationTurnResult {
  participantMessage: EventCoordinationMessage;
  agentMessages: EventCoordinationMessage[];
  questRevision: number;
  threadRevision: number;
  currentAppointment: EventArrangement | null;
  outcome: "no_action" | "requirement_updated" | "appointment_changed" |
    "compromise_offered" | "confirmed" | "rejected" | "denied" | "clarification";
}
```

Require `Idempotency-Key`, `clientMessageId`, expected quest revision, and expected thread revision for mutating turns. Return `409` for stale state that cannot be safely re-evaluated and `422` for incompatible/ambiguous structured commands where no alternative is available.

### Messages API integration

Extend `ConversationSummary` with:

- `type: "direct" | "group" | "quest_private" | "quest_group"`;
- `questId` and coordination route metadata;
- capability flags for delete, leave, block, and agent coordination.

Create a conversation query service that merges identity-store conversations with quest coordination threads authorized for the current user. Route quest message reads/writes to `CoordinationTurnService`; keep generic messages routed to `IdentityStore`.

Quest chats cannot be deleted or left through generic chat actions. A participant leaves the quest only through the explicit membership/withdrawal workflow.

## Frontend plan

### Activity coordination hub

Refactor `EventCoordinationConversation` into a shell with:

- a `Private coordination` / `Group chat` switch;
- one persistent appointment status panel;
- shared message list and composer primitives;
- scope-specific privacy/helper copy;
- participant avatars and confirmation progress in group mode;
- structured cards for applied changes, conflicts, confirmations, and finalization.

Remove the organizer-only `Suggest arrangement` action as the primary workflow. Keep an explicit “Find a compatible option” fallback that invokes the same compromise finder when nobody has supplied a concrete request.

### Messages screen

Update `ChatCenter` to render quest conversation types and route them through event clients. Hide Leave/Delete/Block actions when capability flags disallow them. Link quest conversations back to activity details and show current appointment status.

### Optimistic experience

- Optimistically append only the sender's text message.
- Show “Senior Quest is checking the group…” while interpretation and deterministic validation run.
- Do not optimistically change appointment facts.
- Replace the processing state only with the committed result.
- On concurrency conflict, refresh both thread and quest state and show the durable outcome.

### Accessibility and clarity

- Announce applied versus rejected changes distinctly through `aria-live`.
- Show timezone on appointment cards.
- Show the prior and new public values on material changes.
- Keep confirmation controls adjacent to the current version.
- Display exactly who still needs to confirm, without revealing private reasons.

## Ordered implementation slices

Each slice should be deployable behind `AGENTIC_COORDINATION_ENABLED` until the final cutover.

### Slice 0 — Baseline and characterization

1. Run typecheck, lint, unit tests, PostgreSQL integration tests, and production build under Node 22+.
2. Add characterization tests for private requirement extraction, organizer-only arrangement proposal, current confirmation flow, generic group chat membership, and `QuestChatNotifier` behavior.
3. Record current API fixtures so migration compatibility is deliberate.

Exit: existing behavior is reproducible and protected before structural changes.

### Slice 1 — Domain contracts and migration

1. Add thread scope, typed coordination messages, structured intents, working appointment semantics, and suggestion schemas.
2. Add migration 012 and state normalization for existing private threads/arrangements.
3. Update in-memory and PostgreSQL repositories.
4. Add repository parity tests and migration integration tests.

Exit: both stores can persist one group thread, private threads, typed cards, suggestions, and working appointment versions without UI changes.

### Slice 2 — Deterministic appointment command engine

1. Extract appointment patch resolution and compatibility checks from container callbacks.
2. Implement authorized compatible changes by any active participant.
3. Create pending confirmations for every active member and remove organizer auto-confirmation.
4. Implement confirmation by exact version and automatic finalization after all confirm.
5. Implement material-change supersession and stale-version rejection.

Exit: service tests can change and finalize an appointment without invoking an LLM or chat UI.

### Slice 3 — Private-chat tracer bullet

1. Add structured coordination intent output to all agent runtimes.
2. Implement `CoordinationTurnService` for the private thread only.
3. Support time-change, confirmation, status question, and no-action intents first.
4. Derive assistant replies and change cards from committed results.
5. Update the private coordination API/client/component to consume turn results.

Exit: “Move it to 11 AM” in private chat changes the actual working appointment when compatible, and “I confirm” confirms the exact version.

### Slice 4 — Conflict detection and compromise

1. Implement privacy-separated compatibility results.
2. Implement deterministic candidate generation and ranking.
3. Persist offered suggestions and support contextual acceptance.
4. Add no-compatible-option behavior.
5. Ensure group/public records contain no participant-specific failure data.

Exit: an incompatible private request leaves state unchanged and offers a revalidatable compromise that can be accepted conversationally.

### Slice 5 — Quest-owned group chat

1. Create the group thread when organizer membership is formed; expose it once at least one guest accepts.
2. Derive access from active memberships and remove access on withdrawal/replacement/cancellation.
3. Route group messages through `CoordinationTurnService`.
4. Add intervention policy so social messages receive no agent reply.
5. Publish appointment changes, confirmation progress, and finalization cards to the group thread transactionally.
6. Stop creating new event group chats through `QuestChatNotifier`.

Exit: group messages can perform the same authorized appointment actions as private messages, while ordinary chat remains uninterrupted.

### Slice 6 — Remaining intents and requirement reactions

1. Add venue and duration changes.
2. Add unambiguous requirement updates and clarification for sensitive/ambiguous changes.
3. Recalculate compatibility after requirement changes.
4. Add rejection/unavailability recovery.
5. Add organizer-only roster, cancellation, start, and completion intent dispatch with permission-safe denials.

Exit: every supported requirement intent has a deterministic command and an end-to-end conversational test.

### Slice 7 — Unified UI and Messages integration

1. Add the private/group switch and shared appointment status panel to the coordination hub.
2. Add structured cards and pending/processing/error states.
3. Merge quest chats into the Messages conversation list.
4. Add quest capability flags and remove invalid generic Leave/Delete/Block actions.
5. Add mobile, responsive, keyboard, screen-reader, and polling/concurrency coverage.

Exit: users can coordinate from either the activity hub or Messages with identical durable results.

### Slice 8 — Hardening and cutover

1. Add authorization/privacy matrix tests for organizer, accepted participant, pending invitee, former member, and outsider.
2. Add idempotency, duplicate delivery, stale revision, provider failure, restart, and concurrent request tests.
3. Verify audit records contain safe diffs and no private group leakage.
4. Remove obsolete organizer approval/suggestion UI and legacy quest-group creation code.
5. Enable the feature flag in staging, migrate data, monitor errors/conflicts, then enable production.

Exit: all acceptance criteria pass with the feature flag on, and no legacy event chat path remains authoritative.

## Test matrix

### Domain/service

- compatible time, date, duration, and venue changes by organizer and participant;
- organizer-only commands denied to participants;
- partial patches preserve unchanged appointment fields;
- timezones and relative dates resolve deterministically;
- every active participant, including organizer, starts pending on a new version;
- exact-version confirmations and stale confirmation rejection;
- finalization occurs exactly once after the final confirmation;
- material change supersedes the current version and invalidates confirmations;
- private constraint conflict produces only aggregate public output;
- closest valid compromise ranking;
- accepted, expired, and stale suggestions;
- social group messages produce no agent reply;
- direct questions and coordination signals do produce a reply;
- requirement updates recalculate appointment compatibility.

### API/authorization

- session actor overrides any client-supplied identity;
- private thread isolation;
- group access follows active membership;
- pending invitees and former members cannot read/send group messages;
- idempotent replay returns the original turn result;
- stale thread and quest revisions do not overwrite newer state;
- quest chats reject generic leave/delete operations.

### Persistence/integration

- migration of existing private threads and arrangements;
- group messages, appointment version, confirmation reset, notifications, cards, and audit event persist atomically;
- PostgreSQL restart preserves suggestions, current version, read state, and idempotency;
- in-memory/PostgreSQL contract parity;
- provider failure persists the human message but no appointment mutation;
- outbox retry produces no duplicate group cards or notifications.

### Component/end-to-end

- switching between private and group chat preserves independent histories;
- compatible change updates the appointment panel after commit;
- incompatible change displays a compromise without changing the panel;
- “Okay, use that” applies the visible suggestion;
- confirmation progress updates for each signed-in persona;
- final confirmation changes status to scheduled;
- agent stays silent for social group messages;
- Messages and activity hub show the same quest history and state;
- quest chat menus do not expose Leave/Delete/Block.

## Key file map

- Domain contracts: `src/server/domain/event-coordination.ts`
- Application orchestration: `src/server/features/event-coordinator.ts` plus new focused coordination services
- Agent contract/runtimes: `src/server/agents/*agent-runtime.ts`, `src/server/agents/agent-instructions.ts`
- Runtime wiring: `src/server/container.ts`
- Quest repositories: `src/server/repositories/kampung-store.ts`, `src/server/repositories/postgres-kampung-store.ts`
- Generic chat boundary: `src/server/identity/identity-store.ts`, `src/server/identity/postgres-identity-store.ts`
- Existing event-chat bridge to retire: `src/server/features/quest-chat-notifier.ts`
- APIs: `src/app/api/v1/event-quests/**`, `src/app/api/chat/**`
- Clients: `src/features/events/client.ts`
- Activity coordination UI: `src/components/event-coordination-conversation.tsx`
- Messages UI: `src/components/chat-center.tsx`
- Persistence: `db/migrations/012_agentic_event_coordination.sql`
- Primary tests: `tests/event-coordinator.test.ts`, `tests/identity-and-chat.test.ts`, `tests/postgres-store.integration.test.ts`, and new coordination-turn/compatibility/component suites

## Definition of done

- A compatible authorized message in either chat immediately creates the current working appointment version.
- An incompatible request never changes the appointment and offers the closest valid privacy-safe compromise when one exists.
- Natural-language acceptance of a persisted suggestion revalidates and applies it.
- Private facts influence validation without appearing in group prompts, messages, notifications, or participant-visible audit data.
- Every active participant, including the organizer, must confirm the same appointment version before it becomes final.
- Any material change supersedes the prior version and invalidates confirmations.
- Senior Quest responds selectively in group chat and remains silent for ordinary social messages.
- Quest group access follows activity membership and cannot be independently left or deleted.
- The activity hub and Messages UI show the same server-backed coordination state.
- Mutations are authorized, schema-validated, idempotent, optimistic-concurrency-safe, transactional, auditable, and equivalent in the in-memory and PostgreSQL stores.
- Typecheck, lint, unit, integration, component, end-to-end, migration, production-build, privacy, and accessibility checks pass under Node 22+.
