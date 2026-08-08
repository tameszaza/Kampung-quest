# Kampung Quest documentation

> Living documentation for the web application. Current-state notes are verified against the repository as of **8 August 2026**.

## Read this first

1. [Current web state](current-web-state.md) — what a member can do today, which routes are real, and which experiences are demo-only.
2. [Developer guide](developer-guide.md) — where to edit for each feature, how state flows, and what to test.
3. [API reference](api-reference.md) — the implemented authenticated route inventory.
4. [Architecture](architecture.md) — server boundaries, storage, agents, and lifecycle state.
5. [Test cases](test-cases.md) — reproducible unit, API, browser, responsive, security, and lifecycle QA instructions.
6. [Latest test results](test-results-2026-08-07.md) — per-case evidence, blockers, and follow-up findings from the 7 August 2026 run.
7. [Railway deployment](railway-deployment.md) — production variables, migrations, volumes, and health checks.

## Feature documents

These documents capture product decisions and delivery history. They are useful context, but the code and the current-state guide win when they disagree.

| Document | Use it for | Status |
| --- | --- | --- |
| [Open quest recruitment requirements](open-quest-recruitment-requirements.md) | Recruitment rules, eligibility, privacy, and join requests | Implemented reference; deferred decisions remain at the end |
| [Event task rewards requirements](event-task-reward-requirements.md) | Roles, tasks, points, review, and reversals | Implemented reference; see the redemption plan for the newer code-issuance flow |
| [Reward redemption implementation plan](reward-redemption-implementation-plan.md) | Wallet, offer inventory, atomic redemption, code security, and rollout | Implemented reference |
| [Agentic coordination requirements](agentic-event-coordination-requirements.md) | Coordination behavior and safety requirements | Product contract with current implementation notes |
| [Event coordinator implementation plan](event-coordinator-implementation-plan.md) | Detailed delivery plan for the durable event aggregate | Historical plan plus current status |
| [Agentic coordination implementation plan](agentic-event-coordination-implementation-plan.md) | Earlier agent-oriented coordination plan | Historical plan; use the current file map before editing |

The older plans are intentionally retained so decisions are not lost. They are not a backlog automatically waiting to be implemented.

## Documentation rules

- Treat `src/` and `db/migrations/` as the source of truth for behavior and data shape.
- When a feature changes, update the relevant row in the [developer file map](developer-guide.md#where-to-edit), the [route map](current-web-state.md#web-routes), and the API reference if the public contract changed.
- Keep demo behavior visibly separate from persisted behavior. Do not describe a fixture as a live backend feature.
- Link to the smallest file that owns the behavior. Prefer a component, route handler, service, or migration over a broad directory link.
- Run the verification commands in the [developer guide](developer-guide.md#verification) before handing work to another developer.

## Source-of-truth order

When documentation, a test, and an implementation disagree, use this order while investigating:

1. Database migrations and domain schemas define persisted shape and validation.
2. Server feature services and repositories define authoritative behavior.
3. API route handlers define the HTTP boundary and authorization.
4. Client feature adapters and components define presentation and interaction.
5. Markdown explains intent, status, and navigation.
