# Senior Quest frontend handoff

## What changed

The reference image is treated as a mobile design specification, not as a phone mockup. The application now renders directly in the browser viewport:

- Mobile: full-width pages with a fixed bottom navigation bar.
- Tablet and desktop: responsive content, card grids, and a top navigation bar.
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

## Modular structure

- `src/components/`: reusable application shell, navigation, cards, tabs, icons, menus, create-quest sheet, and local prototype state.
- `src/data/mock-data.ts`: all placeholder data.
- `src/types/quest.ts`: shared frontend types.
- `src/styles/`: split design system, base layout, navigation, components, and page styles.
- `src/app/(app)/`: separate route modules for each application page.

The placeholder state is stored in `localStorage` through `AppStateProvider`. Saving quests, accepting or declining invites, marking interest, opening the create flow, and placeholder settings actions work without a backend.

## Backend integration points

Replace the data in `src/data/mock-data.ts` with API requests. Keep the page and component interfaces stable where possible. The existing server and API files were not changed.

## Validation completed

- TypeScript syntax transpilation across the project.
- Strict frontend type check using local framework stubs because the package registry in this environment could not install the project dependencies.
- Responsive visual inspection at 360 px, 390 px, 768+ px, and 1280 px widths.
- Horizontal overflow checks returned matching scroll and viewport widths.
- Visual review of onboarding, home, needs, recommendations, detail, invites, joined quests, messages, profile, and settings.
- Route and component structure audited to confirm the frontend is no longer a single-page state machine.

Run the normal project checks in an environment where the package registry is available:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
