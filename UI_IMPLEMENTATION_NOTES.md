# Senior Quest UI implementation notes

> This handoff describes the current UI. For the complete route and behavior map, read [`docs/current-web-state.md`](docs/current-web-state.md). For the edit map, read [`docs/developer-guide.md`](docs/developer-guide.md).

## Current shell

- `/` redirects to `/login`; there is no separate public landing page.
- Authenticated routes are protected by [`src/app/(app)/layout.tsx`](src/app/%28app%29/layout.tsx).
- Mobile uses a full-width layout with fixed bottom navigation.
- Tablet and desktop widen the content; desktop uses a persistent left navigation from 1024px.
- The “Talk to Senior Quest” action opens the assistant inside `/messages?assistant=1`.
- `/assistant` is a compatibility redirect to that embedded assistant.

The main shell and navigation live in [`src/components/app-shell.tsx`](src/components/app-shell.tsx). Do not add page-specific navigation to individual screens unless it is a deliberate detail action.

## Route ownership

| Screen | Route file | Main UI owner |
| --- | --- | --- |
| Home | `src/app/(app)/home/page.tsx` | Same page; dashboard cards are intentionally composed here |
| Needs | `src/app/(app)/needs/page.tsx` | `src/components/user-memory-view.tsx` |
| Activities | `src/app/(app)/quests/page.tsx` | `src/components/activities-page.tsx` |
| Quest detail | `src/app/(app)/quests/[slug]/page.tsx` | `src/components/event-quest-detail.tsx` |
| My Activities | `src/app/(app)/my-quests/page.tsx` | `src/components/my-quests-page.tsx` |
| Messages | `src/app/(app)/messages/page.tsx` | `src/components/chat-center.tsx` |
| Assistant | `/assistant` redirect + Messages query | `src/components/assistant-conversation.tsx` |
| Profile | `src/app/(app)/profile/page.tsx` | Page plus `profile-photo-editor.tsx` |
| Settings | `src/app/(app)/settings/page.tsx` | Page plus `security-settings.tsx` |
| Rewards | `src/app/(app)/rewards/page.tsx` | `src/components/rewards-page.tsx` |
| Partner preview | `src/app/partners/page.tsx` | `src/components/partner-rewards-page.tsx` |

## State ownership

Persisted activity state comes from `/api/v1/activities` and event quest routes. The browser may hold loading state, selected tabs, draft input, and transient toasts, but it must not decide invitations, membership, final schedules, task approval, or reward balances.

Demo fixtures in [`src/data/mock-data.ts`](src/data/mock-data.ts) are intentionally gated by [`src/lib/demo-access.ts`](src/lib/demo-access.ts) to the exact username `test`. They are not a fallback for a failed request.

## Styling ownership

[`src/app/globals.css`](src/app/globals.css) imports the split style system:

- [`src/styles/tokens.css`](src/styles/tokens.css) — colors, type, spacing, and shared variables.
- [`src/styles/base.css`](src/styles/base.css) — document defaults and shared layout primitives.
- [`src/styles/navigation.css`](src/styles/navigation.css) — app shell, desktop nav, and bottom nav.
- [`src/styles/components.css`](src/styles/components.css) — reusable buttons, cards, controls, and chat primitives.
- [`src/styles/pages.css`](src/styles/pages.css) — route-specific page layouts.
- [`src/styles/rewards.css`](src/styles/rewards.css) — rewards and partner surfaces.

Keep responsive rules with the owning style sheet. Avoid adding a second copy of a component style to `src/app/globals.css` or layering overrides across unrelated files.

## Accessibility and responsive expectations

- Keep visible labels and useful `aria-label` text on icon-only controls.
- Preserve keyboard access for dialogs, tabs, switches, chat composers, and action buttons.
- Respect the `data-text-size` and `data-contrast` document attributes set by the app shell.
- Keep touch targets full-width and comfortable on mobile.
- Check at 390px, 768px, and 1440px widths after significant UI changes.
- Avoid nested bordered cards; use spacing, background changes, and subtle dividers to establish hierarchy.

## UI verification

Run the normal project checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Then perform a browser sweep of login, registration, home, needs, activities, quest detail, My Activities, Messages, Profile, Settings, Rewards, and the partner preview at the three widths above. Check for console errors, hydration warnings, clipped content, broken keyboard flow, and unexpected demo content.
