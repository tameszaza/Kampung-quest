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
- 49 unit and PostgreSQL integration tests, including Better Auth password hashing/unique usernames and avatar optimization.
- Docker's Next.js build uses a disposable build-only Better Auth value; the runtime container always reads the real `BETTER_AUTH_SECRET` from Compose/environment.
- Responsive visual inspection at 390 px, 768 px, and 1536 px widths against both supplied mobile references and `desktop1.png`.
- Automated horizontal overflow checks on home, activities, activity details, my activities, invites, needs, messages, profile, and settings at all three widths.
- Visual review of onboarding, home, needs, recommendations, detail, invites, joined quests, messages, profile, and settings.
- Route and component structure audited to confirm the frontend is no longer a single-page state machine.

Normal verification commands:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
