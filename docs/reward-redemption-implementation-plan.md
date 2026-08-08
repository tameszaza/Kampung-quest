# Reward redemption implementation plan

## 1. Goal

Turn the existing reward previews into a real, durable redemption system.

A signed-in member must be able to:

1. see an authoritative available-points balance;
2. see whether each offer is redeemable, unavailable, ended, or requires more points;
3. review an offer and confirm one redemption;
4. spend points exactly once and receive exactly one reward code;
5. find all currently usable codes in one place after leaving or refreshing the page; and
6. see both earnings and redemptions in Points history, with earnings such as `+20` and redemptions such as `−250`.

The system must remain correct when a member double-clicks Redeem, retries after a timeout, uses two browser tabs, or competes for the last available code.

This plan is based on the current rewards page, reward detail page, `reward-service.ts`, `/api/v1/rewards`, event-task point ledger, `KampungStore` adapters, PostgreSQL persistence, and Vitest suite.

## 2. Product decisions used by this plan

These decisions remove ambiguity for the first implementation. Change them explicitly before coding if the business wants different behaviour.

1. A redemption spends points and issues one unique, single-use partner code.
2. Partner-provided codes are stocked in advance. The application must not invent a production code when inventory is empty.
3. An issued code is a bearer secret. Do not put the full code in logs, analytics, URLs, Points history, list-page HTML, or error reports.
4. The member sees the full code only on the redemption-success/detail view after an ownership check. The usable-code list shows a masked code and a **View code** action.
5. The first release does not let members mark their own code as used. Only a later authenticated partner/admin verification flow may do that. Without that integration, show “Issued · valid until …”, not the unverifiable claim “Unused”.
6. Codes cannot be returned merely because the member changed their mind after issuance. An administrator may cancel and refund only when the partner confirms the code has been invalidated.
7. Each offer defines `max_redemptions_per_user`; seed the current offers with `1` unless product explicitly chooses another value.
8. Offer price, availability, dates, stock, and redemption limit come from the server. Never trust a cost, balance, status, or code sent by the browser.
9. A member may redeem when `available balance >= offer cost`. Exactly enough points is valid. A redemption must never make the balance negative.
10. A code expires at the earlier of the offer expiry and the individual code expiry.
11. Singapore is the current display timezone, but timestamps are stored as `timestamptz` and validity comparisons happen on the server.
12. A redemption is complete only when the account debit, ledger row, redemption row, and code claim all commit in one transaction.

## 3. Current-state findings

The junior should understand these constraints before changing code.

- `src/server/features/reward-service.ts` currently owns a static six-offer catalog and builds a read-only summary.
- `src/app/api/v1/rewards/route.ts` exposes only `GET`.
- `src/components/rewards-page.tsx` labels offers as previews and has no usable-code section.
- `src/components/reward-offer-detail-page.tsx` has a disabled “Redeem when available” button.
- Approved event tasks are stored in `rewards.point_ledger` as `task_award`; reversals are signed negative entries.
- Legacy completed-event points are calculated at read time and are not durable ledger rows.
- A task-ledger row currently requires both `run_id` and `task_id`, so the table cannot represent a redemption debit.
- The current balance is recomputed in TypeScript from earnings. There is no row to lock when two redemption requests arrive together.
- The PostgreSQL event-state save already wraps state, task rows, and ledger inserts in a transaction. Preserve that atomicity when adding reward accounts.
- `errorResponse` currently derives HTTP status from message text. Redemption needs stable machine-readable domain error codes instead.

Do not implement redemption by subtracting points in React or by appending a row after returning success. Both approaches permit overspending and lost codes.

## 4. Domain language and lifecycle

Use these names consistently in schema, TypeScript, UI copy, and tests.

- **Offer**: the redeemable partner product and its current rules.
- **Reward account**: the member's authoritative current balance and lifetime earned points.
- **Point entry**: one immutable credit or debit in the point ledger.
- **Inventory code**: a protected partner code not yet assigned, or assigned exactly once.
- **Redemption**: the durable exchange of points for one inventory code.
- **Usable reward**: a member-owned redemption with status `issued` whose effective expiry is still in the future.

Redemption lifecycle:

```text
issued -> used
issued -> expired       (derived when the effective expiry passes)
issued -> cancelled     (admin only, after partner invalidation; refund in the same transaction)
```

Do not add `pending` unless code delivery is actually asynchronous. In this design, issuance is synchronous and transactional; a failed transaction creates no redemption.

## 5. UX and UI plan

### 5.1 Information architecture

Keep one primary purpose per section of `/rewards`, in this order:

1. **Points balance** — available balance and a short explanation.
2. **Your usable rewards** — issued, unexpired codes owned by the member. Hide this section only if the chosen empty-state design is covered near the catalog; otherwise show a compact empty state.
3. **Deals for your points** — the offer catalog.
4. **Points history** — one chronological list of earnings, redemptions, reversals, and refunds.

This avoids three competing redemption actions:

- Catalog cards explain availability and link to details.
- The detail page owns the only **Redeem** action.
- The usable-reward list owns **View code**, not another Redeem action.

### 5.2 Catalog cards

Keep the existing visual card, but replace preview language with a concise state.

| State | Card treatment | Accessible text |
| --- | --- | --- |
| Affordable | normal card, “Available” status | “You have enough points” |
| Insufficient | show “Need N more points”; do not hide the card | “You need N more points” |
| Out of stock | show “Currently unavailable” | “No reward codes are currently available” |
| Upcoming | show start date | “Available from …” |
| Ended/paused | muted status | exact reason, not colour alone |
| User limit reached | show “Already redeemed” | “You have reached this offer's redemption limit” |

Keep **More details** as the card action. Do not put a second Redeem button on every card.

### 5.3 Offer detail and confirmation

The detail page must load member-specific eligibility rather than importing a static offer and guessing from client state.

Near the fixed footer, show:

- current points;
- cost;
- points remaining after redemption when eligible;
- one precise button label, for example **Redeem for 250 points**; and
- a disabled reason such as **Need 30 more points**, **Currently unavailable**, or **Already redeemed**.

Clicking Redeem opens a confirmation dialog. It must say what will happen, not merely “Are you sure?”

Example:

> Spend 250 points on Free Drink or Snack Set? You will have 20 points left. Your code cannot be returned after it is issued.

Actions are **Cancel** and **Confirm redemption**. Focus starts on the dialog heading, remains trapped inside the dialog, and returns to the original button when closed.

Disable the confirm button while the request is in flight. Do not create a new idempotency key while retrying the same user intent.

### 5.4 Redemption success

After a successful response, update the balance and history from the returned server view. Show a success view containing:

- offer title and partner;
- the full, clearly formatted code;
- **Copy code** with a visible copied/error state;
- effective expiry;
- participating locations and essential terms;
- “Show this code to …” guidance; and
- **View all my rewards**.

Do not display a successful state until the server has committed. If the browser times out after the server commits, the retry with the same idempotency key must return the same redemption and same code.

### 5.5 Usable-code list

Add `UsableRewardList` to the rewards page. Each row/card contains:

- partner and reward title;
- masked code, for example `•••• 7KQ9`;
- “Issued” plus the effective expiry date;
- **View code**; and
- a warning when expiry is close.

Sort by effective expiry ascending, then redeemed time descending, so the code that should be used first appears first.

Only `issued` and unexpired redemptions belong here. Put used, expired, and cancelled items in a separate collapsed **Past rewards** view later; never mix them into the usable list.

### 5.6 Points history

Replace the earnings-only DTO with a unified history DTO.

Examples:

| Event | Primary text | Secondary text | Value |
| --- | --- | --- | ---: |
| Task approved | event and task title | “Medium task approved” | green `+20` |
| Reward redeemed | reward and partner | “Points spent · code issued” | red `−250` |
| Award reversed | original task | “Points adjustment” | red `−20` |
| Redemption refunded | reward and partner | “Reward cancelled and points returned” | green `+250` |

Use both sign/text and colour. Add a class such as `.reward-history-value--debit` for the red value; do not rely on `:nth-child` or a negative-number selector. Use the real Unicode minus sign (`−`) in visible text, while the JSON value remains a negative number.

Do not show the full reward code in history. The history row links to the owned redemption detail. This keeps the history useful without duplicating a bearer secret.

### 5.7 Error and accessibility behaviour

- Insufficient points: keep the dialog/page open, refresh the current balance, and show the exact shortage.
- Last code claimed by someone else: show “This reward just became unavailable. Your points were not spent.”
- Offer changed/ended: refresh offer state; do not retry automatically with a different cost.
- Network/unknown outcome: offer **Try again** using the same idempotency key.
- Authentication expired: send the member through the existing sign-in continuation.
- Use `role="status"` for success/progress and `role="alert"` for blocking errors.
- Make code text and actions large enough for the project's senior audience; test keyboard navigation and 200% zoom.
- Never communicate affordability, debit, or status by colour alone.

## 6. Relational data model

Add `db/migrations/015_reward_redemptions.sql`. Keep the migration additive first; backfill before switching reads.

```text
identity.users 1 ── 1 rewards.accounts
identity.users 1 ── * rewards.redemptions * ── 1 rewards.offers
rewards.offers 1 ── * rewards.offer_codes 1 ── 0..1 rewards.redemptions
rewards.accounts 1 ── * rewards.point_ledger * ── 0..1 rewards.redemptions
                                                    └── 0..1 quest.event_tasks
```

### 6.1 `rewards.accounts`

Recommended columns:

```sql
user_id text primary key references identity.users(user_id) on delete restrict,
balance integer not null default 0,
lifetime_points integer not null default 0,
version integer not null default 1,
created_at timestamptz not null,
updated_at timestamptz not null
```

Rules:

- `balance` is the lockable, authoritative current balance.
- `lifetime_points` changes for real earnings and earning reversals. Redemption debits and refunds do not change it.
- Administrative reversals may make a balance negative if already-spent earnings must be corrected; ordinary redemptions never may. If product rejects negative adjustment balances, define an admin debt policy before changing this rule.
- Add a reconciliation test/job that compares the account fields with ledger sums. The account and ledger must always be updated in the same transaction.

### 6.2 `rewards.offers`

Recommended columns:

```sql
offer_id text primary key,
company text not null,
title text not null,
description text not null,
category text not null,
value_text text not null,
points_cost integer not null check (points_cost > 0),
status text not null check (status in ('draft','active','paused','retired')),
starts_at timestamptz,
ends_at timestamptz not null,
max_redemptions_per_user integer not null check (max_redemptions_per_user > 0),
locations text not null,
terms text not null,
presentation jsonb not null,
created_at timestamptz not null,
updated_at timestamptz not null
```

Move the six current offers into seed data. `presentation` may hold tone, initials, image paths, partner description, and redemption steps, but price/status/date/limit must be first-class validated columns.

Do not edit an old offer's identity to represent a materially new campaign. Retire it and create a new `offer_id`, which preserves redemption history.

### 6.3 `rewards.offer_codes`

Recommended columns:

```sql
code_id text primary key,
offer_id text not null references rewards.offers(offer_id) on delete restrict,
code_fingerprint text not null unique,
encrypted_code bytea not null,
encryption_key_version integer not null,
expires_at timestamptz,
status text not null check (status in ('available','issued','void')),
issued_redemption_id text unique,
created_at timestamptz not null,
updated_at timestamptz not null
```

Add the `issued_redemption_id` foreign key after `rewards.redemptions` exists, or omit it and let the unique `redemptions.code_id` relation be authoritative. Do not create two conflicting ownership fields without a constraint keeping them consistent.

Store codes encrypted with an application-held, versioned key; store a keyed fingerprint for import deduplication. Do not commit production codes or encryption keys. Local/test seeds may use obviously fake codes.

Required selection index:

```sql
(offer_id, status, expires_at, created_at)
```

### 6.4 `rewards.redemptions`

Recommended columns:

```sql
redemption_id text primary key,
user_id text not null references identity.users(user_id) on delete restrict,
offer_id text not null references rewards.offers(offer_id) on delete restrict,
code_id text not null unique references rewards.offer_codes(code_id) on delete restrict,
status text not null check (status in ('issued','used','cancelled')),
points_cost integer not null check (points_cost > 0),
offer_title_snapshot text not null,
company_snapshot text not null,
terms_snapshot text not null,
effective_expires_at timestamptz not null,
idempotency_key text not null,
request_fingerprint text not null,
redeemed_at timestamptz not null,
used_at timestamptz,
cancelled_at timestamptz,
updated_at timestamptz not null,
unique (user_id, idempotency_key)
```

Store snapshots so a later offer edit cannot rewrite what the member bought. Enforce the per-user limit transactionally; a supporting `(user_id, offer_id, status)` index is required. If all offers remain one-per-user, a partial unique index may enforce it; do not hard-code that constraint if configurable limits are real.

`expired` is best derived from `effective_expires_at <= now()` rather than requiring a perfectly timed background job. A cleanup job may materialize expiry later, but correctness must not depend on it.

### 6.5 Extend `rewards.point_ledger`

The existing table is task-specific. Make `run_id` and `task_id` nullable and add:

```sql
redemption_id text references rewards.redemptions(redemption_id) on delete restrict,
source_type text not null,
source_id text not null,
metadata jsonb not null default '{}'::jsonb
```

Extend `kind` to:

```text
activity_award | task_award | reversal | redemption_debit | redemption_refund
```

Keep `points` signed: awards/refunds positive, reversals/debits negative. Add constraints that match kind to sign and source. Add unique indexes for:

- one task award per task/member;
- one activity award per legacy event/member;
- one redemption debit per redemption;
- at most one refund per redemption; and
- one reversal per reversed entry when that is the intended policy.

Change cascade-delete relationships from quests/tasks into the financial ledger to `SET NULL` or `RESTRICT`, and rely on stored snapshots. Financial audit history must not disappear when an event record is cleaned up.

## 7. Point migration and compatibility

This is a prerequisite, not a follow-up cleanup.

1. Add the generalized ledger columns and accounts table.
2. Backfill `source_type/source_id` for existing task awards and reversals.
3. Create durable `activity_award` rows for completed legacy events that do not have an authoritative task plan. Reuse the exact current exclusion rule in `buildRewardSummaryWithTaskEntries` so an event is not paid twice.
4. Insert/update one account per user from the generalized ledger.
5. Verify, per user, that the new account balance and lifetime points equal the old rewards summary before enabling redemption.
6. Switch `GET /api/v1/rewards` to the new account/ledger reads.
7. Remove the old read-time `100 points × completed activities` calculation only after the comparison passes.

The backfill must be idempotent. Use stable source IDs and unique constraints so rerunning it cannot double-award points. Provide dry-run totals: users scanned, activities inserted, task entries mapped, mismatches, and final ledger sum.

When a future event task is approved or reversed, update the event state, point ledger, and reward account inside the existing PostgreSQL event-state transaction. Do not save the event and then call the reward module in a second transaction. In `persistEventCoordinationChildren`, only update an account when `INSERT ... ON CONFLICT DO NOTHING RETURNING ...` proves the point entry was newly inserted.

The in-memory adapter must perform the equivalent mutation atomically on cloned state so local development and tests do not silently use weaker rules.

## 8. Backend module design

Create one deep `RewardService` module. Its external interface should remain small:

```ts
interface RewardService {
  getRewards(userId: string, now?: Date): Promise<RewardView>;
  getOffer(userId: string, offerId: string, now?: Date): Promise<RewardOfferView>;
  redeem(input: {
    userId: string;
    offerId: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<RedemptionResult>;
}
```

Behind this interface, the implementation owns offer eligibility, effective expiry, per-user limits, account balance checks, code selection/decryption, ledger history projection, masking, and response redaction.

Use two storage adapters at the internal seam:

- PostgreSQL adapter for production;
- in-memory adapter for service tests and database-free development.

Do not expose low-level “subtract points”, “claim code”, or “insert redemption” methods to route handlers. A route must be unable to perform half a redemption.

Suggested files:

```text
src/server/domain/rewards.ts
src/server/features/reward-service.ts
src/server/repositories/reward-store.ts
src/server/repositories/postgres-reward-store.ts
src/server/repositories/in-memory-reward-store.ts
src/server/security/reward-code-crypto.ts
```

It is acceptable to colocate the small adapters with `KampungStore` if that matches the final implementation, but keep the external `RewardService` interface above as the route/test surface.

## 9. Atomic redemption algorithm

The PostgreSQL adapter must execute the following in one transaction and use one consistent lock order in every point mutation:

1. Begin transaction.
2. Look up `(user_id, idempotency_key)`.
   - If it exists with the same request fingerprint, return that existing redemption.
   - If it exists for a different offer/payload, return `IDEMPOTENCY_KEY_REUSED` and change nothing.
3. Ensure the reward-account row exists, then lock it with `SELECT ... FOR UPDATE`.
4. Load and lock/read the offer. Validate `active`, start/end dates, and positive server-side cost.
5. Count this member's qualifying redemptions for the offer and enforce `max_redemptions_per_user`.
6. Validate `account.balance >= offer.points_cost`.
7. Select one available, unexpired inventory row using `FOR UPDATE SKIP LOCKED`. If none exists, return `OFFER_OUT_OF_STOCK` and roll back.
8. Insert the redemption with price/title/company/terms snapshots and effective expiry.
9. Mark/relate the selected code as issued.
10. Insert one `redemption_debit` point-ledger row with `points = -offer.points_cost`.
11. Update the account with a conditional debit (`balance >= cost`) and increment its version. Treat no returned row as an insufficient-points conflict.
12. Commit.
13. Decrypt and return the member-owned code only after commit. If response delivery fails, idempotent retry returns the same row/code.

It is also valid to debit before inserting the related rows, but every failure must roll back all changes. Never commit the debit before the code claim.

Concurrency invariants:

- Two requests from one member cannot both spend the same balance.
- Two members cannot receive the same inventory code.
- The last code can produce one success only.
- Retrying one request cannot create a second debit or code.
- An out-of-stock or invalid offer response cannot change the account or ledger.

## 10. HTTP contracts

### 10.1 `GET /api/v1/rewards`

Extend the current response to include:

```ts
type RewardView = {
  balance: number;
  lifetimePoints: number;
  pointsUntilNextReward: number;
  offers: RewardOfferCardView[];
  usableRewards: UsableRewardListItem[];
  history: RewardHistoryItem[];
};
```

Each offer view includes a server-computed eligibility union, not separate booleans that may contradict each other:

```ts
type RedemptionEligibility =
  | { status: "eligible"; balanceAfter: number }
  | { status: "insufficient_points"; pointsNeeded: number }
  | { status: "out_of_stock" }
  | { status: "not_started"; startsAt: string }
  | { status: "ended" }
  | { status: "paused" }
  | { status: "limit_reached" };
```

Set `Cache-Control: private, no-store` because the response contains member-specific financial and reward data.

### 10.2 `GET /api/v1/rewards/offers/[offerId]`

Return offer details plus the same member-specific eligibility, current balance, and computed balance-after value. Return `404` for an unknown/retired offer unless product wants retired redemptions to remain viewable through their redemption URL.

### 10.3 `POST /api/v1/rewards/redemptions`

Request:

```http
Idempotency-Key: <client request UUID>
Content-Type: application/json

{ "offerId": "sunrise-cafe-set" }
```

Response on first commit: `201` with `{ redemption, rewards }`. Response on an idempotent replay: `200` with the same redemption ID/code and current reward view.

Do not accept `pointsCost`, `userId`, `codeId`, `status`, or expiry from the client.

### 10.4 `GET /api/v1/rewards/redemptions/[redemptionId]`

Require authentication and exact ownership. Return full code, offer snapshot, status, terms, location, redeemed time, and expiry. Return `404`, not another user's metadata, for a non-owned ID.

### 10.5 Stable errors

Add typed domain errors and return a stable `code` alongside safe copy, for example:

```text
INSUFFICIENT_POINTS
OFFER_NOT_ACTIVE
OFFER_OUT_OF_STOCK
REDEMPTION_LIMIT_REACHED
IDEMPOTENCY_KEY_REQUIRED
IDEMPOTENCY_KEY_REUSED
REDEMPTION_NOT_FOUND
```

Do not add more message-substring checks to `errorResponse`. Suggested statuses are `400` for malformed input/missing idempotency, `401` for auth, `404` for unknown owned resources, and `409` for a valid request that conflicts with current offer/account state.

## 11. Frontend implementation map

### `src/features/rewards/client.ts`

- Add typed functions for offer detail, redemption, and redemption detail.
- Generate the idempotency key once per confirmation intent with `createClientRequestId()`.
- Preserve the key across unknown-outcome retries; clear it only after success, explicit cancellation, or a definitive business failure.
- Parse stable error codes rather than matching text.

### `src/components/rewards-page.tsx`

- Render `UsableRewardList` before the offer catalog.
- Render catalog eligibility state supplied by the server.
- Change `earnings` to unified `history` and style negative deltas red.
- Remove all “preview/redemption is not open” copy when the feature flag is enabled.
- Keep a safe loading and retry state.

### `src/components/reward-offer-detail-page.tsx`

- Load member-specific offer state.
- Add confirmation dialog, in-flight lock, typed error handling, and success state.
- Replace the disabled preview footer with the one state-aware action.
- Do not subtract points optimistically.

### New focused UI modules

Prefer small presentational modules, while keeping network/state orchestration in the page/detail container:

```text
src/components/usable-reward-list.tsx
src/components/redeem-reward-dialog.tsx
src/components/reward-code-detail.tsx
```

### `src/styles/rewards.css`

- Add usable-list, dialog, code, eligibility, success, and debit-history styles.
- Verify desktop, current narrow breakpoints, 200% zoom, long partner names, and long codes.
- Add a non-colour status label for every green/red treatment.

## 12. Implementation sequence for a junior engineer

Each step should be a small reviewable change. Do not begin with the Redeem button.

### Step 1 — Freeze contracts and rules

- Add `src/server/domain/rewards.ts` with Zod request schemas and response/domain unions.
- Write unit tests for eligibility and history projection first.
- Confirm unique-code inventory, per-user limits, no self-mark-used flow, and refund policy with the product owner.

Done when the domain rules can be reviewed without any database or JSX changes.

### Step 2 — Add schema and fake catalog/inventory

- Add migration `015_reward_redemptions.sql` with accounts, offers, codes, redemptions, and generalized ledger constraints.
- Add safe development seed codes; never production codes.
- Add PostgreSQL constraint tests.

Done when migrations run from a clean database and over a copy containing migration 014 data.

### Step 3 — Backfill authoritative points

- Implement the idempotent legacy-activity ledger backfill.
- Populate accounts from ledger entries.
- Add a comparison report against the old summary calculation.
- Keep reads on the old path until mismatches are zero or explicitly resolved.

Done when every test persona has an explained, matching balance and rerunning the backfill inserts zero duplicates.

### Step 4 — Build the deep reward module

- Implement in-memory adapter first, then PostgreSQL adapter.
- Implement `getRewards`, `getOffer`, and atomic `redeem` through the module interface.
- Add encryption/masking at the code seam.
- Wire the module in `src/server/container.ts`.

Done when the same service tests pass against in-memory and PostgreSQL adapters.

### Step 5 — Keep future point awards consistent

- Update event-task approval/reversal persistence to maintain account and ledger atomically.
- Prove duplicate task approval does not update the account twice.
- Remove the old read-time balance path after backfill verification.

Done when task approval, reversal, legacy activity award, redemption, and refund all reconcile.

### Step 6 — Add authenticated routes

- Extend rewards `GET`.
- Add member-specific offer detail.
- Add idempotent redemption `POST`.
- Add owner-only code detail.
- Add typed errors and `private, no-store` response headers.

Done when route contract tests cover auth, ownership, validation, conflicts, response redaction, and replay.

### Step 7 — Add usable rewards and history UI

- Add the usable-code section and detail reveal.
- Change Points history to the unified history list.
- Render redemption as red `−N` with “Points spent”.
- Keep full codes out of the list and history.

Done when a redeemed code remains discoverable after a hard refresh and an expired code no longer appears as usable.

### Step 8 — Add confirmation and success UI

- Add the detail-page eligibility state, confirmation dialog, request lock, and idempotent retry.
- Add success/code-copy UI.
- Refresh from the server response after success.

Done when double-clicking, retrying, navigating back, and refreshing cannot duplicate a redemption.

### Step 9 — Accessibility, security, and end-to-end verification

- Complete keyboard, screen reader, zoom, mobile, secret-redaction, and concurrency tests.
- Add audit logs that contain redemption IDs and outcomes but no full codes.
- Run lint, typecheck, unit tests, integration tests, and build.

Done when all release gates in section 15 pass.

## 13. Test plan

### 13.1 Domain/service tests

- Balance greater than, equal to, and one point below cost.
- Active, upcoming, paused, ended, retired, and missing offers.
- Available inventory, no inventory, expired inventory, and void inventory.
- First redemption and configured per-user limit reached.
- Effective expiry uses the earlier offer/code expiry.
- Server price wins even if a malicious body includes another value.
- Debit decreases balance but not lifetime points.
- Refund restores balance but not lifetime points.
- History uses the right title, sign, type, and order for all entry kinds.
- Usable list includes only owned, issued, unexpired redemptions and sorts soonest expiry first.
- Masking never returns the full code.

### 13.2 Idempotency and concurrency tests

- Same key + same offer returns the same redemption/code and one debit.
- Same key + different offer returns `IDEMPOTENCY_KEY_REUSED`.
- Two simultaneous requests with points for only one redemption produce one success.
- Two members racing for the last code produce one success and two unchanged/appropriately changed balances.
- Double-click sends at most one logical request and the server remains correct if two arrive.
- A simulated failure after code selection rolls back code, redemption, debit, and account update.
- A response timeout after commit followed by retry returns the committed redemption.
- Concurrent task award and redemption serialize without lost points.
- Concurrent administrative reversal cannot bypass the redemption balance check.

Run real PostgreSQL integration tests for locking behaviour. In-memory tests alone cannot prove it.

### 13.3 Migration/reconciliation tests

- Clean migration chain through 015.
- Upgrade from a database containing 014 rows.
- Existing task awards/reversals keep their values and uniqueness.
- A completed legacy event receives one activity award per eligible member.
- A task-plan event does not also receive the legacy 100-point award.
- Backfill rerun creates no duplicates.
- Account balance equals ledger sum; lifetime equals the defined earning/reversal sum.
- Deleting/retiring an offer or quest cannot erase financial audit rows.

### 13.4 Route/security tests

- Unauthenticated requests return 401.
- Missing/invalid body and idempotency key return 400 with stable codes.
- A member cannot request another member's redemption/code.
- Unknown/non-owned redemption returns non-enumerating 404.
- Responses use `private, no-store`.
- Summary/list/history never include full codes.
- Full code endpoint redacts code from logs and errors.
- SQL/HTML-like code values and partner copy render as text, never executable markup.
- Rate-limit redemption and full-code reveal endpoints if shared middleware exists; otherwise record it as a release requirement.

### 13.5 UI tests

- Catalog shows exact eligibility reason.
- Confirmation shows cost and balance after redemption.
- Confirm is disabled while pending.
- Definitive failure permits a new attempt; unknown outcome reuses the key.
- Success updates balance, usable list, and history without a reload.
- Hard refresh preserves the code through server state.
- History renders `−250` in red plus the text “Points spent”.
- Full code is absent from history and usable-list markup until the owned detail is opened.
- Copy success and clipboard failure are both announced.
- Used/expired/cancelled codes are absent from usable rewards.
- Empty, loading, error, long-code, long-title, and small-screen states.

### 13.6 End-to-end acceptance flow

1. Member earns enough task points.
2. Rewards page shows the correct balance and an eligible offer.
3. Member opens details and confirms redemption.
4. One code is issued and balance falls by the exact cost.
5. `−cost` appears in red in Points history.
6. The code appears under Your usable rewards.
7. Refresh and sign-in again preserve all three results.
8. Repeating the original request does not spend again.
9. A second member cannot receive the same code.

## 14. Things to be especially careful about

1. **Do not use the current TypeScript sum as a transaction balance.** It cannot be locked and permits races.
2. **Do not split the redemption across transactions.** A point debit without a code, or a code without a debit, is a financial incident.
3. **Do not generate a fresh idempotency key on an unknown-outcome retry.** That can create a second purchase.
4. **Do not trust disabled buttons as validation.** Every rule must be rechecked under the database transaction.
5. **Do not reveal full codes in lists, history, URLs, server logs, analytics, screenshots, or exception payloads.**
6. **Do not mark a code used based on a member action.** Usage needs trusted partner/admin evidence.
7. **Do not silently change an offer after purchase.** Store redemption snapshots.
8. **Do not use cascade delete for financial history.** Retire records and preserve ledger/redemption audit data.
9. **Do not derive status only from a stored enum.** Time-based expiry must be checked at read and redeem time.
10. **Do not add a scheduled expiry job as the only correctness mechanism.** Jobs can be late.
11. **Do not update an account for an already-existing ledger row.** Use the insert result to preserve idempotency.
12. **Do not seed real codes in migrations or Git.** Import them through an authenticated operational path and encrypt them.
13. **Do not log complete request/response DTOs on code endpoints.** Log IDs, stable outcome codes, and timing only.
14. **Do not remove legacy activity-point calculation until the durable backfill has been compared and signed off.**
15. **Do not add partner code-consumption endpoints without partner authentication, replay protection, and audit requirements.** That is a separate feature.

## 15. Rollout and release gates

Use a server-side `REWARD_REDEMPTION_ENABLED` feature flag.

1. Deploy additive schema and catalog with redemption disabled.
2. Import encrypted inventory and verify per-offer counts without displaying codes.
3. Run point backfill and old-vs-new reconciliation. Resolve every mismatch.
4. Deploy new read paths and usable/history UI while Redeem remains disabled.
5. Enable for test accounts, then a small member cohort, then all members.
6. Monitor redemption success/failure by stable outcome code, out-of-stock offers, idempotent replays, reconciliation mismatches, and code-detail access failures.

Release gates:

- zero unexplained point reconciliation mismatches;
- zero duplicate code fingerprints/claims;
- concurrency integration tests pass on PostgreSQL;
- no full code appears in logs or list/history responses;
- one successful redemption produces exactly one debit, code claim, and redemption;
- accessibility and mobile checks pass;
- rollback procedure tested.

Rollback means disabling new redemptions while continuing to show already-issued codes. Never roll back by deleting redemption or ledger rows. If a release issued an invalid code, use an audited invalidate-and-refund operation after partner confirmation.

## 16. Definition of done

The feature is done when an authenticated member with enough points can redeem an active, stocked offer exactly once, receive one persistent owned code, find it in a usable-rewards list, and see a red negative entry in Points history; all state remains correct across refreshes, retries, concurrent requests, expiry, and PostgreSQL restart, and all tests and release gates above pass.
