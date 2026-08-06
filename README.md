# Kampung Quest

Kampung Quest is a Next.js web application that helps older adults turn needs, interests, skills, and accessibility constraints into safe group activities with neighbours. The current web product includes authenticated onboarding, a guided assistant, server-backed activity formation, invitations, open recruitment, private/group coordination, arrangement confirmation, tasks, and points.

> Current implementation notes: [docs/current-web-state.md](docs/current-web-state.md) · [developer file map](docs/developer-guide.md#where-to-edit) · [API reference](docs/api-reference.md)

## Start locally

Node.js 22 or newer is required.

### Docker + PostgreSQL

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). The root redirects to `/login`.

Useful routes:

- `/register` — create a member account
- `/home` — authenticated dashboard
- `/messages` — direct/group chat and the embedded Senior Quest assistant
- `/quests` — suggested activities, invitations, and notifications
- `/my-quests` — joined activity lifecycle
- `/rewards` — points and preview offers
- `/partners` — public partner preview
- `/health` — container health response

Stop the stack with:

```bash
docker compose down
```

### Host development

```bash
npm ci
npm run dev
```

Without `DATABASE_URL`, development can use the in-memory adapters. Docker and production use PostgreSQL with pgvector.

## Verify changes

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The full testing and feature ownership map is in [docs/developer-guide.md](docs/developer-guide.md).

## Documentation

Start at [docs/README.md](docs/README.md). It separates current behavior from historical product plans and explains where the next developer should edit.

| Need | Document |
| --- | --- |
| Understand the live web experience | [Current web state](docs/current-web-state.md) |
| Find the file for a change | [Developer guide](docs/developer-guide.md) |
| Inspect HTTP routes | [API reference](docs/api-reference.md) |
| Understand agents, services, and storage | [Architecture](docs/architecture.md) |
| Read recruitment, coordination, or rewards decisions | [Feature documents](docs/README.md#feature-documents) |

## Architecture in brief

```text
Member conversation
  → memory and structured constraints
  → candidate retrieval
  → quest synthesis
  → deterministic validation
  → safety review
  → editable roster and invitations
  → coordination and public arrangement
  → confirmed activity, tasks, and reviewed points
```

The model proposes and interprets. Application services own permissions, exact constraints, state transitions, audit history, idempotency, and reward accounting. The central boundaries are:

- [`src/server/core/kampung-quest-engine.ts`](src/server/core/kampung-quest-engine.ts) — memory, retrieval, proposal orchestration, validation, and safety.
- [`src/server/features/event-coordinator.ts`](src/server/features/event-coordinator.ts) — durable event formation and coordination.
- [`src/server/repositories/kampung-store.ts`](src/server/repositories/kampung-store.ts) — storage contract shared by memory and PostgreSQL adapters.
- [`src/server/identity/identity-store.ts`](src/server/identity/identity-store.ts) — profile, preferences, contacts, and chat contract.

## Provider configuration

The default hosted provider outside tests is Gemini. OpenAI and an explicit deterministic provider are also supported:

```bash
AGENT_PROVIDER=gemini
GEMINI_API_KEY=your-server-side-key
```

or:

```bash
AGENT_PROVIDER=openai
OPENAI_API_KEY=your-server-side-key
```

See [.env.example](.env.example) for model and storage settings. Keep provider keys server-side; never use `NEXT_PUBLIC_` for them.

`AGENT_PROVIDER=deterministic` is a deliberate development/test double, not an automatic provider-failure fallback.

## Demo and product boundaries

- Showcase fixtures and seeded welcome chats are gated to the exact username `test`.
- Normal accounts see their real persisted state and may have empty activities until they create or receive one.
- `/partners` is a non-persisted partner proposal preview.
- `/rewards` reads real balances and approved task history, but offer redemption is not implemented.
- Quest thumbnails are best effort and never block quest creation.

## Competition context

This repository was built for the AI Agent / Skills Track of the WorkBuddy “Age Well” hackathon. The product goal is to reduce isolation while preserving dignity, consent, accessibility, safety, and human choice. The application code and documentation are the source for the demo, video, and deck.
