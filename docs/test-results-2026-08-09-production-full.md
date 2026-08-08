# Production full browser test report — 2026-08-09

## Target and method

- Target: <https://kampung-quest-production.up.railway.app>
- Browser: Playwright Chromium, fresh browser context per scenario
- Viewports: 360×800, 390×844 (S25 reference), 412×915, 768×1024, 1024×768, 1440×900, and 1920×1080
- Test date: 2026-08-09 (Asia/Singapore)
- Scope: public UI, signed-out navigation protection, public validation/error states, asset loading, unauthenticated API protection, and local regression suite
- Production safety: no quest, invitation, message, preference, reward redemption, task, profile, or account was created or changed. Authenticated mutations were not attempted because production does not currently provide a disposable QA account.

The per-observation raw output is retained in [`results.json`](test-artifacts/production-live-2026-08-09/results.json), with the two follow-up runs in [`additional-results.json`](test-artifacts/production-live-2026-08-09/additional-results.json) and [`additional-results-2.json`](test-artifacts/production-live-2026-08-09/additional-results-2.json).

## Executive result

| Result | Count | Meaning |
|---|---:|---|
| PASS | 118 | Behavior was exercised and the observed result matched the expected result. |
| Product FAIL | 0 | No confirmed product failure was found in the executable safe scope. |
| BLOCKED | 15 | Fixture login accounts could not establish an authenticated session. |
| Corrected setup | 1 | The first partner-preview attempt omitted required fields; it was rerun correctly and passed. |

The release gate is **not fully clear**: authenticated lifecycle coverage is incomplete. Every documented authenticated flow depending on a real member session remains unverified on production. This is a test-environment blocker, not evidence that those flows work.

The production health endpoint passed:

```json
{
  "status": "ok",
  "database": { "ready": true, "adapter": "postgresql" },
  "pgvector": { "ready": true },
  "embeddingIndex": { "ready": true, "indexed": 3, "stale": 0 },
  "agents": { "ready": true, "provider": "gemini" }
}
```

The local regression suite also passed: **41 test files passed, 3 skipped; 252 tests passed, 7 skipped**.

## Executed cases

### Production and responsive shell

- `PROD-001-health` — **PASS**. PostgreSQL, pgvector, embedding index, and Gemini agent readiness were reported healthy.
- Public `/login`, `/register`, and `/partners` — **PASS** at all 7 viewports. Pages returned successfully, rendered, and had no horizontal overflow.
- Protected `/`, `/home`, `/quests`, `/invites`, `/my-quests`, `/messages`, `/rewards`, `/profile`, `/settings`, `/needs`, and `/assistant` — **PASS** at all 7 viewports for signed-out protection. Each redirected to `/login`; no page overflow was observed.
- `ASSET-favicon` and `ASSET-kampung-logo` — **PASS**. `/icon.svg` and `/assets/kampungLogo.svg` returned 200 with SVG content.
- `API-022` unauthenticated protection — **PASS** for activities, rewards, chat conversations, notifications, memories, quests, notification-read, and the unsupported GET user-me endpoint. Protected endpoints returned 401; the unsupported method returned 405.

This is 99 production observations in the primary Playwright run, all passing.

### Auth and registration surface

- Wrong credentials — **PASS**. The user remained on `/login` and received a safe generic authentication error.
- Google sign-in UI — **PASS**. The provider control was present and the error route `/login?error=google` displayed the expected recoverable alert without overflow.
- Facebook login UI — **PASS**. No Facebook login control was found.
- Login control accessibility smoke — **PASS**. Inputs and buttons had usable accessible names in the checked public screen.
- Empty registration submit — **PASS**. Native required-field validation marked five fields invalid without navigating away.
- Registration step-through — **PASS**. A non-submitted preview value set advanced through the form to the accessibility step; the heading appeared once, the removed helper copy was absent, and no obsolete `(optional)` heading remained. No horizontal overflow or visible error was observed.

### Partner preview surface

- Required-field validation — **PASS** after rerun. Empty submission stayed on the form and did not claim success.
- Valid mocked proposal preview — **PASS** after filling the required company, email, and proposal fields. The success preview appeared, with no horizontal overflow. The page is intentionally a browser-only preview and did not mutate production.

The initial `PARTNER-001-mock-proposal` observation was a **test setup error**, not a product failure: the script clicked Preview with required fields empty. The corrected cases are the authoritative result.

### Fixture authentication and authenticated lifecycle

All 15 documented `sqtest.*` fixture usernames were attempted in separate fresh contexts using the documented test password. **All 15 were blocked** because no account established a session. Early attempts returned the normal incorrect-credentials response; later attempts hit the production login rate limiter and returned “Too many requests. Please try again later.” No attempt created an account or changed data.

Because there was no authenticated disposable session, the following documented areas were not safely executable on production and are explicitly **BLOCKED**, not passed:

- `AUTH-004–015` authenticated registration/account/profile cases
- `NAV-002–014` authenticated navigation, hamburger, bottom navigation, and badge behavior
- `ASSIST-001–020` assistant conversations, saved accessibility retrieval, review, consent, and failure recovery
- `PROP-001–014` proposal, validation, review, and human-review cases
- `ACT-001–023` activity suggestions, invitations, notifications, and read state
- `QUEST-001–020` quest creation, joining, roster management, thumbnails, and lifecycle states
- `CHAT-001–024` private/group chat, unread badges, cursor refresh, sending, and activity preview behavior
- `AVAIL-001–015` specific-time and weekly-pattern availability behavior
- `ARR-001–018` arrangement proposal, confirmation, invalid-time, and stale-memory cases
- `TASK-001–002` task completion and points award behavior
- `PROFILE-001–012` profile and settings persistence, including accessibility defaults
- `API-001–020` authenticated API authorization and mutation cases
- `DATA-001–010` persistence, idempotency, and cross-user isolation cases
- `RES-001–022` responsive authenticated states and screenshot-sensitive layouts
- `FLOW-001–005` end-to-end member lifecycle scenarios

## Anomalies and risks

1. **High — production QA authentication is unavailable.** The fixture users documented by the repository cannot be used to enter the authenticated product. This prevents the most important lifecycle coverage: chat delivery, invitations, quest coordination, rewards, settings persistence, and mobile authenticated UI. Provision a disposable production QA account or a controlled staging database before calling the live suite complete.
2. **Medium — repeated fixture attempts triggered login rate limiting.** This is consistent with protective rate limiting, not a confirmed application bug. It does mean an automated full matrix cannot distinguish invalid fixtures from temporarily throttled fixtures after the threshold. Future runs should use one known disposable account, a slow retry budget, and a resettable test identity.
3. **Low — canceled Next.js RSC requests appeared during route transitions.** Playwright recorded `net::ERR_ABORTED` for some `?_rsc=` requests when navigation replaced an in-flight document request. These were expected navigation cancellations: there were no unhandled page exceptions, no deterministic 5xx response, and the final pages loaded. They should not be counted as product failures.
4. **Coverage — no authenticated screenshots are available.** The screenshots below cover all live public/error surfaces that could be safely reached. Authenticated screenshots require a disposable QA identity.

## Screenshot evidence

All evidence is stored under [`docs/test-artifacts/production-live-2026-08-09/`](test-artifacts/production-live-2026-08-09/).

| Surface | Evidence |
|---|---|
| Login, S25-sized viewport | [login-phone-s25.png](test-artifacts/production-live-2026-08-09/login-phone-s25.png) |
| Login, desktop | [login-desktop.png](test-artifacts/production-live-2026-08-09/login-desktop.png) |
| Wrong credentials | [wrong-credentials-phone-s25.png](test-artifacts/production-live-2026-08-09/wrong-credentials-phone-s25.png) |
| Google error recovery | [login-google-error-phone-s25.png](test-artifacts/production-live-2026-08-09/login-google-error-phone-s25.png) |
| Registration, initial | [register-phone-s25.png](test-artifacts/production-live-2026-08-09/register-phone-s25.png) |
| Registration, desktop | [register-desktop.png](test-artifacts/production-live-2026-08-09/register-desktop.png) |
| Registration, empty validation | [register-empty-validation-phone-s25.png](test-artifacts/production-live-2026-08-09/register-empty-validation-phone-s25.png) |
| Registration, accessibility step | [register-accessibility-step3-phone-s25.png](test-artifacts/production-live-2026-08-09/register-accessibility-step3-phone-s25.png) |
| Partner preview, initial | [partners-phone-s25.png](test-artifacts/production-live-2026-08-09/partners-phone-s25.png) |
| Partner preview, desktop | [partners-desktop.png](test-artifacts/production-live-2026-08-09/partners-desktop.png) |
| Partner required validation | [partners-empty-validation-phone-s25.png](test-artifacts/production-live-2026-08-09/partners-empty-validation-phone-s25.png) |
| Partner successful preview | [partners-preview-success-phone-s25.png](test-artifacts/production-live-2026-08-09/partners-preview-success-phone-s25.png) |

## Reproduction and next action

To finish the production lifecycle run without mutating real member data, provision one disposable QA account with known credentials and at least two safe fixture users, then rerun the authenticated matrix from [`docs/test-cases.md`](test-cases.md). The first priority should be the `FLOW-*`, `CHAT-*`, `ACT-*`, `PROP-*`, `ARR-*`, and `ASSIST-*` cases because they cover the highest-impact user lifecycle and the recent performance/error work.

Repository revision used while collecting this report: `5c78c96`. The deployment commit is not exposed by `/health`, so the live-to-local commit mapping could not be independently verified from the public service.
