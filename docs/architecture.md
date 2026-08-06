# Current architecture

## Boundary map

```text
Next.js App Router pages and API handlers
        ↓ session + request validation
Feature services and core engine
        ↓ domain commands and safe projections
KampungStore / IdentityStore interfaces
        ↓
In-memory adapters                 PostgreSQL adapters
        ↓                              ↓
Tests and local no-DB mode         Docker/production state
```

The browser is a presentation and command client. It does not own invitations, memberships, quest lifecycle, arrangements, task awards, or the member's authoritative memory.

## Main runtime modules

| Boundary | Files | Responsibility |
| --- | --- | --- |
| App shell | `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app-shell.tsx` | Metadata, auth gate, responsive navigation, user context, badges, logout |
| Identity/auth | `src/lib/auth.ts`, `src/server/identity/*`, `src/app/api/auth/[...all]/route.ts` | Better Auth, profiles, preferences, privacy, sessions, contacts, chat persistence |
| Assistant | `src/components/assistant-conversation.tsx`, `src/server/features/assistant-conversation-service.ts` | Conversation turns, brief extraction, confirmation stream, durable workflow events |
| Quest engine | `src/server/core/kampung-quest-engine.ts`, `src/server/features/quest-pipeline.ts` | Memory, retrieval, synthesis, deterministic validation, safety, and quest runs |
| Event coordinator | `src/server/features/event-coordinator.ts`, `src/server/domain/event-coordination.ts` | Formation, roster, recruitment, invitations, memberships, coordination, arrangements, lifecycle |
| Task/reward flow | `src/server/domain/event-tasks.ts`, `src/server/features/reward-service.ts` | Role acknowledgement, task plan, review, reassignment, points ledger |
| Provider adapters | `src/server/agents/*` | OpenAI/Gemini/deterministic runtimes, embeddings, privacy minimization, SVG thumbnail generation |
| Persistence | `src/server/repositories/*`, `src/server/identity/*store.ts` | In-memory/PostgreSQL parity and optimistic writes |
| Browser feature clients | `src/features/assistant/client.ts`, `src/features/events/client.ts`, `src/features/rewards/client.ts` | Typed fetch wrappers and client request/idempotency identifiers |

## Agent and service pipeline

```text
Assistant conversation
  → memory update
  → multi-direction candidate retrieval
  → quest synthesis
  → deterministic validation
  → safety review
  → event formation
  → application-owned coordination
```

The AI roles are focused: conversation, memory, synthesis, safety, coordination interpretation/recovery, and task-plan generation. Retrieval, validation, authorization, lifecycle transitions, arrangement checks, role/task validation, and reward accounting are application code.

Agent output is parsed with Zod, limited by retry/correction rules, and recorded in local audit data. The model never directly changes participants, sends authoritative invitations, finalizes an arrangement, or awards points.

## Persistence schemas

PostgreSQL currently uses these logical schemas:

| Schema | Responsibility |
| --- | --- |
| `auth` | Better Auth users, accounts, sessions, and verification |
| `identity` | Member profile, preferences, and emergency contact data |
| `chat` | Direct/group conversations, messages, blocks, and deletion state |
| `memory` | Conversation-derived memory versions, facts, constraints, and events |
| `retrieval` | Need, interest, and offer vectors tied to memory versions |
| `assistant` | Assistant conversations, ordered messages, and replayable workflow events |
| `quest` | Quest runs, event coordination aggregates, arrangements, tasks, audit, outbox, and notifications |
| `rewards` | Append-only task awards and reversals |

Migrations are applied in filename order by [`scripts/migrate.mjs`](../scripts/migrate.mjs). Add a new numbered migration instead of editing an applied migration.

## Event state and command safety

An event coordination state contains the proposal, roster, recruitment state, join requests, invitations, memberships, private/group threads, arrangements, task plans, reward entries, notifications, audit events, and outbox jobs.

Commands use:

- actor identity from the session;
- role- and viewer-specific projections;
- optimistic `revision` checks;
- idempotency keys for repeatable mutations;
- atomic state/audit/outbox/reward writes where persistence supports them;
- preserved history for declined, withdrawn, replaced, cancelled, or completed memberships.

Both stores implement the same [`KampungStore`](../src/server/repositories/kampung-store.ts) contract. PostgreSQL adds transaction and locking behavior; tests keep the in-memory adapter as a fast parity target.

## Provider and privacy rules

`AGENT_PROVIDER` selects `gemini` by default outside tests, `openai` when explicitly selected, or `deterministic` for an explicit test/development double. Keys stay server-side. Agent inputs use participant aliases and omit direct contact details and precise addresses.

Embedding vectors from different providers/models are not interchangeable. The retrieval implementation records the embedding space and only compares compatible vectors.

## Images and storage

Quest thumbnails are generated after a quest is saved. The text-capable provider may return a constrained SVG; the application sanitizes/renders it locally, stores optimized WebP bytes in `QUEST_IMAGE_STORAGE_DIR`, and exposes an opaque API URL. Thumbnail failure does not roll back the quest.

Member avatars are orientation-corrected, cropped to 512px, metadata-stripped, and stored as WebP through `AVATAR_STORAGE_DIR`.

## Known product boundaries

- The partner proposal form and reward redemption are not connected to an external system.
- Venue checking is deterministic/local; there is no external venue booking adapter.
- The outbox is persisted for reliable internal delivery state, but push/email delivery adapters are not included.
- `DEMO_SEED_ENABLED` and the exact `test` username support the showcase path; do not treat them as production data.

