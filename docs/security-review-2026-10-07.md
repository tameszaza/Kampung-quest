# Deployment security review — 7 October 2026

Recommendation: fix the privacy failures and update the image-processing dependencies before accepting real users or personal data.

Remediation update: S4's outbound AI rate/budget controls are now implemented in this working tree. See [AI abuse controls](ai-abuse-controls.md) for shared PostgreSQL admission, configuration, and billing-estimate limitations. The original audit findings below remain as the review record; ingress and non-AI abuse controls are separate work.

This review covered the current working tree, API authentication and authorization, chat and matching privacy, rewards, uploads, dependency advisories, and Docker/Compose/Railway configuration. Application code and deployment configuration were not changed. Existing edits to README.md and .env.example were preserved.

Validation used synthetic users, in-memory stores, a temporary image directory, and public advisory lookups. No live deployment was attacked, no production database was accessed, and no provider requests were made. Findings marked as reproduced refer to local application components; PostgreSQL behavior was assessed from the production SQL implementation, not a live PostgreSQL reproduction.

## Findings

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| S1 | High; critical dependency alerts | Vulnerable native image dependencies are reachable through uploads | Benign decoder bypass reproduced; code execution not attempted |
| S2 | High | Group creation bypasses privacy and exposes contact information | Reproduced locally; production SQL has the same checks missing |
| S3 | High | Matching exposes full profiles of blocked/private members | Reproduced locally; production recipient filter lacks relationship checks |
| S4 | High | Application routes lack controls on paid AI work and resource consumption | Source tracing; no load test |
| S5 | Medium | Request bodies and AI input have insufficient size bounds | 2 MB narrative accepted by schema; multipart parsing traced |
| S6 | Medium, configuration dependent | Published development credentials pass production validation | Reproduced against production validator with synthetic configuration |

### S1 — Vulnerable image processing and a MIME check bypass

Locations: `package.json:28`, `package.json:33`, `package.json:49`, `src/server/profile/avatar-storage.ts:26`, `src/server/profile/avatar-storage.ts:67`, `src/server/quest/quest-image-storage.ts:23`.

Next.js is pinned to 16.2.12, and Sharp is pinned and overridden to 0.35.3. Current advisories flag these versions. The avatar upload checks the caller-supplied MIME type, then gives the bytes to Sharp for automatic decoding. A benign SVG submitted as a File with MIME type image/png was accepted and converted to WebP. Consequently, the stated JPEG/PNG/WebP allowlist does not prevent use of other native decoders. The application also rasterizes generated SVG thumbnails through Sharp.

The maintainers describe conditional RCE in the underlying libheif and librsvg libraries. The reported RCE conditions include glibc-based Linux and runtime hardening details. The supplied Dockerfile uses Alpine/musl, so this review does not establish RCE against that exact container. It establishes vulnerable versions and a reachable decoder boundary. The Next.js Windows advisory does not apply to this Linux Dockerfile, and no application use of next/og ImageResponse was found.

Fix: update Next.js and its matching ESLint configuration to a supported patched release, and update Sharp in both dependencies and overrides. The native library advisories specify Sharp 0.35.4 for the libheif fix and 0.35.5 for the librsvg fix; Next.js specifies 16.3.3 for the AVIF mitigation and 16.3.6 for the separate next/og issue. The registry audit offered Next.js 16.4.0. Recheck advisories when applying updates. Restrict avatar decoding to the actual supported formats before broad native parsing; decoder allowlisting or an isolated image worker is stronger than trusting MIME types. Keep SVG thumbnail processing separate if it needs its own decoder policy.

Sources: [Sharp libheif advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), [Sharp librsvg advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [Next.js AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [Next.js ImageResponse advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j).

### S2 — Forced group membership grants access to private contact information

Locations: `src/server/identity/postgres-identity-store.ts:542`, `src/server/identity/postgres-identity-store.ts:567`, `src/server/identity/postgres-identity-store.ts:576`, `src/server/identity/postgres-identity-store.ts:273`, `src/app/api/chat/conversations/route.ts:27`, `src/app/api/chat/profiles/[userId]/route.ts:8`.

The conversation API accepts participant IDs from any signed-in user. The production store checks profileVisibility and messagePrivacy only in the direct-chat branch. The group branch inserts the requested participants as members immediately, without their acceptance. getChatProfile then treats shared membership as sufficient permission to disclose email, phone, and emergency-contact name, relationship, phone, and email. It does not check privacy settings or blocking at read time.

Local reproduction:

1. Create two synthetic members; set the target to profileVisibility=private and messagePrivacy=nobody.
2. Verify that starting a direct chat is rejected.
3. Create a group containing the target through the same store method used by the conversation API.
4. Read the target's chat profile as the creator. The synthetic emergency-contact phone is returned.

A known target ID is sufficient. Community contacts and the matching interface can expose IDs. Blocking prevents new group creation between those two users, but getChatProfile does not recheck blocking for groups created earlier.

Fix: apply recipient privacy rules to every conversation type, require acceptance before group membership grants access, and return a minimal member profile. Sharing a chat should not automatically expose emergency contacts; use explicit consent or a separately authorized emergency workflow. Check blocking and current authorization when reading contact details.

### S3 — Matching ignores real relationship blocks and returns internal profile fields

Locations: `src/app/api/v1/candidates/[candidateId]/retrieve/route.ts:14`, `src/server/core/kampung-quest-engine.ts:435`, `src/server/core/kampung-quest-engine.ts:537`, `src/server/identity/postgres-identity-store.ts:317`, `src/server/container.ts:303`.

The route correctly requires the caller to retrieve matches for their own ID. However, its response contains each matching member's entire CandidateProfile: need, interests, offers, availability, stairs/mobility constraints, dietary requirements, and internal scores.

The production filter checks that recipients have an auth record and completed onboarding. It does not accept a viewer ID and cannot evaluate the actual chat.user_blocks relationship or profile privacy preferences. The engine's relationshipBlocked boolean is a property of the memory profile; it is not a lookup of the stored block between caller and target.

Local reproduction: a private synthetic target blocked the caller through the identity store. Both had compatible, active memories with invitationConsent=true. retrieveCandidates still returned the target's ID, full need, availability, and synthetic dietary restriction. The invitation consent allows matching in general; it does not prevent this observed relationship-block bypass or justify exposing every internal field.

Fix: pass the initiating user into recipient eligibility checks and exclude blocks in both directions. Define how profile privacy and matchmaking consent interact, enforce that policy consistently, and serialize an explicit minimal matching response. Keep personal restrictions and detailed availability server-side until the appropriate sharing stage.

### S4 — Unmetered application requests can spend provider budget and exhaust resources

Locations: `src/lib/auth.ts:71`, `src/app/api/v1/assistant/conversations/route.ts:7`, `src/server/features/assistant-conversation-service.ts:63`, `src/app/api/v1/assistant/recommend/route.ts:8`, `src/app/api/v1/quests/propose/[candidateId]/route.ts:12`, `src/app/api/profile/avatar/route.ts:8`.

Better Auth's configured rate limiter protects its auth endpoints. No corresponding application limiter, per-user AI budget, or global admission control was found on assistant creation, recommendation, quest generation, or avatar conversion. Assistant creation invokes an agent and creates a fresh conversation each time. A signed-in user can repeatedly start new work; idempotency on some operations does not limit distinct requests. Email verification is not required by this application's email/password configuration, making new-account abuse easier.

Impact: provider costs/quota exhaustion, database growth, and native image CPU pressure. Provider-side quotas can eventually reject calls but also deny service to legitimate users. No actual provider spending or traffic flood was performed. External edge limits were not available for inspection.

Fix: enforce distributed per-user and per-IP limits, per-user daily AI allowances, a global spend budget, and bounded concurrency/queues before invoking paid services. Limit account creation abuse and add verification appropriate to real membership. Put separate limits on image processing and chat creation.

### S5 — Size checks occur too late or are absent

Locations: `src/app/api/profile/avatar/route.ts:11`, `src/server/profile/avatar-storage.ts:28`, `src/server/domain/schemas.ts:64`, `src/app/api/v1/assistant/recommend/route.ts:11`.

The avatar route calls request.formData() before checking the selected file's 5 MB size. That check does not bound total multipart bytes or extra fields consumed during parsing. Other routes call request.json() without an application byte limit. The recommendation schema has no narrative maximum or array-count limits for interests/offers and related constraints. A 2,000,000-character synthetic narrative passed schema validation locally.

Impact: excessive memory, parsing work, stored data, and AI input. A proxy with appropriately configured limits can reduce exposure; its actual configuration is unknown.

Fix: enforce total byte limits at the edge and in body consumption, including chunked requests. Return 413 before parsing oversized payloads. Add field length and array-count bounds and a provider input budget. Keep image pixel limits as well as compressed byte limits.

### S6 — Known default secrets remain acceptable for a public deployment

Locations: `compose.yaml:10`, `compose.yaml:32`, `compose.yaml:33`, `src/server/runtime-environment.ts:50`, `scripts/validate-production-env.mjs:53`, `.env.example:16`.

Compose supplies a published development database password and auth secret when values are absent. Production validation checks auth-secret length, so the known Compose fallback and sufficiently long placeholder strings satisfy that check. With the other required variables present and a public HTTPS auth URL, a synthetic configuration containing the published defaults passed assertProductionEnvironment.

Impact is conditional on deploying those defaults. A publicly known auth secret compromises the intended signing/encryption trust boundary, including cached session integrity and encrypted OAuth tokens; a default database password becomes dangerous if the database is reachable. The Compose database port is correctly bound to loopback, which reduces network exposure. The local .env was checked without printing its values and did not contain the tested known placeholders; this is not evidence of the live deployment's settings.

Fix: require explicit secrets in production Compose with fail-fast variable checks, reject known development/placeholders in both validators, and generate unique high-entropy credentials. Use a dedicated application database role with only the permissions it needs. Rotate deployed credentials if defaults were ever used.

## Dependency audit interpretation

`npm audit --omit=dev --json` returned 12 affected package entries: 2 critical, 5 high, and 5 moderate. These are package classifications, not 12 proven remotely exploitable application vulnerabilities.

| Package | Locked version | Registry severity | Reachability assessment |
| --- | --- | --- | --- |
| next | 16.2.12 | Critical | Image optimization configured; Windows RCE inapplicable to supplied Linux Dockerfile; no next/og usage found |
| sharp | 0.35.3 | High | Called with uploaded bytes and generated SVG; decoder bypass reproduced |
| proxy-addr | 2.0.7 | Critical | Express/MCP dependency chain; application Express server usage not found |
| @modelcontextprotocol/sdk | 1.30.0 | High | Present transitively; no application MCP OAuth flow found |
| fast-uri | 3.1.5 | High | MCP/AJV chain; vulnerable application use not established |
| nanoid | 3.3.16 | High | PostCSS chain; vulnerable custom generator use not found |
| source-map-js | 1.2.1 | High | Vulnerable source-map processing not established |
| hono | 4.12.33 | Moderate | MCP chain; affected application middleware/JSX features not found |
| ip-address | 10.4.0 | Moderate | Express rate-limit chain; vulnerable application use not established |
| qs | 6.15.3 | Moderate | Express/body-parser chain; vulnerable application use not established |
| vitest | 4.1.10 | Moderate | Test tooling; lockfile devOptional entry appears in audit output; no public test server configured |
| @vitest/mocker | 4.1.10 | Moderate | Same test-tooling qualification |

Update the dependency tree and repeat the audit, but prioritize reachable image processing and the application privacy findings. Do not equate this inventory with the standalone bundle: actual shipped modules also depend on Next.js output tracing.

## Verification and existing protections

- Six selected test files passed: 28 tests covering identity/chat, quest access, provider privacy, reward redemption, production environment, and API contracts.
- The host's default Node 18 could not start Vitest. Checks were rerun successfully with an ephemeral Node 22 executable, matching the project's required major version.
- Local synthetic checks reproduced S2, S3, the benign SVG/MIME bypass in S1, default-secret acceptance in S6, and oversized narrative acceptance in S5.
- Most authenticated API routes derive the actor from the session. Reviewed memory/assistant routes contain ownership checks, and chat message methods check membership.
- Reviewed SQL uses parameterized values. No direct SQL injection or raw HTML execution path was identified in the inspected flows.
- Reward redemption uses account/code locking and scoped ownership; reward codes are encrypted, and reward responses use private/no-store caching.
- Uploaded avatars are rewritten to WebP with pixel bounds, image keys are constrained before filesystem reads, the runtime container is non-root, and API/database host ports bind to loopback.
- .env is excluded from Git and Docker build context. A pattern scan of currently tracked files found no matching private keys or common provider/GitHub token formats. This was not a complete history or secret audit.

## Remaining deployment checks

Live TLS, proxy request limits, Cloudflare rules, actual environment secrets, database network access/roles, installed native libraries, backups, and the deployed artifact were not inspected. Custom mutation routes also lack a common explicit origin check, and no application CSP/frame policy was found; confirm these at the proxy and add appropriate defense in depth. Better Auth's default SameSite=Lax cookies mitigate ordinary cross-site POST CSRF, so missing application origin checks alone were not reported as a proven cross-site exploit.

Resolve S1–S3 first, then enforce request/AI budgets and production secret checks. Verify the privacy fixes against both in-memory and PostgreSQL implementations before deployment.
