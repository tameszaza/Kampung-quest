# Senior Quest QA remediation report — 2026-08-08

This is the focused follow-up to [the full 240-case catalog](./test-cases.md) and [the 7 August report](./test-results-2026-08-07.md). The highest-impact failure was the real Gemini assistant pausing after a model response used a human-formatted recurring time such as `9:00 AM` or an otherwise malformed optional recurring rule.

## Remediation

- Hosted assistant output now has a tolerant boundary for optional model echoes.
- User answers remain authoritative for availability, constraints, consent, and the saved brief.
- Valid recurring rules are normalized to the strict `weekly_recurrence` / `HH:mm` contract.
- Malformed optional recurring rules are dropped and logged as `agent.output.recovered`; they no longer fail the whole turn with a 503.
- Invalid optional model soft facts are ignored rather than replacing authoritative user input.
- The responsive home dashboard's hidden fill-image wrapper is positioned at every viewport, removing the Next Image parent warning.
- The above-fold home hero image is marked eager to avoid the LCP warning.

## Verification

| Check | Result |
| --- | --- |
| Focused Gemini/runtime and assistant service tests | **PASS — 26/26** |
| Full env-loaded Vitest suite | **PASS — 44 files, 254 tests** |
| Typecheck | **PASS** |
| Lint | **PASS — 0 errors, 11 existing warnings** |
| Production build | **PASS** |
| `git diff --check` | **PASS** |
| Real Gemini mobile lifecycle | **PASS** — 12 decisions plus confirmation; every assistant turn and confirm returned HTTP 200 |
| Real Gemini paused/error assertion | **PASS** — no `Senior Quest paused`, no `NetworkError`, no page/console errors |
| Responsive home smoke at 390×844 and 1440×900 | **PASS** — no horizontal overflow and no page/console errors |
| Chat/activity request observation | **PASS** — no request storm during the lifecycle; polling remained bounded and delta message loading stayed active |

## Browser evidence

Screenshots were captured under `docs/test-evidence/2026-08-08/` during the real Gemini run, including:

- `gemini-after-fix-lifecycle-start.png`
- `gemini-after-fix-lifecycle-01.png` through `gemini-after-fix-lifecycle-11.png`
- `home-390.png` and `home-1440.png`

The evidence directory is intentionally ignored by Git so local QA captures do not enter application commits.

## Remaining follow-up

The full catalog still contains the previously documented blocked lifecycle cases requiring a disposable reset/seed fixture, including two-persona invitation/arrangement flows, profile mutations, and the 15-persona browser matrix. The earlier matrix was rate-limited after six logins; this is a test-environment limitation, not an observed application failure. No database reset was performed during this remediation.
