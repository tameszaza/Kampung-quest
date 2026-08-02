# Senior Quest UI handoff

The frontend is implemented as a mobile-first interactive prototype in `src/app/page.tsx` with the complete reference flow:

1. Welcome / onboarding
2. Home dashboard
3. My Needs
4. Recommended Quests
5. Quest Details
6. My Invites
7. My Quests
8. Messages
9. Profile
10. Settings & Safety

All data is placeholder state stored in the page component. The central plus button opens a functional create-quest bottom sheet. Accept, decline, save, interest, tabs, profile menu and settings interactions are wired locally so every UX path can be tested without a backend.

Reference-derived local image assets are under `public/assets`. The UI system is defined in `src/app/globals.css` with senior-friendly sizing, high contrast, large touch targets and responsive desktop phone framing.
