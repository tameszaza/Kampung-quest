# Senior Quest test cases and QA instructions

This is the executable QA plan for the current Senior Quest application. It covers the authenticated member journey, the event-coordination lifecycle, direct and group chat, rewards, the Gemini/SVG thumbnail path, responsive UI, API authorization, persistence, accessibility, and failure recovery.

Use the source code and database migrations as the behavioral source of truth. Product plans may describe future behavior; do not mark a test passed because a plan says it should exist.

## 1. Test policy

Every change should be checked at the smallest useful level and then through the affected user journey:

1. Run focused unit tests for the changed service or component.
2. Run typecheck and lint.
3. Run the full Vitest suite.
4. Run the affected browser flow at desktop and mobile widths.
5. Run the full lifecycle smoke flow for changes touching persisted event state, identity, chat, or rewards.

For each manual or browser test, record:

- test ID, date, commit, environment, browser, viewport, and signed-in persona;
- exact setup/data fixture or API seed used;
- steps and expected result;
- actual result and evidence path;
- network/console errors, if any;
- pass, fail, blocked, or not applicable;
- bug ID when the result is not pass.

Do not use real personal information, real emergency contacts, production credentials, or production databases during QA.

## 2. Environment and test data

### 2.1 Required versions and services

- Node.js 22 or newer.
- PostgreSQL with pgvector for persistence and integration coverage.
- A browser with responsive emulation. Playwright is preferred for repeatable UI checks.
- `AGENT_PROVIDER=deterministic` for repeatable local functional tests unless the test explicitly covers Gemini or OpenAI behavior.
- `AGENT_PROVIDER=gemini` plus a server-side `GEMINI_API_KEY` for provider and thumbnail tests.
- `LOG_LEVEL=debug` only while diagnosing a test; use `info` for normal runs.

### 2.2 Safe local setup

Run these commands from the repository root:

```bash
npm ci
cp .env.example .env
npm run db:migrate
SEED_TEST_USERS=YES npm run db:seed-test-users
npm run dev -- --port 3000
```

Check the app before starting browser tests:

```bash
curl -f http://localhost:3000/health
```

The normal UI is available at `http://localhost:3000`. If the development server uses another port, use that port consistently in all browser and API tests.

### 2.3 Resetting test data

`db:reset` is destructive. Only run it against a local disposable database:

```bash
RESET_DATABASE=NUKE npm run db:reset
npm run db:migrate
SEED_TEST_USERS=YES npm run db:seed-test-users
```

The reset script must refuse to run without `RESET_DATABASE=NUKE`, must refuse non-local hosts, and must report the number of truncated tables. The seed script must refuse to run without `SEED_TEST_USERS=YES`, must refuse production, and must accept only local database hosts.

The seeded users contain profiles and memories but do not create a complete active quest. For lifecycle tests, create the quest through the assistant or use a dedicated test fixture/factory. Never hand-edit production-like state to make a UI screenshot pass.

### 2.4 Seeded account matrix

All CSV fixtures use the password `KampungQuest15!`. Usernames are case-sensitive in test instructions and should be entered exactly as shown.

| Persona | Username | Role in test coverage |
| --- | --- | --- |
| Alice Tan | `sqtest.cook.host` | Cooking organizer; strong matches with Siti and Grace |
| Siti Rahman | `sqtest.cook.halal` | Cooking participant with halal constraint |
| Grace Lee | `sqtest.cook.access` | Cooking participant with vegetarian and step-free constraint |
| Gopal Nair | `sqtest.garden.host` | Gardening organizer; strong matches with Noor and David |
| Noor Aziz | `sqtest.garden.seated` | Accessibility-sensitive gardening participant |
| David Koh | `sqtest.garden.walk` | Gardening and companionship participant |
| John Lim | `sqtest.tech.host` | Technology-help organizer |
| Helen Wong | `sqtest.tech.errands` | Short-distance technology participant |
| Farah Ismail | `sqtest.tech.language` | Plain-language technology participant |
| Maria Santos | `sqtest.filter.time` | Hard availability filter case |
| Li Wei | `sqtest.filter.language` | Hard language filter case |
| Ravi Menon | `sqtest.filter.distance` | Hard distance filter case |
| Sofia Pereira | `sqtest.filter.group` | Hard group-size filter case |
| Anne Chua | `sqtest.reserve.cook` | Reserve cooking replacement candidate |
| Kumar Das | `sqtest.reserve.tech` | Reserve technology replacement candidate |

The exact fixture source is [`test-data/test-users.csv`](../test-data/test-users.csv). Do not assume names such as “Community member” or database IDs are acceptable UI output when a seeded profile is available.

### 2.5 Browser matrix

Run every changed page at least at these widths:

| Profile | Viewport | Main checks |
| --- | ---: | --- |
| Small Android | 360 × 800 | no horizontal overflow, readable controls, fixed bottom navigation |
| Samsung S25-like | 390 × 844 | hamburger badge, bottom navigation, chat composer, date picker |
| Large phone | 412 × 915 | long labels, cards, dialogs, safe-area spacing |
| Tablet | 768 × 1024 | desktop shell transition, no duplicate navigation |
| Small desktop | 1024 × 768 | compact navigation and dense panels |
| Desktop | 1440 × 900 | sidebar, multi-column cards, full task/reward layouts |
| Wide desktop | 1920 × 1080 | max-width behavior and no stretched content |

For every viewport, assert:

```js
document.documentElement.scrollWidth === document.documentElement.clientWidth
```

unless horizontal scrolling is intentional inside a tab strip or picker. Intentional internal scrolling must not create page-level overflow.

## 3. Automated verification gates

Run the normal gate before review:

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected results:

- typecheck exits 0;
- lint has 0 errors; existing warnings must be identified rather than silently increased;
- all tests pass except explicitly documented, pre-existing failures;
- build compiles and lists every expected route;
- diff check reports no whitespace errors.

### 3.1 Existing automated test ownership

Use these files before adding duplicate coverage:

| Area | Existing tests |
| --- | --- |
| Core memory, retrieval, proposal, validation, safety | `tests/core-engine.test.ts`, `tests/quest-pipeline.test.ts`, `tests/safety-service.test.ts`, `tests/validation-service.test.ts` |
| Assistant turns and workflow replay | `tests/assistant-conversation-service.test.ts`, `tests/assistant-client.test.ts` |
| Gemini/OpenAI output and privacy | `tests/gemini-agent-runtime.test.ts`, `tests/gemini-provider-fetch.test.ts`, `tests/openai-agent-runtime.test.ts`, `tests/provider-privacy.test.ts` |
| SVG/WebP quest thumbnail | `tests/quest-thumbnail-agents.test.ts`, `tests/postgres-store.integration.test.ts` |
| Event lifecycle and roster | `tests/event-coordinator.test.ts`, `tests/event-participant-history.test.ts`, `tests/event-quest-presentation.test.ts` |
| Recruitment and access | `tests/recruitment-eligibility.test.ts`, `tests/quest-access.test.ts`, `tests/availability-control.test.ts` |
| Tasks, review, reassignment, points | `tests/event-task-rewards.test.ts`, `tests/reward-service.test.ts` |
| Activity notifications and badges | `tests/quest-notifications.test.ts`, `tests/activity-badges.test.ts`, `tests/my-activities.test.ts` |
| Identity and direct/group chat | `tests/identity-and-chat.test.ts`, `tests/chat-message-sync.test.ts`, `tests/quest-chat-notifier.test.ts`, `tests/conversation-projection.test.ts`, `tests/conversation-preview.test.ts` |
| Persistence and adapters | `tests/postgres-store.integration.test.ts`, `tests/postgres-identity.integration.test.ts`, `tests/better-auth.integration.test.ts`, `tests/compose-configuration.test.ts` |

## 4. Browser test instructions

There is no committed Playwright test suite in the current package scripts. Until one is added, use the browser’s Playwright runner or a temporary `node --input-type=module` script. Prefer accessible locators:

```js
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
await page.locator('input[name="identifier"]').fill("sqtest.garden.host");
await page.locator('input[name="password"]').fill("KampungQuest15!");
await page.locator("button.auth-submit").click();
await page.waitForURL(/\/home|\/quests|\/messages/);
```

For every browser test:

- wait for `domcontentloaded` and then an explicit stable UI condition;
- avoid `networkidle` because the app intentionally polls activity and chat state;
- collect console errors and failed requests;
- record requests to `/api/v1/activities`, chat message endpoints, and assistant endpoints when network efficiency matters;
- take screenshots only after the expected state is visible;
- close the browser and clear the test profile after the test.

For tests that need a deterministic unread badge or failure, intercept the specific API response in the test browser. Do not add fake data to production code or local storage as an application fallback.

### 4.1 Production live smoke matrix

Run this matrix against `https://kampung-quest-production.up.railway.app` before declaring a release healthy. These checks are intentionally read-only: do not create a quest, send a message, accept/decline an invitation, change preferences, redeem a reward, or mark a task complete on production unless a separate disposable production test account and rollback plan have been approved.

#### Prerequisites

- Use a fresh Playwright browser context for every persona and viewport.
- Use only the seeded QA accounts listed in section 2.4; never use a personal or customer account.
- Confirm the site loads over HTTPS and record the commit/deployment shown by the release owner before starting.
- Record browser console errors, failed requests, response status, and screenshots for each failed or visually important case.
- For every viewport, assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- If a case requires a missing state (for example, an unread invitation or a completed quest), mark it `blocked` rather than manufacturing data in production.

#### Case matrix

| ID | Preconditions and steps | Expected result |
| --- | --- | --- |
| PROD-001 | Open the live root while signed out. | HTTPS responds, the app redirects to login, and no protected content flashes. |
| PROD-002 | While signed out, open `/home`, `/activities`, `/messages`, `/my-quests`, `/rewards`, `/profile`, and `/settings`. | Each protected route redirects safely to login without a 5xx response. |
| PROD-003 | Log in as `sqtest.garden.host`; reload the landing route. | Session persists, profile identity is correct, and the shell renders once without hydration or console errors. |
| PROD-004 | At 1440×900, open Home, Activities, My Activities, Rewards, Messages, Profile, and Settings through the sidebar. | Each route loads its primary heading and active navigation state; no page-level overflow occurs. |
| PROD-005 | At 390×844, open the hamburger menu from a page that hides desktop-only navigation. | Menu opens in the existing surface, exposes Activities/My Activities/Rewards/Messages/Profile/Settings, closes cleanly, and does not add horizontal overflow. |
| PROD-006 | At 390×844, inspect the fixed bottom navigation on Home, Activities, Rewards, and Messages. | Bottom navigation remains visible, does not cover the composer or primary content, and active labels/icons are readable. |
| PROD-007 | Open Rewards at desktop and mobile widths. | Points balance, usable-code empty/populated state, partner offers, history, and loading/error states have stable layout; usable codes and deals remain visibly separated. |
| PROD-008 | On Rewards at 360×800, 390×844, and 412×915, scroll through all offers. | Offer cards, “More details,” headings, and fixed navigation do not clip or overflow. |
| PROD-009 | Open Activities and inspect Suggested, Invited, and Notifications tabs. | Each tab can be selected, badges/counts match visible unread items, and empty states are intentional rather than broken panels. |
| PROD-010 | Open My Activities and select Awaiting coordination, Awaiting confirmation, Upcoming, Completed, and Cancelled. | Each subcategory renders its correct empty/card state; counts appear only when nonzero and use the intended color/style. |
| PROD-011 | Open Messages with the seeded account. | Conversation list, latest previews, unread badges, selected conversation, and composer load without duplicate requests or console errors. |
| PROD-012 | Stay on Messages for 6 seconds with Network logging enabled. | Ordinary chat does not repeatedly download the full history; polling is bounded and the page remains responsive. |
| PROD-013 | Open an existing activity conversation if one is available, then switch Private/Group views. | The latest preview is the latest message from either scope, switching scope does not duplicate messages, and group unread state is represented in the conversation list. |
| PROD-014 | Open an existing quest card/detail if available. | Correct thumbnail or intentional fallback loads for the viewer, participant/organizer sections do not overlap, and the back link preserves the originating area. |
| PROD-015 | Open Profile and inspect the profile dialog/card if available. | Name, handle, avatar, and safe public information render; internal database IDs and raw object text are not exposed. |
| PROD-016 | Open Settings and inspect accessibility defaults and display settings without saving. | Optional stairs, distance, language, text-size, contrast, and privacy controls are present, labelled, keyboard reachable, and visually consistent. |
| PROD-017 | Use Tab/Shift+Tab through login, hamburger, tabs, cards, and primary buttons. | Focus is visible, order is logical, icon-only controls have accessible names, and no focus is trapped outside an intentional menu/dialog. |
| PROD-018 | Inspect the accessibility tree on Rewards, Messages, Activities, and My Activities. | Headings are hierarchical, tabs expose selected state, badges do not replace accessible labels, and status/error regions are announced. |
| PROD-019 | Test 360×800, 390×844, 412×915, 768×1024, 1024×768, 1440×900, and 1920×1080. | Shell breakpoints are coherent, content remains readable, and no viewport has page-level horizontal overflow. |
| PROD-020 | Collect all image requests while visiting Home, Activities, My Activities, Rewards, and Messages. | No broken image responses, no unexpected placeholder for an available asset, and decorative images have empty alt text. |
| PROD-021 | Collect all responses and console events during the route sweep. | No unexpected 4xx/5xx requests, uncaught exceptions, hydration errors, or repeated identical fetch storms. |
| PROD-022 | Call `/api/v1/activities`, `/api/v1/rewards`, `/api/chat/conversations`, and `/api/users/me` from a fresh signed-out context. | Protected APIs reject/redirect safely (401/403/3xx, or 405 when the route intentionally disallows GET) and do not return user data. |
| PROD-023 | Reload every tested route directly and use browser Back/Forward between Messages, Activities, My Activities, and Rewards. | Deep links recover their state, browser history works, and no route becomes stuck on a loading shell. |
| PROD-024 | Run the same route sweep as `sqtest.garden.walk` in a fresh context. | A second persona sees only its own safe projections; no identity, avatar, chat, reward, or activity data leaks from the first context. |
| PROD-025 | If a live state already contains a pending invite, suggested quest, unread notification, or saved accessibility preference, inspect it without mutating it. | The relevant badge/card/agent retrieval UI is placed in the correct parent tab and has no duplicate notification surface. |
| PROD-026 | If any request fails during the sweep, preserve the response body/status, console output, route, viewport, and screenshot, then retry once in a fresh context. | Intermittent infrastructure failures are separated from deterministic UI/API failures; no failure is silently swallowed. |

## 5. Test case catalog

Each case below is a minimum scenario. Add a regression test when the case exposes a bug or when it changes authoritative state.

### 5.1 Authentication and onboarding

| ID | Setup and action | Expected result |
| --- | --- | --- |
| AUTH-001 | Visit `/` while signed out. | Redirects to `/login`; no authenticated page flashes. |
| AUTH-002 | Submit login with an unknown username. | A human-readable error appears; password is not exposed; no partial session is created. |
| AUTH-003 | Submit login with a wrong password. | Same safe error behavior; no redirect to an authenticated route. |
| AUTH-004 | Login with each seeded persona. | Session is created and the member lands on the authenticated home/continue route. |
| AUTH-005 | Refresh an authenticated page. | Session survives refresh; no duplicate login or hydration error. |
| AUTH-006 | Open `/home`, `/messages`, `/quests`, `/my-quests`, `/rewards`, `/profile`, and `/settings` signed out. | Each route redirects safely to login. |
| AUTH-007 | Log out, then press browser Back and request an authenticated API. | Protected content/API remains unavailable; session cookie is invalidated. |
| AUTH-008 | Register with missing required fields. | Native/server validation identifies the field and preserves entered safe values. |
| AUTH-009 | Register with a duplicate username. | Availability check and final submit reject the duplicate without creating a second account. |
| AUTH-010 | Register with mismatched passwords and a password shorter than policy. | Validation is immediate and server-side validation also rejects it. |
| AUTH-011 | Complete profile with an optional phone/photo omitted. | Profile completes with nullable fields; later UI says “Not shared” where appropriate. |
| AUTH-012 | Upload a valid avatar, an oversized file, a non-image, and a malformed image. | Valid image is optimized; invalid uploads are rejected without corrupting the profile. |
| AUTH-013 | Authenticate through the configured Google path if enabled. | Existing user continues to `/home`; incomplete user continues to profile completion; callback errors are safe. |
| AUTH-014 | Open `/register/complete` as a complete user and as an incomplete user. | Complete users are redirected appropriately; incomplete users can finish onboarding. |
| AUTH-015 | Submit the same login/register request twice rapidly. | UI disables duplicate submit; server does not create duplicate accounts or sessions. |

### 5.2 Shell, navigation, responsive layout, and accessibility

| ID | Setup and action | Expected result |
| --- | --- | --- |
| NAV-001 | Visit every authenticated route at all browser widths in the matrix. | No page-level horizontal overflow, clipped primary content, or duplicate nav systems. |
| NAV-002 | At phone width, verify fixed bottom navigation. | Home, Quests, Messages, Profile, and the central create action are reachable; content has bottom safe-area clearance. |
| NAV-003 | At phone width, open the hamburger menu. | Menu opens as an accessible dialog/sheet, traps no broken focus, closes by close button, backdrop, and Escape where supported. |
| NAV-004 | Give My Activities an unread item and inspect the closed hamburger trigger. | Red badge appears on the hamburger before the sheet opens; aria-label announces the count. |
| NAV-005 | Open the hamburger and inspect My Activities. | The same unread count appears on the My Activities row; opening My Activities clears the unread badge only after the category is read. |
| NAV-006 | At desktop width, inspect Activities, My Activities, and Messages nav items. | Activity/notification badges are red pill badges; zero is omitted; labels and badges do not overlap. |
| NAV-007 | Use browser Back from a My Activities quest detail. | Returns to `/my-quests` and preserves the originating tab rather than defaulting to Activities. |
| NAV-008 | Use the quest-detail Back link from Activities, Invited, and My Activities. | Each returns to the correct source context. |
| NAV-009 | Keyboard-tab through nav, tabs, cards, buttons, dialogs, and forms. | Focus is visible, order is logical, and every action is keyboard-operable. |
| NAV-010 | Inspect icon-only controls with a screen reader/accessibility tree. | Menu, profile, close, retry, badge, and navigation controls have meaningful accessible names. |
| NAV-011 | Change text size and high-contrast settings. | Layout remains usable; contrast improves/holds; no text is clipped or hidden behind fixed navigation. |
| NAV-012 | Test long names, long quest titles, `99+` counts, and translated/long labels. | Text wraps or truncates intentionally without pushing controls off-screen. |
| NAV-013 | Refresh after opening a tab that cleared a badge. | Read state persists for that user and does not leak to another user or browser profile. |
| NAV-014 | Open the same page in two tabs and read a category in one. | The other tab eventually reflects the shared read state or refreshes safely; no badge is permanently stuck. |

### 5.3 Assistant conversation and quest brief

| ID | Setup and action | Expected result |
| --- | --- | --- |
| ASSIST-001 | Start a new Senior Quest conversation from Messages. | A persisted conversation is created once; the welcome message is visible. |
| ASSIST-002 | Answer with a free-form need, interest, contribution, availability, group size, setting, stairs, distance, language, and consent. | Assistant asks only needed follow-ups and the review brief reflects the current request. |
| ASSIST-003 | Use quick replies and then edit the same answer. | The latest answer replaces the active fact without duplicating old facts. |
| ASSIST-004 | Say “not yet” to the start-quest/consent question. | Preferences are saved, consent remains ungranted, the user is not stuck, and matchmaking is not started. |
| ASSIST-005 | Say “yes” to review but do not grant invitation consent. | Review is visible; matchmaking remains blocked with an actionable consent control. |
| ASSIST-006 | Edit every review field individually. | Only the selected field changes; unrelated fields and the conversation remain intact. |
| ASSIST-007 | Reload during the review page. | Persisted brief and workflow state return without a duplicate quest. |
| ASSIST-008 | Submit an empty message, whitespace, a very long message, and unsupported control characters. | Empty input is blocked; length/schema rules are enforced; UI remains responsive. |
| ASSIST-009 | Click Confirm once and double-click/press Enter repeatedly. | One idempotent workflow/quest is created; no duplicate event or invitations. |
| ASSIST-010 | Interrupt the assistant confirmation stream and reload. | Persisted workflow events replay from the last sequence; the UI does not restart from a false state. |
| ASSIST-011 | Make a second request after an older request is complete. | New active need wins; older goals do not guide the new match unless explicitly retained. |
| ASSIST-012 | Update need/contribution/availability while proposal generation is in progress. | Candidate retrieval/validation uses a coherent memory version; stale proposal is refreshed or safely rejected. |
| ASSIST-013 | Trigger a provider timeout, 429/quota, malformed structured output, and unavailable provider. | User receives a safe retryable message; no false success or partial authoritative state is shown. |
| ASSIST-014 | Use a response containing an opaque/unknown fact reference. | Unknown facts are rejected or normalized safely; no invented memory is persisted. |
| ASSIST-015 | Include private addresses, contact details, medical information, passwords, or emergency details in assistant text. | Provider input is redacted/minimized; sensitive data is not sent as unnecessary model context or rendered in public quest text. |
| ASSIST-016 | Open `/assistant` and `/messages?assistant=1`. | Both route to the same embedded assistant experience with the correct conversation. |
| ASSIST-017 | Reset/start over in assistant options. | A new conversation state is created without deleting unrelated direct/group chats. |
| ASSIST-018 | Complete a brief for a member with saved accessibility defaults. | The saved-preferences agent card is absent while collecting answers, appears at the bottom immediately before final review, shows each retrieval step, and changes to an applied state after its animation. |
| ASSIST-019 | Complete a brief for a member without saved accessibility defaults. | No retrieval card is shown and the normal final review remains available. |
| ASSIST-020 | Navigate away while a turn is pending, then return. | In-flight state reconciles from server history; no duplicate turn is created. |

### 5.4 Proposal, validation, safety, and thumbnail generation

| ID | Setup and action | Expected result |
| --- | --- | --- |
| PROP-001 | Create a valid proposal with complementary need and contribution. | Proposal is synthesized, validated, safety-approved, and saved with a stable run ID. |
| PROP-002 | Use a hard availability mismatch. | Candidate is excluded; no invitation is sent to an unavailable participant. |
| PROP-003 | Use no shared language. | Candidate is excluded with a deterministic reason. |
| PROP-004 | Use distance beyond both participants’ limits. | Candidate is excluded; raw distance/internal IDs are not shown as user-facing explanation. |
| PROP-005 | Use incompatible group-size ranges. | Candidate is excluded with a clear compatibility reason. |
| PROP-006 | Use a step-free participant and a venue requiring stairs. | Validation blocks the proposal or requires a safe alternative. |
| PROP-007 | Use a proposal need/contribution not present in the participant’s active memory. | Proposal is rejected and tells the organizer which need/contribution must be refreshed; no silent mismatch. |
| PROP-008 | Use a proposed time outside participant availability. | Validation blocks it with an actionable time/availability correction. |
| PROP-009 | Trigger human review. | The detail page uses a coherent “Needs review” state, shows checks/constraints, participant cards, and next action without overlapping columns or floating fragments. |
| PROP-010 | Generate a Gemini text SVG thumbnail. | SVG is sanitized, rendered/stored as the normal WebP asset, and displayed in organizer and participant views. |
| PROP-011 | Return malformed, oversized, unsafe, script-containing, or non-SVG provider output. | Output is rejected/sanitized; quest remains usable with a safe placeholder/fallback; no script executes. |
| PROP-012 | Make thumbnail generation timeout or return quota failure. | Quest creation remains successful; UI does not stay blocked; retry/diagnostic logging identifies the image stage. |
| PROP-013 | Refresh/visit the same quest as organizer and participant. | Both receive the same persisted image URL, not role-specific placeholder behavior. |
| PROP-014 | Request the stored image with an invalid key or path traversal string. | Returns safe not-found/error response; no filesystem disclosure. |

### 5.5 Activities, invitations, notifications, and badges

| ID | Setup and action | Expected result |
| --- | --- | --- |
| ACT-001 | Open `/quests` with no activities. | Empty state is helpful, compact, and does not show false counts or demo content. |
| ACT-002 | Create a visible suggestion. | Suggested tab shows a readable card with title, concise description, time, and one clear action. |
| ACT-003 | Open a suggestion card. | Correct quest detail opens; back navigation returns to Suggested. |
| ACT-004 | Hide/dismiss a suggestion. | It disappears for that user and is not recreated by a normal refresh. |
| ACT-005 | Create a pending invitation. | Invited/Received shows the card and accept/decline actions; Suggested does not duplicate it. |
| ACT-006 | Open Invited. | Invited unread badge clears; only Invited is marked read. |
| ACT-007 | Accept an invitation. | Invitation becomes accepted exactly once, membership appears in My Activities, and a toast explains where the activity moved. |
| ACT-008 | Decline an invitation. | Invitation history is preserved; the activity does not remain falsely actionable. |
| ACT-009 | Open Sent invitations as organizer. | Sent view lists the correct guest and status; raw user/database IDs never appear. |
| ACT-010 | Organizer selects a group but has not sent invitations. | The selected activity is not shown to potential participants as an invitation/suggestion unless recruitment rules explicitly make it discoverable. |
| ACT-011 | Organizer sends invitations. | Recipients receive the invitation in Invited and the organizer sees sent status. |
| ACT-012 | Participant accepts after organizer replaces the same user. | Latest status is accepted/joining, not permanently “replaced”; old history remains auditable. |
| ACT-013 | Generate multiple new items across Suggested, Invited, Notifications, and My Activities. | Each category shows the correct new count; parent Activities count de-duplicates the same run across notification/invitation records. |
| ACT-014 | Open one Activities category. | Its unread badge clears; other category badges remain. |
| ACT-015 | Open My Activities through desktop nav. | Parent My Activities new badge clears only according to the product read rule; tab totals remain. |
| ACT-016 | Open one My Activities subcategory. | Its red unread badge clears; its parenthetical total remains; other subcategory unread badges remain. |
| ACT-017 | Add a new quest to a known My Activities subcategory. | That tab shows total `(n)` plus a red unread badge; the parent nav and mobile hamburger show a new-item badge. |
| ACT-018 | Open a group chat message notification. | It updates the group-chat unread badge/list row, not the separate Notifications tab count. |
| ACT-019 | Mark Notifications read. | Server notification read state updates; the local badge does not reappear on refresh. |
| ACT-020 | Close/reopen browser without opening a category. | Unread local markers persist per user; another user/browser profile has independent markers. |
| ACT-021 | Fail `/api/v1/activities` after a successful load. | Existing cards remain; compact recovery banner appears; raw `NetworkError` text is not shown; retry works. |
| ACT-022 | Fail the initial activities load. | No giant broken panel or false empty state; the user sees a compact retry state and no fake activities. |
| ACT-023 | Use a count of 0, 1, 99, and 100. | Zero is omitted; normal numbers display; large values use the intended compact representation without overflow. |

### 5.6 Quest detail, roster, participants, and access control

| ID | Setup and action | Expected result |
| --- | --- | --- |
| QUEST-001 | Open an authorized quest as organizer. | Hero, persisted thumbnail, status, time, duration, venue, group size, participants, and actions are coherent. |
| QUEST-002 | Open the same quest as accepted participant. | Participant sees allowed details/actions but not organizer-only controls or private audit data. |
| QUEST-003 | Open the same quest as pending invitee. | Only allowed invitation/review information is shown; chat and restricted data stay locked until accepted. |
| QUEST-004 | Open as an outsider with an unrelated account. | Detail and participant/profile APIs return a safe authorization error; no participant or contact data leaks. |
| QUEST-005 | Click each participant name/photo. | Shared profile dialog opens with correct name/avatar and privacy-safe contact/emergency fields. |
| QUEST-006 | Close profile by close button, backdrop, and Escape. | Dialog closes without navigation or state loss; focus returns to the trigger. |
| QUEST-007 | Inspect participant cards with opaque IDs in storage. | UI displays resolved names/photos/roles; no database IDs appear. |
| QUEST-008 | Organizer starts roster editing. | Editing controls are integrated into the participation section; invitation-status UI is not duplicated below. |
| QUEST-009 | Search contacts and add a person. | Results show avatar/name/username; add validates constraints and updates the authoritative state. |
| QUEST-010 | Remove a selected participant. | Remove is available only to organizer and non-organizer members; roster count/revision updates. |
| QUEST-011 | Attempt to remove organizer or add duplicate member. | Server rejects safely; no duplicate roster row. |
| QUEST-012 | Confirm roster once and double-submit. | One invitation set is created; revision/idempotency prevents duplicates. |
| QUEST-013 | Replace a pending/accepted participant. | Invitation history is preserved; replacement returns to group selection and status reflects the latest membership. |
| QUEST-014 | Replace a participant with the same user again. | Current membership/invitation status is derived from the latest history and does not remain incorrectly “replaced.” |
| QUEST-015 | Use stale browser revisions from two organizer tabs. | One mutation succeeds; the other gets a recoverable conflict and refreshes rather than overwriting state. |
| QUEST-016 | Open the participant profile API with another quest ID. | Access is denied unless the target is a participant in that authorized quest. |
| QUEST-017 | Open a `human_review` quest. | Review layout is aligned and readable; concrete constraints and safety status are visible; unsafe actions are disabled. |
| QUEST-018 | Switch organizer/participant accounts after a quest update. | Both see server-authoritative status after refresh; no stale client-only roster is trusted. |
| QUEST-019 | Test desktop, tablet, and phone roster editing. | Search, rows, remove buttons, status pills, and confirm button remain reachable without clipped horizontal content. |
| QUEST-020 | Verify mobile quest-detail navigation. | Hamburger remains available; bottom navigation does not disappear in a way that traps the user. |

### 5.7 Private coordination, group chat, and message synchronization

| ID | Setup and action | Expected result |
| --- | --- | --- |
| CHAT-001 | Open `/messages` with direct chats. | Conversation list loads once, previews are readable, and latest timestamps sort correctly. |
| CHAT-002 | Open a direct chat and send a message. | Message appears once, input clears, optimistic state reconciles with server response, and the conversation preview updates. |
| CHAT-003 | Receive a direct message in another browser/persona. | Active chat updates within the polling/sync interval without a full history download. |
| CHAT-004 | Inspect message requests after initial load and after new messages. | Initial page may receive a snapshot; later requests use cursor/delta (`after`) and do not repeatedly download the entire history. |
| CHAT-005 | Send duplicate client request IDs or double-click Send. | One message is persisted/displayed; duplicate submission is idempotently handled. |
| CHAT-006 | Use a stale message cursor. | Client requests a safe snapshot/rebase and does not lose the conversation. |
| CHAT-007 | Use a cursor belonging to another conversation. | Server rejects it; no cross-conversation messages are returned. |
| CHAT-008 | Send empty, whitespace, over-limit, and blocked-user messages. | Validation/blocked state prevents sending; draft/error behavior is clear. |
| CHAT-009 | Open a quest channel with both private and group messages. | Conversation-list preview is the newest message across both scopes, not merely the newest private message. |
| CHAT-010 | Add a newer group message than the private message, then reverse the order. | Preview and sort order follow the newest `createdAt`, with deterministic tie handling. |
| CHAT-011 | Open a quest channel header name/photo. | Quest detail opens; private/group selector is in the intended header position. |
| CHAT-012 | Switch Private ↔ Group. | Correct thread appears; selector state and permissions are accurate; no duplicate messages. |
| CHAT-013 | Send a group message as organizer and participant. | All active members see it; non-members cannot read/send. |
| CHAT-014 | Receive a group message. | Chat list row unread count increments; opening group chat clears the appropriate unread state. |
| CHAT-015 | Verify group messages do not become generic Notifications-tab items. | Group unread is represented in chat/group context, not an unrelated notification list. |
| CHAT-016 | Open participant profile from quest detail and from direct chat. | Both use consistent profile information and privacy rules. |
| CHAT-017 | Block a direct contact. | Sending is disabled/rejected; history remains as designed; unblock restores permitted behavior. |
| CHAT-018 | Leave a group chat. | Member leaves once; chat access and list behavior match the product contract; other members retain history. |
| CHAT-019 | Delete a direct/group chat for self. | Local view removes it without deleting other members’ history. |
| CHAT-020 | Fail chat list, message snapshot, delta, and send endpoints. | UI shows compact actionable errors, retains safe draft state, and never displays raw server/stack details. |
| CHAT-021 | Monitor `/api/v1/activities` while `/messages` is open. | Shared activity polling is not duplicated by ChatCenter; message polling remains scoped to the selected conversation. |
| CHAT-022 | Switch conversations while a message request is in flight. | Response cannot overwrite the newly selected conversation. |
| CHAT-023 | Refresh while group chat has new messages. | Latest message and unread state reconcile without duplicated rows. |
| CHAT-024 | Test chat at 360/390/412 widths with a long message and long group title. | Header, message bubbles, input, send button, tabs, and bottom navigation remain usable. |

### 5.8 Availability picker and time validation

| ID | Setup and action | Expected result |
| --- | --- | --- |
| AVAIL-001 | Open specific-time availability in desktop and phone layouts. | Layout matches the current reference: clear calendar/time fields, aligned From/To, add-time action, and confirm action. |
| AVAIL-002 | Open weekly-pattern availability. | Selector remains visually consistent with specific times; icon style and location do not jump. |
| AVAIL-003 | Switch Specific times ↔ Weekly pattern repeatedly. | Selected mode, labels, icon, spacing, and values remain consistent; no stale controls remain. |
| AVAIL-004 | Change start time with a valid existing duration. | End time moves by the same duration. |
| AVAIL-005 | Change start time so end would cross midnight or date boundary. | Behavior follows the timezone/date rules and does not create an invalid or silently earlier end. |
| AVAIL-006 | Set end equal to start. | Inline validation blocks confirmation with “end must be after start” semantics. |
| AVAIL-007 | Set end before start. | Confirmation is disabled/rejected; error is actionable and field-associated. |
| AVAIL-008 | Set invalid date, empty date, malformed time, and unsupported browser values. | Client and server validation agree; no invalid availability is persisted. |
| AVAIL-009 | Add multiple time blocks, duplicate a block, remove a block, and leave one block. | Blocks remain distinct, duplicates are rejected or normalized, and at least one valid block is required. |
| AVAIL-010 | Use weekly days with no selected day. | Confirmation is blocked. |
| AVAIL-011 | Use optional weekly date range with end before start. | Validation blocks the range. |
| AVAIL-012 | Submit availability twice or refresh after submit. | One authoritative availability update exists; UI reflects server state. |
| AVAIL-013 | Test time zone conversion using Asia/Singapore and a different browser locale. | Stored instants and displayed local labels are consistent; no one-hour/date drift. |
| AVAIL-014 | Interrupt availability request. | Form retains safe values and offers retry; private explanation text is not redundantly rendered. |
| AVAIL-015 | Test picker at 390px with keyboard and touch. | No horizontal overflow; date/time controls are reachable and not hidden behind the fixed composer/navigation. |

### 5.9 Arrangement, confirmation, and lifecycle

| ID | Setup and action | Expected result |
| --- | --- | --- |
| ARR-001 | Organizer opens a coordination-ready quest. | Arrangement section appears only when the state allows it. |
| ARR-002 | Suggest best compatible arrangement with all participants’ confirmed availability. | Earliest valid overlap and venue requirement are calculated deterministically. |
| ARR-003 | Suggest with no overlap. | No invalid plan is created; UI explains that participants need compatible availability. |
| ARR-004 | Enter an alternative start/end/venue. | Server validates end > start, public venue, participant constraints, and memory-backed needs/contributions. |
| ARR-005 | Enter a private home address or unsafe venue text. | Validation/privacy guard rejects or sanitizes it; no private address is published. |
| ARR-006 | Organizer proposes an arrangement. | Participants see proposed state; organizer sees approval actions only. |
| ARR-007 | Organizer approves. | State becomes participant-confirmation-required; all accepted members are prompted. |
| ARR-008 | Participant confirms. | Their confirmation is recorded once and correct remaining count is shown. |
| ARR-009 | Participant rejects/adjusts. | Arrangement returns to an actionable coordination state; prior history is retained. |
| ARR-010 | Refresh after each arrangement transition. | State, venue, schedule, and action permissions come from server state. |
| ARR-011 | Use stale revision or duplicate idempotency key on each arrangement command. | Conflict/replay is safe and does not create duplicate arrangements. |
| ARR-012 | Test organizer-only actions as participant and outsider. | API denies them; UI does not expose actionable controls. |
| ARR-013 | Finalize schedule with all confirmations. | Quest moves to `scheduled`; date/time appears consistently in detail, My Activities, chat header/context, and notifications. |
| ARR-014 | Start scheduled quest. | Only organizer/authorized state can start; lifecycle becomes in progress. |
| ARR-015 | Complete in-progress quest. | Quest moves to completed and appears in Completed My Activities; tasks/rewards remain linked. |
| ARR-016 | Cancel forming, coordinating, scheduled, and in-progress quest where allowed. | Lifecycle and membership history are correct; canceled quest is not actionable as active. |
| ARR-017 | Reopen/edit a permitted quest. | Group/arrangement workflow returns to the correct stage without losing history. |
| ARR-018 | Fail arrangement API or venue check. | Compact retry/error UI; no half-saved schedule displayed as final. |

### 5.10 Roles, tasks, human review, and rewards

| ID | Setup and action | Expected result |
| --- | --- | --- |
| TASK-001 | Reach scheduled state with all participants. | Role/task plan appears only at the intended lifecycle stage. |
| TASK-002 | Generate a task plan with multiple participants. | Every role is represented; task assignment, reviewer, contribution, and point value are valid. |
| TASK-003 | Generate a plan with missing/unsafe/invalid model output. | Deterministic fallback or failed plan is persisted; invalid tasks cannot silently award points. |
| TASK-004 | Task-plan generation times out. | UI explains failure and exposes retry without duplicating plans. |
| TASK-005 | Retry a failed task plan. | Retry is idempotent and old abandoned pending state is resolved. |
| TASK-006 | A participant acknowledges a role. | Role status changes for that participant only. |
| TASK-007 | A participant raises a role concern. | Concern appears to organizer/reviewer according to visibility rules; task does not falsely appear approved. |
| TASK-008 | Complete a task before role approval. | Action is blocked. |
| TASK-009 | Mark assigned task done. | Button is in the intended right-side position, task status/count updates once, and confirmation is clear. |
| TASK-010 | Try to mark another member’s task done. | Server denies unauthorized action. |
| TASK-011 | Reviewer approves a valid task. | Approved task creates exactly one reward ledger entry. |
| TASK-012 | Reviewer rejects a task. | No points are awarded; retry/reassignment behavior follows the state. |
| TASK-013 | Reverse/reopen an approved task. | Reward reversal is append-only, balance is corrected, and history explains the change. |
| TASK-014 | Request task reassignment. | Request contains valid task/requester/replacement and respects organizer/reviewer permissions. |
| TASK-015 | Approve/reject reassignment twice. | One terminal decision persists; duplicate commands are safe. |
| TASK-016 | Complete the same task or replay the same award command twice. | Points are not double-counted. |
| TASK-017 | Open Rewards after approved tasks. | Balance and history match the reward ledger; pending/rejected tasks are excluded. |
| TASK-018 | Open each partner/deal tile. | Correct unique offer detail route opens with logo/hero/offer/eligibility/how-it-works content. |
| TASK-019 | Open partner preview form. | `/partners` is clearly preview-only; submission does not pretend to contact or persist a real company. |
| TASK-020 | Test Rewards with no points, one award, multiple awards, reversal, and zero-value history. | Empty and populated states are readable and totals are correct. |
| TASK-021 | Test rewards pages at phone widths. | Deal details, image, CTA, and back link do not overflow; hamburger exposes Rewards. |
| TASK-022 | Fail rewards API. | Compact retry state; no stale balance is presented as fresh without indication. |
| TASK-023 | Open Rewards with no usable codes at desktop and phone widths. | The usable-code empty state and partner-deals section have clear separation; section headings use direct semantic children without a redundant nested heading wrapper. |

### 5.11 Profile, settings, privacy, and safety

| ID | Setup and action | Expected result |
| --- | --- | --- |
| PROFILE-001 | Open own Profile. | Correct name, username, photo, preferences shortcuts, and badges/toast behavior appear. |
| PROFILE-002 | Edit profile fields and save. | Server response is authoritative after refresh; validation is field-specific. |
| PROFILE-003 | Replace/remove avatar and refresh. | Image storage/URL updates; old image is not incorrectly displayed from cache. |
| PROFILE-004 | Edit interests, group size, activity level, language, accessibility, and privacy preferences. | Values persist and affect future visibility/matching rules. |
| PROFILE-005 | Add/edit/remove emergency contact. | Authorized own profile shows it; unauthorized APIs do not expose it. |
| PROFILE-006 | Set profile visibility private/restricted/community. | Contact discovery and profile access follow the selected privacy. |
| PROFILE-007 | Set message privacy to restricted/contacts/everyone. | Direct chat search/create/send behavior follows the preference. |
| PROFILE-008 | Block and unblock a member. | Blocked member cannot message/contact as defined; unblock restores access without losing history. |
| PROFILE-009 | Change password with wrong current password, weak new password, mismatch, and valid new password. | Invalid changes are rejected; valid change invalidates or preserves sessions according to Better Auth policy. |
| PROFILE-010 | Enable/disable notification preferences. | UI state persists and server notification creation/delivery respects it where implemented. |
| PROFILE-011 | Use high contrast and large text. | Every tested page remains usable and focus/contrast requirements hold. |
| PROFILE-012 | Attempt profile/account updates as another user through API ID substitution. | Acting user is taken from session; IDOR is blocked. |

### 5.12 API contract and security tests

Run these against a disposable local environment with two authenticated sessions and one unauthenticated client. Use the API reference for exact status/schema expectations.

| ID | Request/test | Expected result |
| --- | --- | --- |
| API-001 | Call every authenticated endpoint without cookies. | 401/redirect-safe response; no private data. |
| API-002 | Call another user’s memory/profile/conversation/quest with guessed IDs. | 403/404 safe response; no existence-sensitive detail beyond contract. |
| API-003 | Change `userId`, `actorId`, `candidateId`, or `initiatorId` in mutation bodies. | Session actor remains authoritative; forged identity is ignored/rejected. |
| API-004 | Replay event mutation with stale `expectedRevision`. | Conflict response; state is unchanged. |
| API-005 | Replay event mutation with the same idempotency key. | Same logical result, no duplicate invitation/membership/arrangement/task/reward. |
| API-006 | Send malformed JSON, missing fields, invalid enum, negative number, oversized string, and extra fields. | Schema validation returns safe structured error; no partial state. |
| API-007 | Send SQL injection, HTML/script, CRLF, path traversal, and oversized SVG payloads. | Input is rejected/sanitized; no execution, header injection, or filesystem access. |
| API-008 | Request image/avatar with path traversal or unknown key. | Safe 404/400; no file path or server stack disclosure. |
| API-009 | Send a chat cursor for another conversation. | 400 invalid cursor; no data leakage. |
| API-010 | Send a stale cursor after deleting/replacing history. | Safe snapshot/reset behavior. |
| API-011 | Read another participant’s profile outside a shared authorized quest/chat. | Denied. |
| API-012 | Read a participant profile inside authorized quest. | Only fields allowed by the profile contract are returned. |
| API-013 | Mark notifications read with no run ID, another run ID, and group-message flag. | Only the signed-in user’s allowed notifications are changed; group behavior matches the contract. |
| API-014 | Call legacy quest event endpoint. | Intentional `410 Gone` response, not an accidental server error. |
| API-015 | Call rewards/activities with malformed query limits. | Defaults/validation are bounded and safe. |
| API-016 | Concurrently submit roster, arrangement, task, and reward mutations. | Optimistic locking/transactions preserve a valid aggregate and audit history. |
| API-017 | Inspect provider request payloads with a test spy. | No passwords, phone/email, emergency contacts, precise private addresses, or unnecessary user IDs. |
| API-018 | Inspect provider output normalization. | Unknown references, unsafe venues, invalid task points, and malformed SVG are rejected or safely normalized. |
| API-019 | Check error responses from database/provider failures. | User receives safe message; logs contain diagnostic event/context but not secrets or raw private text. |
| API-020 | Verify CORS/host/cookie behavior from an untrusted origin where applicable. | Session and mutation protections match deployment policy. |

### 5.13 Persistence and adapter parity

| ID | Setup and action | Expected result |
| --- | --- | --- |
| DATA-001 | Run core tests with in-memory adapters. | Domain behavior passes quickly and deterministically. |
| DATA-002 | Run PostgreSQL integration tests after migration. | Data survives repository/service restart and matches in-memory contract. |
| DATA-003 | Create memory, vector, quest, invitation, message, task, reward, and notification data. | All records persist in their intended schema and survive a new service instance. |
| DATA-004 | Run migration twice. | Migration runner is idempotent and does not corrupt schema. |
| DATA-005 | Start from a clean database and run seed script twice. | First run creates/reuses fixtures; second run does not duplicate auth/profile/memory records. |
| DATA-006 | Fail image storage after quest creation. | Quest remains persisted; image is placeholder/retryable and not a transaction-wide failure. |
| DATA-007 | Fail vector indexing during memory update. | Previous active memory remains authoritative; failed version is visible in diagnostics, not active. |
| DATA-008 | Restart the app during a pending workflow. | Replay/reconciliation yields truthful state; no duplicate terminal quest. |
| DATA-009 | Compare in-memory and PostgreSQL responses for the same lifecycle fixture. | Safe viewer projections, permissions, counts, history, and rewards are behaviorally equivalent. |
| DATA-010 | Inspect audit/outbox/reward entries after every event mutation. | One auditable entry per command; no secrets or raw provider payloads in public projections. |

### 5.14 Failure recovery, observability, and performance

| ID | Fault/action | Expected result |
| --- | --- | --- |
| RES-001 | Abort `/api/v1/activities` after data was loaded. | Existing activities stay visible; compact retry banner appears; no raw `NetworkError` text. |
| RES-002 | Abort initial activities request. | Clear retry state; no fake/demo records. |
| RES-003 | Abort chat list request. | Conversation area has actionable retry and no broken empty-state confusion. |
| RES-004 | Abort chat snapshot/delta request. | Existing messages remain; next poll can recover; no duplicate history. |
| RES-005 | Abort message send. | Draft returns to the composer, no false sent bubble remains, and retry is possible. |
| RES-006 | Abort assistant turn/SSE stream. | Persisted state is replayable; error tells user whether retry is safe. |
| RES-007 | Return Gemini 429, timeout, malformed output, and safety rejection. | Correct user-facing copy and retry policy; no infinite rapid retry loop. |
| RES-008 | Kill/restart database during a read and mutation. | Safe error response; server recovers after database returns. |
| RES-009 | Open a stale page after another user changes the quest. | Refresh/conflict path is clear; stale browser cannot overwrite newer state. |
| RES-010 | Inspect logs during all above failures. | JSON logs include time, level, service, event, safe IDs/status context, and no passwords/provider keys/full user text. |
| RES-011 | Run Messages with many conversations and long history. | Initial request remains bounded; selected chat uses deltas; typing/scrolling remains responsive. |
| RES-012 | Run activity polling with multiple open tabs. | No request storm; visibility/focus behavior is bounded and no duplicate poller is introduced. |
| RES-013 | Use browser offline mode, then reconnect. | UI retains safe local input, retries when appropriate, and reconciles server state without duplication. |
| RES-014 | Capture console and network errors in every smoke flow. | No unexpected unhandled rejection, hydration mismatch, 404 asset, or repeated failed request. |
| RES-015 | Check image sizes and loading behavior on quest/reward pages. | No broken asset/placeholder mismatch between organizer and participant views; responsive images remain bounded. |
| RES-016 | Delay chat A's snapshot, then select chat B before A finishes. | Chat B starts loading immediately and renders independently; A cannot block or overwrite B. |
| RES-017 | Switch away from a loaded chat and return. | Cached messages render immediately, then reconcile from the saved delta cursor without duplicate history. |
| RES-018 | Send a direct/group message while the database response is delayed or fails. | A sending state appears immediately; success replaces it exactly once, while failure removes it and restores the draft without overwriting newer typing. |
| RES-019 | Keep Messages visible for at least 30 seconds and inspect network traffic. | Conversation/activity projections refresh at a bounded interval, selected messages use small delta requests, hidden tabs stop polling, and no overlapping request storm occurs. |
| RES-020 | Send from a second signed-in browser while the recipient keeps the conversation open. | The recipient receives the message within one active polling interval without re-downloading full history. |
| RES-021 | Call `/health` repeatedly and concurrently. | Expensive database/vector diagnostics are coalesced and cached; probes remain truthful without creating an N+1 embedding workload. |
| RES-022 | Load activities with many related/recruiting quests. | Quest images and coordination membership are read in bounded batch/indexed queries rather than one query per activity or JSON scans. |

## 6. Mandatory end-to-end lifecycle smoke flows

These flows should run against PostgreSQL at least once before a release. Use separate browser contexts for each persona so cookies and local read markers do not leak.

### FLOW-001: create, review, consent, and organize

1. Login as `sqtest.garden.host`.
2. Start Senior Quest from Messages.
3. Enter a walking/gardening need, contribution, availability, group size, accessibility, distance, language, and invitation consent.
4. Confirm the review brief and verify current request—not stale prior goals—drives the proposal.
5. Verify thumbnail generation or safe placeholder/fallback.
6. Open the quest detail and inspect hero, participants, resolved names, avatars, and profile dialogs.
7. Edit roster: search, add, remove, and confirm once.
8. Verify organizer sent invitations and no premature recipient suggestion/invitation exists.
9. Inspect Suggested, Invited, Notifications, and My Activities badges/read behavior.

Pass criteria: one quest run, one authoritative roster, one invitation set, correct access projection, no duplicate UI, and no raw IDs/errors.

### FLOW-002: invitation and participant coordination

1. In a separate browser context, login as `sqtest.garden.walk`.
2. Open Invited and verify the new invitation badge.
3. Open invitation detail, profile/participant information, and accept.
4. Verify the acceptance toast and My Activities placement.
5. Open the quest channel; verify group/private selector, header quest link, latest preview, and group unread badge.
6. Share private availability and confirm the requirements.
7. As organizer, observe the participant’s progress and suggest an arrangement.

Pass criteria: accepting does not falsely schedule the event; participant can coordinate only after joining; private/group data stays in the correct scope.

### FLOW-003: arrangement, confirmation, tasks, and points

1. Ensure every accepted participant has a compatible confirmed availability.
2. Organizer suggests a plan, reviews it, and approves it.
3. Each participant confirms or rejects in separate contexts.
4. Verify final scheduled state in detail, chat, and My Activities.
5. Start and complete the activity as organizer.
6. Acknowledge roles and complete assigned tasks.
7. Review/approve tasks as the authorized reviewer.
8. Open Rewards and verify exactly one point award per approved task.
9. Reverse/reopen one task and verify append-only reward correction.

Pass criteria: no task is awarded before approval, no duplicate points are possible, and completed activity/history remains visible.

### FLOW-004: open recruitment and replacement

1. Organizer creates/reopens a recruiting quest with an undersized roster.
2. Verify eligible candidates can discover/request to join and hard-ineligible candidates cannot.
3. Approve one join request and send/confirm the invitation.
4. Replace a pending/accepted user with `sqtest.reserve.cook` or `sqtest.reserve.tech`.
5. Reuse the same user in a replacement edge case.
6. Verify current status is derived from latest membership/invitation history and old replacement history is preserved.
7. Confirm final roster and verify all role/task projections update.

Pass criteria: eligibility, consent, replacement, and history rules remain server-authoritative; no user sees an activity before the organizer sends the invitation unless recruitment makes it intentionally discoverable.

### FLOW-005: chat reliability and network budget

1. Open `/messages` in two contexts with one direct or quest chat selected.
2. Record initial conversation-list, activity-feed, and message requests.
3. Send a message from context A.
4. Verify context B receives it within the documented interval.
5. Record follow-up requests and confirm the app uses deltas/cursors instead of full history.
6. Add messages to both private and group quest scopes and verify conversation preview chooses the newest message.
7. Throttle/offline the network during send and reconnect.

Pass criteria: no request storm, no duplicate messages, no lost draft, no stale preview after reconciliation, and no unhandled console errors.

## 7. Accessibility acceptance checklist

Run this checklist on Login, Messages, Activities, My Activities, Quest Detail, Availability, Rewards, Profile, Settings, and the mobile menu:

- every form control has a visible or programmatic label;
- buttons describe their action, including icon-only controls;
- error text uses `role="alert"` or an equivalent live region without duplicating announcements;
- loading states use `role="status"` where appropriate;
- dialogs have `role="dialog"`, modal labeling, close behavior, and sensible focus management;
- active tabs expose `role="tab"` and `aria-selected` correctly;
- links and buttons are distinguishable and have visible focus;
- color is not the only signal for unread, error, status, or selected state;
- contrast remains acceptable in standard and high-contrast settings;
- text scales without clipping at the supported large-text setting;
- touch targets are comfortably reachable on phone widths;
- images have useful alt text or intentionally empty alt text when decorative;
- no announcement exposes a password, emergency contact, private chat text, or internal ID.

## 8. Visual regression checklist

Take reference screenshots for each changed surface at 390×844 and 1440×900. Compare:

- Login/register and validation;
- mobile hamburger closed/open with My Activities badge;
- Activities with empty, suggested, invited, and notification states;
- My Activities with total parentheses, unread red subcategory badges, error banner, and cards;
- quest detail as organizer, pending invitee, and participant;
- human-review detail;
- private/group quest chat, long messages, latest preview, and composer;
- availability specific-time and weekly-pattern states;
- arrangement proposal/confirmation and scheduled state;
- task board and Rewards/deal details;
- profile dialog and settings error/success states.

Every screenshot review must check alignment, spacing, text wrapping, badge placement, icon consistency, image loading, fixed navigation clearance, and page-level overflow.

## 9. Release sign-off

Do not mark the change ready until all applicable items are true:

- [ ] Focused unit/API tests added or updated.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` has no new errors or unexplained warnings.
- [ ] `npm test` passes, with any pre-existing exception documented.
- [ ] `npm run build` passes.
- [ ] PostgreSQL integration coverage passes when persistence/state changed.
- [ ] Organizer and participant flows both pass.
- [ ] Unauthorized/outside-user checks pass.
- [ ] Desktop and phone browser checks pass.
- [ ] No page-level horizontal overflow.
- [ ] Keyboard/focus/error/empty/loading states were checked.
- [ ] Network budget was checked for chat/activity polling changes.
- [ ] Logs were checked for safe, useful diagnostics.
- [ ] No secrets, real personal data, production rows, or generated build artifacts were committed.
- [ ] Changed route/API/docs ownership is updated.

## 10. Bug report template

```md
### [TEST-ID] Short title

- Commit:
- Environment: memory / PostgreSQL
- Provider: deterministic / Gemini / OpenAI
- Browser and viewport:
- Persona and quest/run IDs:
- Preconditions/data setup:
- Steps:
  1.
  2.
  3.
- Expected:
- Actual:
- Network requests/statuses:
- Console/server log evidence:
- Screenshot/video:
- Reproducibility: always / intermittent / once
- Severity: blocker / critical / major / minor / cosmetic
```

## 11. Ownership map

When a case fails, start at the smallest owner:

- shell/navigation/badges: `src/components/app-shell.tsx`, `src/components/activity-badge-context.tsx`, `src/components/mobile-more-menu.tsx`;
- Activities/My Activities: `src/components/activities-page.tsx`, `src/components/my-quests-page.tsx`, `src/features/events/activity-badges.ts`;
- quest detail/roster: `src/components/event-quest-detail.tsx`, `src/server/features/event-coordinator.ts`;
- coordination/chat: `src/components/event-coordination-conversation.tsx`, `src/components/chat-center.tsx`, `src/server/chat/message-sync.ts`;
- assistant/proposals: `src/components/assistant-conversation.tsx`, `src/server/features/assistant-conversation-service.ts`, `src/server/core/kampung-quest-engine.ts`;
- thumbnails/providers: `src/server/agents/quest-image-agent.ts`, `src/server/agents/retrying-quest-image-agent.ts`, `src/server/agents/gemini-svg-thumbnail-agent.ts`;
- tasks/rewards: `src/components/event-task-board.tsx`, `src/server/domain/event-tasks.ts`, `src/server/features/reward-service.ts`;
- persistence/security: the relevant API route, feature service, both repositories/stores, and the migration/integration test.

Never fix an authoritative-state test only in React state. Trace the browser request through the API, service, domain validation, repository, and database projection, then add regression coverage at the narrowest reusable boundary.
