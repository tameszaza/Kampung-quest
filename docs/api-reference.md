# Implemented API reference

> All application APIs use the current Better Auth session cookie. The route handler is the contract boundary; request and response schemas live beside the domain services.

## Conventions

- `requireUser()` binds the actor from the session.
- `GET` reads are normally `cache: "no-store"` from the browser.
- Mutating event commands require an `Idempotency-Key` header and an `expectedRevision` body field unless the route is a message append or a simple preference update.
- Stale revisions return a conflict response through [`src/server/http/responses.ts`](../src/server/http/responses.ts). Do not bypass the service to “make the UI work.”
- The legacy `POST /api/v1/quests/[questId]/events` route intentionally returns `410 Gone`.

## Authentication, profile, and account

| Method | Endpoint | Purpose | Handler |
| --- | --- | --- | --- |
| `GET`, `POST` | `/api/auth/[...all]` | Better Auth email/password, Google OAuth, sessions, and callbacks | [`src/app/api/auth/[...all]/route.ts`](../src/app/api/auth/%5B...all%5D/route.ts) |
| `GET` | `/api/profile/username-available?username=...` | Check a unique display name | [`src/app/api/profile/username-available/route.ts`](../src/app/api/profile/username-available/route.ts) |
| `POST` | `/api/profile/complete` | Complete onboarding profile | [`src/app/api/profile/complete/route.ts`](../src/app/api/profile/complete/route.ts) |
| `POST`, `DELETE` | `/api/profile/avatar` | Upload or remove the current member's avatar | [`src/app/api/profile/avatar/route.ts`](../src/app/api/profile/avatar/route.ts) |
| `GET` | `/api/profile/avatar/[key]` | Serve an optimized avatar | [`src/app/api/profile/avatar/[key]/route.ts`](../src/app/api/profile/avatar/%5Bkey%5D/route.ts) |
| `PATCH` | `/api/users/me` | Update profile, preferences, privacy, and emergency contact | [`src/app/api/users/me/route.ts`](../src/app/api/users/me/route.ts) |
| `GET`, `POST` | `/api/account/security` | Read or update privacy/security settings | [`src/app/api/account/security/route.ts`](../src/app/api/account/security/route.ts) |
| `POST` | `/api/account/password` | Change password | [`src/app/api/account/password/route.ts`](../src/app/api/account/password/route.ts) |

## Direct and group chat

| Method | Endpoint | Purpose | Handler |
| --- | --- | --- | --- |
| `GET` | `/api/chat/contacts?q=...` | Search contacts allowed by privacy rules | [`src/app/api/chat/contacts/route.ts`](../src/app/api/chat/contacts/route.ts) |
| `GET` | `/api/chat/conversations` | List direct, group, and quest conversations | [`src/app/api/chat/conversations/route.ts`](../src/app/api/chat/conversations/route.ts) |
| `POST` | `/api/chat/conversations` | Create a direct or named group conversation | same handler |
| `GET` | `/api/chat/conversations/[conversationId]/messages` | Read a message page or cursor delta | [`src/app/api/chat/conversations/[conversationId]/messages/route.ts`](../src/app/api/chat/conversations/%5BconversationId%5D/messages/route.ts) |
| `POST` | `/api/chat/conversations/[conversationId]/messages` | Send a message | same handler |
| `DELETE` | `/api/chat/conversations/[conversationId]` | Leave or delete when permitted | [`src/app/api/chat/conversations/[conversationId]/route.ts`](../src/app/api/chat/conversations/%5BconversationId%5D/route.ts) |
| `GET` | `/api/chat/profiles/[userId]?conversationId=...` | Read a privacy-authorized chat profile | [`src/app/api/chat/profiles/[userId]/route.ts`](../src/app/api/chat/profiles/%5BuserId%5D/route.ts) |
| `GET`, `POST`, `DELETE` | `/api/chat/blocks` | List, block, or unblock a member | [`src/app/api/chat/blocks/route.ts`](../src/app/api/chat/blocks/route.ts) |

## Assistant, memory, retrieval, and proposals

| Method | Endpoint | Purpose | Handler |
| --- | --- | --- | --- |
| `POST` | `/api/v1/assistant/conversations` | Start a persisted assistant conversation | [`src/app/api/v1/assistant/conversations/route.ts`](../src/app/api/v1/assistant/conversations/route.ts) |
| `GET` | `/api/v1/assistant/conversations` | Return the member's latest conversation | same handler |
| `GET` | `/api/v1/assistant/conversations/[conversationId]` | Read an owned conversation snapshot | [`src/app/api/v1/assistant/conversations/[conversationId]/route.ts`](../src/app/api/v1/assistant/conversations/%5BconversationId%5D/route.ts) |
| `POST` | `/api/v1/assistant/conversations/[conversationId]/turns` | Append an answer and receive the next assistant turn | [`src/app/api/v1/assistant/conversations/[conversationId]/turns/route.ts`](../src/app/api/v1/assistant/conversations/%5BconversationId%5D/turns/route.ts) |
| `GET` | `/api/v1/assistant/conversations/[conversationId]/events?after=...` | Replay persisted workflow events | [`src/app/api/v1/assistant/conversations/[conversationId]/events/route.ts`](../src/app/api/v1/assistant/conversations/%5BconversationId%5D/events/route.ts) |
| `POST` | `/api/v1/assistant/conversations/[conversationId]/confirm` | Confirm the brief and stream workflow stages as SSE | [`src/app/api/v1/assistant/conversations/[conversationId]/confirm/route.ts`](../src/app/api/v1/assistant/conversations/%5BconversationId%5D/confirm/route.ts) |
| `POST` | `/api/v1/assistant/recommend` | Legacy synchronous recommendation endpoint | [`src/app/api/v1/assistant/recommend/route.ts`](../src/app/api/v1/assistant/recommend/route.ts) |
| `GET`, `POST` | `/api/v1/memories` | Read or record the signed-in member's active memory | [`src/app/api/v1/memories/route.ts`](../src/app/api/v1/memories/route.ts) |
| `GET` | `/api/v1/memories/[candidateId]` | Read own memory by ID; other members are forbidden | [`src/app/api/v1/memories/[candidateId]/route.ts`](../src/app/api/v1/memories/%5BcandidateId%5D/route.ts) |
| `GET` | `/api/v1/candidates/[candidateId]/retrieve?limit=...` | Retrieve eligible candidates for the signed-in member | [`src/app/api/v1/candidates/[candidateId]/retrieve/route.ts`](../src/app/api/v1/candidates/%5BcandidateId%5D/retrieve/route.ts) |
| `POST` | `/api/v1/quests/propose/[candidateId]` | Run synthesis, validation, and safety for a proposal | [`src/app/api/v1/quests/propose/[candidateId]/route.ts`](../src/app/api/v1/quests/propose/%5BcandidateId%5D/route.ts) |
| `GET` | `/api/v1/quests?candidateId=...&limit=...` | List quest runs visible to the signed-in member | [`src/app/api/v1/quests/route.ts`](../src/app/api/v1/quests/route.ts) |
| `GET` | `/api/v1/quests/[questId]` | Read an authorized quest run | [`src/app/api/v1/quests/[questId]/route.ts`](../src/app/api/v1/quests/%5BquestId%5D/route.ts) |
| `POST` | `/api/v1/quests/[questId]/events` | Retired legacy endpoint; returns `410` | [`src/app/api/v1/quests/[questId]/events/route.ts`](../src/app/api/v1/quests/%5BquestId%5D/events/route.ts) |

## Activities, invitations, and event coordination

| Method | Endpoint | Purpose | Handler |
| --- | --- | --- | --- |
| `GET` | `/api/v1/activities` | Return Suggested, Invited, Sent, Notifications, and My Activities projections | [`src/app/api/v1/activities/route.ts`](../src/app/api/v1/activities/route.ts) |
| `GET` | `/api/v1/event-quests/[questId]` | Return a role-safe event quest view | [`src/app/api/v1/event-quests/[questId]/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/route.ts) |
| `GET` | `/api/v1/event-quests/[questId]/participants/[userId]` | Read an authorized participant profile | [`src/app/api/v1/event-quests/[questId]/participants/[userId]/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/participants/%5BuserId%5D/route.ts) |
| `GET` | `/api/v1/event-quests/[questId]/participants?q=...` | Search eligible participants for roster editing | [`src/app/api/v1/event-quests/[questId]/participants/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/participants/route.ts) |
| `PATCH` | `/api/v1/event-quests/[questId]/roster` | Add or remove a roster member | [`src/app/api/v1/event-quests/[questId]/roster/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/roster/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/roster` | Confirm the roster and create invitations | same handler |
| `POST` | `/api/v1/event-quests/[questId]/recruitment` | Publish an undersized quest for open recruitment | [`src/app/api/v1/event-quests/[questId]/recruitment/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/recruitment/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/join-requests` | Submit a request to join a published quest | [`src/app/api/v1/event-quests/[questId]/join-requests/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/join-requests/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/join-requests/[requestId]` | Organizer approves or rejects a join request | [`src/app/api/v1/event-quests/[questId]/join-requests/[requestId]/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/join-requests/%5BrequestId%5D/route.ts) |
| `DELETE` | `/api/v1/event-quests/[questId]/suggestion` | Hide a suggestion for the current member | [`src/app/api/v1/event-quests/[questId]/suggestion/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/suggestion/route.ts) |
| `POST` | `/api/v1/invitations/[invitationId]/respond` | Accept or decline the current member's invitation | [`src/app/api/v1/invitations/[invitationId]/respond/route.ts`](../src/app/api/v1/invitations/%5BinvitationId%5D/respond/route.ts) |
| `POST` | `/api/v1/invitations/[invitationId]` | Organizer/participant invitation transition: expire, withdraw, replace, or cancel | [`src/app/api/v1/invitations/[invitationId]/route.ts`](../src/app/api/v1/invitations/%5BinvitationId%5D/route.ts) |
| `GET`, `POST` | `/api/v1/event-quests/[questId]/coordination` | Read or send a private coordination thread | [`src/app/api/v1/event-quests/[questId]/coordination/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/coordination/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/coordination/requirements` | Confirm the current member's requirements | [`src/app/api/v1/event-quests/[questId]/coordination/requirements/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/coordination/requirements/route.ts) |
| `GET`, `POST` | `/api/v1/event-quests/[questId]/coordination/group` | Read or send the accepted-member group thread | [`src/app/api/v1/event-quests/[questId]/coordination/group/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/coordination/group/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/arrangements` | Validate and propose a time/venue | [`src/app/api/v1/event-quests/[questId]/arrangements/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/arrangements/route.ts) |
| `PUT` | `/api/v1/event-quests/[questId]/arrangements` | Suggest the best compatible arrangement from confirmed availability | same handler |
| `POST` | `/api/v1/event-quests/[questId]/arrangements/[arrangementId]` | Organizer approves/rejects or participant confirms/rejects | [`src/app/api/v1/event-quests/[questId]/arrangements/[arrangementId]/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/arrangements/%5BarrangementId%5D/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/lifecycle` | Cancel, start, complete, or reopen the quest | [`src/app/api/v1/event-quests/[questId]/lifecycle/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/lifecycle/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/roles/respond` | Acknowledge a final role or raise a concern | [`src/app/api/v1/event-quests/[questId]/roles/respond/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/roles/respond/route.ts) |

## Tasks, rewards, and notifications

| Method | Endpoint | Purpose | Handler |
| --- | --- | --- | --- |
| `POST` | `/api/v1/event-quests/[questId]/task-plan/retry` | Retry a failed task-plan generation | [`src/app/api/v1/event-quests/[questId]/task-plan/retry/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/task-plan/retry/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/tasks/[taskId]` | Submit, approve, retry, or reverse a task | [`src/app/api/v1/event-quests/[questId]/tasks/[taskId]/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/tasks/%5BtaskId%5D/route.ts) |
| `POST` | `/api/v1/event-quests/[questId]/task-reassignments/[requestId]` | Approve or reject a task reassignment | [`src/app/api/v1/event-quests/[questId]/task-reassignments/[requestId]/route.ts`](../src/app/api/v1/event-quests/%5BquestId%5D/task-reassignments/%5BrequestId%5D/route.ts) |
| `GET` | `/api/v1/rewards` | Read the wallet balance, point history, decorated offers, and masked usable codes | [`src/app/api/v1/rewards/route.ts`](../src/app/api/v1/rewards/route.ts) |
| `POST` | `/api/v1/rewards` | Atomically spend points and issue one stocked code; requires `Idempotency-Key` | same handler |
| `POST` | `/api/v1/rewards/redemptions` | Alias for reward redemption with the same idempotency contract | [`src/app/api/v1/rewards/redemptions/route.ts`](../src/app/api/v1/rewards/redemptions/route.ts) |
| `GET` | `/api/v1/rewards/offers/[offerId]` | Read one offer with member-specific eligibility and post-redemption balance | [`src/app/api/v1/rewards/offers/[offerId]/route.ts`](../src/app/api/v1/rewards/offers/%5BofferId%5D/route.ts) |
| `GET` | `/api/v1/rewards/redemptions/[redemptionId]` | Read the full issued code for its authenticated owner | [`src/app/api/v1/rewards/redemptions/[redemptionId]/route.ts`](../src/app/api/v1/rewards/redemptions/%5BredemptionId%5D/route.ts) |
| `GET` | `/api/v1/notifications?limit=...` | Read member activity notifications | [`src/app/api/v1/notifications/route.ts`](../src/app/api/v1/notifications/route.ts) |
| `POST` | `/api/v1/notifications/read` | Mark activity notifications read | [`src/app/api/v1/notifications/read/route.ts`](../src/app/api/v1/notifications/read/route.ts) |

## Internal asset route

| Method | Endpoint | Purpose | Handler |
| --- | --- | --- | --- |
| `GET` | `/api/quest-images/[key]` | Serve a stored quest thumbnail | [`src/app/api/quest-images/[key]/route.ts`](../src/app/api/quest-images/%5Bkey%5D/route.ts) |
