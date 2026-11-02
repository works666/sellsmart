# Formal and prototype timer acceptance

Date: 2026-10-12

This evidence folder is for the formal `/game` and the five-person prototype timer rules: a 20-minute project budget, five action points restored at each five-minute boundary up to 28, an actual visit pause, 15 seconds charged per visit turn on exit, and automatic settlement at timeout.

## Acceptance scripts

- `check-state-timer.cjs` exercises the production state reducer and timer projection helpers for the initial budget, recovery boundaries, action-point cap, visit pause, twenty-turn charge, timeout, and refresh idempotency.
- `check-browser-timer.cjs` uses Playwright with mocked API responses to load formal `/game` and the prototype, inspect the desktop two-column layout and mobile overflow, open the project notice, read the countdown, and adjust prototype remaining time/action points. It does not create a real game save or call a model.
- `check-live-timer.ts` creates an isolated player and formal save, checks the 20-minute timer and version-stable GETs, admin-seeds only that ephemeral runtime row just before the five-minute boundary with 27 points, and verifies the real API caps the refill at 28 without repeating it or advancing the version on a second sync. It then uses real `start_visit` / `end_visit` commands to verify pause persistence across reads and refresh, and finally races timer-sync requests against a test-only deadline seed to verify a single persisted settlement. Its `finally` block removes and verifies deletion of the test user's game sessions. It does not call AI/model endpoints.
- `check-late-ai-timer.ts` uses two isolated temporary players and real model-backed APIs once each: one detailed `work_plan` command and one email outreach. Each runtime timer is seeded with 0.5–2 seconds remaining immediately before dispatch. It requires the API to report the post-evaluation deadline guard, then reads the same persisted runtime, `final_report`, deadline event, action points, plans, command records, and chat rows. Provider or ambiguous chat errors fail the check; they are never counted as an AI-timer pass. Both temporary users' game sessions are removed and verified in `finally`.

## Run commands

From `projects/` after the target build is available:

```powershell
node ..\harness\evidence\game-timer-2026-10-12\check-state-timer.cjs
$env:E2E_BASE_URL = 'http://127.0.0.1:3000'
node ..\harness\evidence\game-timer-2026-10-12\check-browser-timer.cjs
pnpm exec tsx ..\harness\evidence\game-timer-2026-10-12\check-live-timer.ts
pnpm exec tsx ..\harness\evidence\game-timer-2026-10-12\check-late-ai-timer.ts
```

## Run status

The root agent reran and passed `check-state-timer.cjs`, `check-browser-timer.cjs` (desktop 1440×900 and mobile 390×844), and `check-live-timer.ts`. The live check verifies persistent 20-minute budget, stable GET versions, capped and idempotent AP recovery, actual visit pause/resume, concurrent deadline settlement, terminal lock cleanup, and refresh. Temporary real saves were deleted and verified. Representative formal/prototype desktop, formal mobile and notice screenshots were visually reviewed by the root agent.

Root timer and competitor-checkpoint scripts, the eleven-function RPC permission migration check, and isolated dual-account multiplayer E2E pass. Full TypeScript, ESLint and Next/tsup production build pass. Migration 20261012000100 was applied transactionally to the linked development database; authoritative permission checks show all eleven RPCs reject anon/authenticated execution and permit service_role.

`check-late-ai-timer.ts` was not executed: automatic approval review rejected sending the test project context to an external AI service without confirmed authorization. It has no real model results. A separate local-model stub regression in `projects/scripts/test-timer-late-ai.ts` invokes the actual route handlers without external AI or database access; its final run status is recorded below when available. Mock browser results cover rendering and local interaction, while the live timer and multiplayer runs cover the actual API/database behavior.

Root reran `node -r tsx/cjs scripts/test-timer-late-ai.ts`: PASS. Actual command/chat route handlers reject late work plans, natural-language invitations and ordinary email replies without committing business or chat effects; an already-expired epoch settles before any model evaluation; a paused visit final acknowledgement applies its full turn debit and settlement atomically. Full TypeScript check including the new script passes.
