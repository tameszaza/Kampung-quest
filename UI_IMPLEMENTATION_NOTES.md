# Senior Quest frontend handoff

## What changed

The reference image is treated as a mobile design specification, not as a phone mockup. The application now renders directly in the browser viewport:

- Mobile: full-width pages with a fixed bottom navigation bar.
- Tablet: responsive content and a compact top navigation bar.
- Desktop (1024 px and above): persistent left navigation, wide dashboard cards, horizontal activity rows, split quest details, and two-pane chat matching `UI_ref/desktop1.png`.
- Desktop registration uses one flat surface with a horizontal wordmark; it avoids nested bordered cards while preserving the mobile single-card flow.
- There is no artificial phone frame, fake phone status bar, or fixed mobile-sized desktop container.

## Route structure

The UI uses real Next.js App Router routes:

- `/` welcome and onboarding
- `/home` dashboard
- `/needs` active and past needs
- `/quests` recommendations
- `/quests/[slug]` quest details
- `/invites` received and sent invites
- `/my-quests` upcoming and past joined quests
- `/messages` conversations
- `/profile` profile and shortcuts
- `/settings` settings and safety
- `/login` Better Auth email/display-name and Google sign-in
- `/register` guided unique-name registration
- `/register/complete` required Google onboarding details

## Modular structure

- `src/components/`: reusable application shell, navigation, cards, tabs, icons, menus, create-quest sheet, and local prototype state.
- `src/data/mock-data.ts`: all placeholder data.
- `src/types/quest.ts`: shared frontend types.
- `src/styles/`: split design system, base layout, navigation, components, and page styles.
- `src/app/(app)/`: separate route modules for each application page.
- `src/lib/auth.ts`: Better Auth server configuration, Google OAuth, credential auth, sessions, and the username plugin.
- `src/server/identity/`: modular profile, preference, contact-search, and chat persistence.
- `src/server/profile/avatar-storage.ts`: validated 512 px WebP avatar optimization and storage.

Unfinished assistant answers are stored in `localStorage`, while confirmed memories and engine recommendations are loaded from the core engine. Direct and group messages, unread state, member authorization, searchable unique display names, profiles, preferences, and sessions are persisted in PostgreSQL. Featured activity and invite content remains clearly marked demo data.

## Backend integration points

`/assistant` calls the assistant recommendation endpoint and `/needs` loads the signed-in member's active memory. `/quests` shows durable engine runs when present and polished featured activities otherwise. Better Auth owns `/api/auth/*`; first-time Google users continue through `/register/complete`. Chat and profile APIs require the Better Auth session.

## Validation completed

- Full TypeScript type check, ESLint, Vitest, and optimized Next.js production build.
- 93 automated tests passed (5 skipped), including Better Auth password hashing/unique usernames, avatar optimization, demo-data gating, participant visibility, quest group-chat membership, quest chat notifications, and future-group expansion.
- Docker's Next.js build uses a disposable build-only Better Auth value; the runtime container always reads the real `BETTER_AUTH_SECRET` from Compose/environment.
- Responsive visual inspection at 390 px, 768 px, and 1536 px widths against both supplied mobile references and `desktop1.png`.
- Automated horizontal overflow checks on home, activities, activity details, my activities, invites, needs, messages, profile, and settings at all three widths.
- Visual review of onboarding, home, needs, recommendations, detail, invites, joined quests, messages, profile, and settings.
- Route and component structure audited to confirm the frontend is no longer a single-page state machine.
- Senior Quest's embedded conversation now reuses the shared message bubble/composer primitives used by direct and group chats. Guided quick replies sit above the shared composer, while Enter submits text answers (Shift+Enter keeps a newline). Verified at 390 px, 768 px, and 1440 px with direct-chat Enter-to-send and delivered-receipt checks.
- Activity visibility now uses explicit ISO start times: accepted suggested or invited activities move into My Activities, past suggestions are hidden, and pending past invitations stay visible as Expired.
- My Activities filters both demo and persisted quests by their real start time (including the Upcoming tab), and shows a clear empty state instead of placing future events in Past. Guided quick replies now share the assistant thread surface and the shared textarea composer vertically centers its placeholder.
- Matching now checks persisted active quest coordination before retrieval and immediately before invitation dispatch, so an accepted participant cannot be invited to another active quest. The guarded local database reset restores only the three community seed members and leaves accepted-quest state empty.
- Quest runs are visible to the initiator and every proposed participant in both list and detail APIs; unrelated members receive neither the run nor its participant details. Static quest/invite fixtures and demo neighbours are gated to the exact `test` display name, so normal accounts see only their own persisted activity state.
- Seeded Anne Lim and Cooking Buddies welcome conversations follow the same exact-`test` gate; normal accounts do not receive or see those demo chats. Accepted quest participants are added to one quest-keyed persisted group conversation as they accept.
- Quest participant snapshots now include the real member display name and profile photo after the access check. A participant's Accept/Reject action is persisted through coordination events; a newly created match sends a direct member-to-member update and promotes the waiting Senior Quest thread with the matched role and quest details. Later acceptances announce the participant and role to the other invitees. Notifications are best effort and idempotent at the assistant-message level so chat failures cannot roll back a quest.
- Generated quest thumbnails use only the normal Gemini text model to produce a sanitized SVG. A neutral illustrated placeholder (`/assets/quest-placeholder.svg`) is shown immediately while the image is generated; there is no stock-photo or local-thumbnail fallback. Images are resized/cropped to 1200×675 WebP and addressed through an opaque cached API URL.
- Thumbnail generation runs after the quest is saved, so a slow or unavailable Gemini request never blocks the quest. It retries up to three times with a one-second delay, then leaves the neutral placeholder in place. A thumbnail update uses optimistic locking so it cannot overwrite a participant acceptance or other newer quest state.
- Image failures emit structured `quest_image.*` server events for provider start, empty/error attempts, retry exhaustion, storage, and optimistic-lock conflicts. Logs never include API keys, prompts, or image bytes; use `docker compose logs -f api | grep quest_image` and `LOG_LEVEL=debug` when diagnosing a provider refusal.
- Privacy and password security now share the preference page's single outer surface: controls are flat, section dividers are subtle, and mobile layouts keep full-width touch targets without nested bordered cards. Re-rendered at 390, 768, and 1440 px with no horizontal overflow.
- Gemini text and thumbnail roles now share the text-capable model: matchmaking, assistant work, and sanitized SVG thumbnail generation use the configured Gemini text model. Gemini image generation and its separate image endpoint are no longer called.
- A newly completed member request now checks active future quest runs before creating a new quest. Need, interest, and offer embeddings are scored against every current participant, then group-size, availability, consent, eligibility, validation, and safety rules are re-run before adding a pending invitation. The update is persisted with an optimistic-lock `participant_added` event in both stores, remains idempotent for the new participant's assistant request, and is rejected once the event start time has passed.
- Optional interest/offer vectors are now treated as missing signals rather than zero-similarity signals, so a member who only supplies a need can still join a closely matching open group. Proposal cards and details derive the displayed group count from the participant list, and human-review proposals without a coordination invitation no longer expose an invalid Accept button.
- Active accepted commitments now suppress duplicate assistant proposals, while past-start commitments no longer block a new request.
- Final authenticated browser sweep covered every app route plus login, registration, and landing at 390, 768, and 1440 px. It found and fixed a server/client hydration mismatch caused by a live assistant-row timestamp; the row now renders a deterministic “Now” label. The empty needs state now uses an authenticated 200 response instead of an expected 404. The rebuilt app reports no runtime exceptions, console errors, or horizontal overflow across the matrix.

Normal verification commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
