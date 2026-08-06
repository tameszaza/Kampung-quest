# Current web state

> This is the practical product map. It describes the web application that exists in the repository, not the original prototype or an aspirational roadmap.

## Product in one paragraph

Senior Quest helps an authenticated member describe a need or interest, find a safe group activity, invite or recruit compatible neighbours, coordinate privately, agree a public arrangement, and complete role-based tasks. Better Auth sessions, PostgreSQL state, deterministic validation, safety review, and optimistic revisions keep the model from making authoritative membership or scheduling decisions on its own.

## Web routes

All routes under `src/app/(app)/` require a signed-in member who has completed onboarding. The root route is a redirect, not a landing page.

| URL | Access | What it does | Primary file |
| --- | --- | --- | --- |
| `/` | Public | Redirects to `/login` | [`src/app/page.tsx`](../src/app/page.tsx) |
| `/login` | Public | Email/password login and optional Google sign-in | [`src/app/(auth)/login/page.tsx`](../src/app/%28auth%29/login/page.tsx), [`src/components/auth-form.tsx`](../src/components/auth-form.tsx) |
| `/register` | Public | Creates an account with a unique display name | [`src/app/(auth)/register/page.tsx`](../src/app/%28auth%29/register/page.tsx) |
| `/register/complete` | Authenticated, incomplete profile | Completes Google or account onboarding details | [`src/app/(auth)/register/complete/page.tsx`](../src/app/%28auth%29/register/complete/page.tsx), [`src/components/profile-completion-form.tsx`](../src/components/profile-completion-form.tsx) |
| `/auth/continue` | Authenticated | Sends the member to `/home` or profile completion | [`src/app/(auth)/auth/continue/page.tsx`](../src/app/%28auth%29/auth/continue/page.tsx) |
| `/home` | Authenticated | Dashboard, shortcuts, recommendations, and status | [`src/app/(app)/home/page.tsx`](../src/app/%28app%29/home/page.tsx) |
| `/needs` | Authenticated | Shows the signed-in member's active memory | [`src/app/(app)/needs/page.tsx`](../src/app/%28app%29/needs/page.tsx), [`src/components/user-memory-view.tsx`](../src/components/user-memory-view.tsx) |
| `/quests` | Authenticated | Suggested activities, invitations, sent invitations, and notifications | [`src/app/(app)/quests/page.tsx`](../src/app/%28app%29/quests/page.tsx), [`src/components/activities-page.tsx`](../src/components/activities-page.tsx) |
| `/quests/[slug]` | Authenticated and authorized | Quest detail, roster, invitation, coordination, arrangement, lifecycle, roles, and tasks | [`src/app/(app)/quests/[slug]/page.tsx`](../src/app/%28app%29/quests/%5Bslug%5D/page.tsx), [`src/components/event-quest-detail.tsx`](../src/components/event-quest-detail.tsx) |
| `/invites` | Authenticated | Redirects to `/quests?tab=Invited` | [`src/app/(app)/invites/page.tsx`](../src/app/%28app%29/invites/page.tsx) |
| `/my-quests` | Authenticated | Groups the member's activities by coordination and lifecycle state | [`src/app/(app)/my-quests/page.tsx`](../src/app/%28app%29/my-quests/page.tsx), [`src/components/my-quests-page.tsx`](../src/components/my-quests-page.tsx) |
| `/messages` | Authenticated | Direct chat, group chat, assistant chat, and quest coordination chat | [`src/app/(app)/messages/page.tsx`](../src/app/%28app%29/messages/page.tsx), [`src/components/chat-center.tsx`](../src/components/chat-center.tsx) |
| `/assistant` | Authenticated | Redirects to the embedded Senior Quest assistant in Messages | [`src/app/assistant/page.tsx`](../src/app/assistant/page.tsx) |
| `/profile` | Authenticated | Member profile, photo, and profile shortcuts | [`src/app/(app)/profile/page.tsx`](../src/app/%28app%29/profile/page.tsx) |
| `/settings` | Authenticated | Preferences, accessibility, privacy, blocked users, emergency contact, and security | [`src/app/(app)/settings/page.tsx`](../src/app/%28app%29/settings/page.tsx) |
| `/rewards` | Authenticated | Point balance, approved task history, and preview partner offers | [`src/app/(app)/rewards/page.tsx`](../src/app/%28app%29/rewards/page.tsx), [`src/components/rewards-page.tsx`](../src/components/rewards-page.tsx) |
| `/rewards/[offerId]` | Authenticated | Details for a preview partner offer | [`src/app/(app)/rewards/[offerId]/page.tsx`](../src/app/%28app%29/rewards/%5BofferId%5D/page.tsx) |
| `/partners` | Public | Partner pitch and non-persisted proposal preview | [`src/app/partners/page.tsx`](../src/app/partners/page.tsx), [`src/components/partner-rewards-page.tsx`](../src/components/partner-rewards-page.tsx) |
| `/health` | Public | Container health response | [`src/app/health/route.ts`](../src/app/health/route.ts) |

## What is live versus demo-only

### Persisted and server-authoritative

- Member identity, Better Auth sessions, unique usernames, profile preferences, photos, emergency contacts, blocks, conversations, and messages.
- Assistant conversations, turns, extracted briefs, workflow events, memory cards, embeddings, quest runs, safety/validation results, event coordination state, audit events, outbox entries, tasks, and reward ledger entries.
- Suggested activities and invitations returned by `/api/v1/activities`.
- Roster edits, invitation responses, join requests, private/group coordination messages, arrangement proposals and confirmations, lifecycle changes, task review, and notification read state.

### Preview or intentionally gated

- The showcase fixtures in [`src/data/mock-data.ts`](../src/data/mock-data.ts) and demo welcome chats are visible only to the exact username `test`.
- `/partners` is a product preview. Its form acknowledges submission in the browser and does not send or store a partner proposal.
- Reward offers are examples; points and approved-task history come from the API, but redemption is not open.
- “My Badges” on Profile currently shows a toast rather than a persisted badge screen.
- The normal account experience can be empty until the member creates or receives a real activity. A provider or API failure must not turn on demo data.

## The member journey

```text
Register or log in
        ↓
Complete profile and preferences
        ↓
Talk to Senior Quest in Messages
        ↓
Confirm the brief and prepare a validated, safety-reviewed proposal
        ↓
Review or edit the proposed roster
        ↓
Confirm roster → invitations or open recruitment
        ↓
Accept invitations / approve join requests
        ↓
Private coordination → confirmed requirements
        ↓
Propose or suggest a public arrangement
        ↓
Organizer approves → every accepted member confirms
        ↓
Scheduled activity → roles acknowledged → tasks completed and reviewed
        ↓
Approved tasks add points to Rewards
```

An accepted invitation does not confirm the provisional time. The final arrangement is separate and must be approved and confirmed.

## Coordination lifecycle

The durable event aggregate uses these lifecycle values:

`forming` → `recruiting` → `awaiting_responses` → `coordinating` → `awaiting_confirmation` → `scheduled` → `in_progress` → `completed`

`cancelled` and `human_review` are terminal or recovery branches. A quest can return to formation through an authorized organizer action when the group, venue, or arrangement needs to change.

The important state rule is: the agent interprets messages and proposes structured changes; [`EventCoordinator`](../src/server/features/event-coordinator.ts) and the domain services validate permissions, revisions, eligibility, and transitions before the repository saves anything.

## Responsive behavior

- Mobile uses full-width pages and a fixed bottom navigation bar.
- At 768px and above, the shell exposes wider content and a desktop-style navigation treatment.
- At 1024px and above, the app uses a persistent left navigation and larger dashboard/activity layouts.
- Settings apply text-size and high-contrast attributes to the document root.
- The main style entrypoint is [`src/app/globals.css`](../src/app/globals.css), which imports [`src/styles/tokens.css`](../src/styles/tokens.css), [`src/styles/base.css`](../src/styles/base.css), [`src/styles/navigation.css`](../src/styles/navigation.css), [`src/styles/components.css`](../src/styles/components.css), [`src/styles/pages.css`](../src/styles/pages.css), and [`src/styles/rewards.css`](../src/styles/rewards.css).

## Current boundaries to remember

- The app uses in-memory adapters when `DATABASE_URL` is absent and PostgreSQL in Docker/production. Keep both implementations behaviorally aligned.
- Gemini is the default hosted provider when configured; OpenAI and an explicit deterministic test provider are supported. Provider failure is surfaced or falls through only where the feature explicitly defines a safe local fallback, such as quest thumbnail SVG generation.
- Quest thumbnails are best effort. The quest is saved first, then a sanitized SVG is generated and stored as a 1200×675 WebP behind `/api/quest-images/[key]`.
- External venue booking, push/email delivery, and partner reward redemption are not implemented integrations.

