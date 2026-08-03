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
- 77 automated tests passed (5 skipped), including Better Auth password hashing/unique usernames and avatar optimization.
- Docker's Next.js build uses a disposable build-only Better Auth value; the runtime container always reads the real `BETTER_AUTH_SECRET` from Compose/environment.
- Responsive visual inspection at 390 px, 768 px, and 1536 px widths against both supplied mobile references and `desktop1.png`.
- Automated horizontal overflow checks on home, activities, activity details, my activities, invites, needs, messages, profile, and settings at all three widths.
- Visual review of onboarding, home, needs, recommendations, detail, invites, joined quests, messages, profile, and settings.
- Route and component structure audited to confirm the frontend is no longer a single-page state machine.
- Senior Quest's embedded conversation now reuses the shared message bubble/composer primitives used by direct and group chats. Guided quick replies sit above the shared composer, while Enter submits text answers (Shift+Enter keeps a newline). Verified at 390 px, 768 px, and 1440 px with direct-chat Enter-to-send and delivered-receipt checks.
- Activity visibility now uses explicit ISO start times: accepted suggested or invited activities move into My Activities, past suggestions are hidden, and pending past invitations stay visible as Expired.
- My Activities filters both demo and persisted quests by their real start time (including the Upcoming tab), and shows a clear empty state instead of placing future events in Past. Guided quick replies now share the assistant thread surface and the shared textarea composer vertically centers its placeholder.
- Matching now checks persisted active quest coordination before retrieval and immediately before invitation dispatch, so an accepted participant cannot be invited to another active quest. The guarded local database reset restores only the three community seed members and leaves accepted-quest state empty.
- Generated quest thumbnails use a separate, best-effort Gemini image agent with the existing server-side key. Images are resized/cropped to 1200×675 WebP, addressed through an opaque cached API URL, and fall back to the local activity image on any provider or storage failure.
- Privacy and password security now share the preference page's single outer surface: controls are flat, section dividers are subtle, and mobile layouts keep full-width touch targets without nested bordered cards. Re-rendered at 390, 768, and 1440 px with no horizontal overflow.
- Gemini text and image roles are separated: text matchmaking and assistant work use `gemini-3.1-flash-lite`, while quest thumbnails use `gemini-3.1-flash-lite-image` through the v1 `generateContent` endpoint with a 16:9, 1K image configuration. The model catalog and text endpoint both respond successfully; the configured key currently has zero image free-tier quota (HTTP 429), so the documented local-thumbnail fallback remains expected until image quota is enabled.
- Final authenticated browser sweep covered every app route plus login, registration, and landing at 390, 768, and 1440 px. It found and fixed a server/client hydration mismatch caused by a live assistant-row timestamp; the row now renders a deterministic “Now” label. The empty needs state now uses an authenticated 200 response instead of an expected 404. The rebuilt app reports no runtime exceptions, console errors, or horizontal overflow across the matrix.

Normal verification commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
