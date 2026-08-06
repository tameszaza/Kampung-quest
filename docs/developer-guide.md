# Developer guide

This guide answers the question: **“Which file do I edit?”** Start with the smallest owner in the map, then trace outward through the route, service, and repository.

## Where to edit

| Change | Start here | Also inspect |
| --- | --- | --- |
| Add or change a web page | `src/app/**/page.tsx` | The page component in `src/components/`; route access in its layout |
| Change the authenticated shell or navigation | `src/components/app-shell.tsx` | `src/styles/navigation.css`, `src/components/activity-badge-context.tsx` |
| Change login/register UI | `src/components/auth-form.tsx` | `src/app/(auth)/*/page.tsx`, `src/lib/auth.ts`, `src/server/identity/*` |
| Change onboarding or profile photo upload | `src/components/profile-completion-form.tsx`, `src/components/profile-photo-editor.tsx` | `src/app/api/profile/*`, `src/server/profile/avatar-storage.ts`, identity stores |
| Change member preferences, privacy, security, or emergency contact | `src/app/(app)/settings/page.tsx`, `src/components/security-settings.tsx` | `src/app/api/users/me/route.ts`, `src/app/api/account/*`, `src/server/identity/*` |
| Change the assistant conversation UI | `src/components/assistant-conversation.tsx` | `src/features/assistant/client.ts`, assistant conversation routes and service |
| Change assistant questions or extracted brief validation | `src/server/features/assistant-conversation-service.ts`, `src/server/domain/schemas.ts` | `src/server/agents/agent-instructions.ts`, assistant tests |
| Change synchronous recommendation behavior | `src/server/features/assistant-recommendation-service.ts` | `src/app/api/v1/assistant/recommend/route.ts`, `src/server/core/kampung-quest-engine.ts` |
| Change memory cards or embeddings | `src/server/features/memory-service.ts` | `src/server/agents/embedding-provider.ts`, `src/server/features/retrieval-service.ts`, `db/migrations/001_core_engine.sql` |
| Change candidate retrieval/scoring | `src/server/features/retrieval-service.ts` | `src/server/core/kampung-quest-engine.ts`, retrieval tests, `src/app/api/v1/candidates/[candidateId]/retrieve/route.ts` |
| Change synthesis, validation, or safety | `src/server/features/synthesis-service.ts`, `validation-service.ts`, `safety-service.ts` | `src/server/agents/*`, `src/server/domain/schemas.ts`, pipeline tests |
| Change quest detail or roster editing | `src/components/event-quest-detail.tsx` | `src/features/events/client.ts`, event quest route handlers, `src/server/features/event-coordinator.ts` |
| Change Suggested/Invited/Notifications tabs | `src/components/activities-page.tsx` | `src/features/events/activity-badges.ts`, `src/features/events/client.ts`, `/api/v1/activities` |
| Change My Activities grouping | `src/components/my-quests-page.tsx`, `src/lib/my-activities.ts` | `src/server/features/event-coordinator.ts`, activity tests |
| Change open recruitment or join requests | `src/server/features/recruitment-eligibility-service.ts`, `src/server/domain/event-coordination.ts` | `src/components/event-quest-detail.tsx`, event recruitment/join-request routes, recruitment tests |
| Change private or group quest coordination | `src/components/event-coordination-conversation.tsx` | `src/features/events/coordination-message-presentation.ts`, coordination routes, `src/server/features/coordination-service.ts` |
| Change arrangement suggestion/approval/confirmation | `src/server/features/availability-service.ts`, `src/server/features/event-coordinator.ts` | `src/components/event-quest-detail.tsx`, `src/features/events/client.ts`, arrangement routes |
| Change roles, tasks, review, or reassignment | `src/components/event-task-board.tsx`, `src/server/domain/event-tasks.ts` | `src/server/features/event-coordinator.ts`, task routes, `src/server/features/reward-service.ts` |
| Change points or reward history | `src/server/features/reward-service.ts`, `src/components/rewards-page.tsx` | `src/features/rewards/client.ts`, `src/app/api/v1/rewards/route.ts`, migration `014_event_task_rewards.sql` |
| Change direct/group chat | `src/components/chat-center.tsx`, `src/components/chat-message.tsx` | `src/app/api/chat/*`, `src/server/identity/*`, `src/server/chat/message-sync.ts` |
| Change notifications or unread badges | `src/components/activity-notifications.tsx`, `src/components/activity-badge-context.tsx` | `src/server/quest/quest-notifications.ts`, `/api/v1/notifications/*`, event state |
| Change quest thumbnails | `src/server/agents/quest-image-agent.ts` and `retrying-quest-image-agent.ts` | `src/server/quest/quest-image-storage.ts`, image route, quest image tests |
| Change agent provider/model configuration | `src/server/agents/provider-configuration.ts` | `.env.example`, `compose.yaml`, provider adapters and privacy tests |
| Change database shape | Add a new `db/migrations/NNN_*.sql` migration | Both repositories, domain types/schemas, integration tests, `scripts/migrate.mjs` |
| Change styling/design tokens | `src/styles/tokens.css` or the owning style sheet | Component class names, responsive rules, `src/app/globals.css` |
| Change test personas or demo accounts | `test-data/test-users.csv`, `src/server/testing/test-user-personas.ts` | `scripts/seed-test-users.ts`, demo access rules |

## Follow the state from browser to database

For a server-backed feature, use this trace:

```text
src/app/**/page.tsx
  → src/components/** or src/features/**/client.ts
  → src/app/api/**/route.ts
  → src/server/features/** or src/server/core/**
  → src/server/domain/**
  → KampungStore / IdentityStore
  → memory adapter + PostgreSQL adapter
  → db/migrations/**
```

If a change affects authoritative state, do not stop at the React component or client state. The UI should re-fetch or use the returned server view after a command.

## Rules for the important boundaries

- Bind the acting member from `requireUser()`; never trust a user or candidate ID supplied as proof of identity.
- Validate request bodies with the existing Zod schemas in `src/server/domain/schemas.ts` or `src/server/domain/event-coordination.ts`.
- Event mutations must go through `EventCoordinator` and preserve expected revisions, idempotency, audit events, and safe viewer projections.
- Keep `MemoryKampungStore` and `PostgresKampungStore` in parity. Identity/chat changes likewise need both identity stores.
- Agents may interpret and propose. Application services own authorization, deterministic validation, state transitions, and persistence.
- Keep participant requirements and provider inputs privacy-safe. Use aliases and the minimum facts needed for the model task.
- Do not use `localStorage`, `src/data/mock-data.ts`, or a browser-only decision as a fallback after an API failure.
- If you add a migration, update the repository queries and integration coverage in the same change.

## Verification

Node.js 22 or newer is required.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

For a local PostgreSQL-backed browser check:

```bash
cp .env.example .env
docker compose up --build
```

Then inspect `http://localhost:3000/health`, authenticate at `/register`, and test the relevant route at mobile and desktop widths. Use `docker compose logs -f api | grep quest_image` for thumbnail diagnostics.

## Test ownership

| Area | Test files to start with |
| --- | --- |
| Domain and pipeline | `tests/core-engine.test.ts`, `tests/quest-pipeline.test.ts`, `tests/safety-service.test.ts`, `tests/validation-service.test.ts` |
| Assistant | `tests/assistant-client.test.ts`, `tests/assistant-conversation-service.test.ts`, `tests/coordination-agent-output.test.ts` |
| Coordination | `tests/event-coordinator.test.ts`, `tests/event-participant-history.test.ts`, `tests/event-quest-presentation.test.ts`, `tests/coordination-message-presentation.test.ts` |
| Recruitment and access | `tests/recruitment-eligibility.test.ts`, `tests/quest-access.test.ts`, `tests/availability-control.test.ts` |
| Tasks and rewards | `tests/event-task-rewards.test.ts`, `tests/reward-service.test.ts`, `tests/activity-badges.test.ts` |
| Chat and identity | `tests/identity-and-chat.test.ts`, `tests/chat-message-sync.test.ts`, `tests/quest-chat-notifier.test.ts`, `tests/better-auth.integration.test.ts` |
| Persistence | `tests/postgres-store.integration.test.ts`, `tests/postgres-identity.integration.test.ts`, `tests/compose-configuration.test.ts` |

## When to update docs

Update documentation in the same change when you:

- add or remove a route;
- change a persisted state, lifecycle, permission, or API contract;
- move ownership between a component, service, or repository;
- change demo gating or a preview-only product surface;
- change a command, environment variable, migration, or verification requirement.

