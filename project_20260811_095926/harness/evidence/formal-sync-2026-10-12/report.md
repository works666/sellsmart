# Formal `/game` browser acceptance

Date: 2026-10-12

## Mock browser run

`check-formal-sync.cjs` loads `/game` in Chrome through Playwright at 1440×900 and 390×844. It intercepts every `/api/**` request and builds the game state with `createProjectOneState()` / `toPlayerVisibleGameState()`. Game commands use the production `executeGameCommand()` reducer; chat and workflow model results are fixture responses. The mock never creates a real save, calls the database, or invokes an AI model.

The desktop and mobile mock run passed against local dev server `http://127.0.0.1:3012`.

- Overall plan: the first submission gets a synthetic 409, retry preserves its idempotency key, and the post-phone plan command succeeds after `end_phone_call` clears `activePhoneCall`.
- Phone: a connected call restores its selected contact, greeting, and phone workspace after reload. Returning to the overall plan sends `end_phone_call` first.
- Contact and messaging: the overview and five channels render; WeChat opens without submitting. Natural-language WeChat application, email/WeChat attachment payloads, preset Emoji insertion, and historical `read_no_reply` / `readStatus: 'read'` metadata are checked. The fixture selects a deterministic accepted reducer seed for the WeChat request.
- Visits: the unbooked risk confirmation, free preparation (0 AP), natural-language brief evaluation (2 AP), explicit preparation skip, and actual visit (3 AP) are exercised. The active meeting and NPC farewell restore after reload; the pleasant expression is derived from fixture attitude `pleasantness: 75`, and the final player reply closes the meeting with `responseAction: 'final_player_reply'` and no fabricated NPC reply.
- Responsive layout: both viewports passed horizontal-overflow checks. The mobile aside, organization chart, and main workspace stack in order. The latest screenshots show full-height organization rows and a separated overall-plan heading/card.

The only browser console error is the expected 409 from the deliberate conflict injection. The two visit confirmation dialogs are also expected and auto-accepted by the harness.

## Live smoke status

`check-live.ts` is the separate real auth/API/database browser smoke. It creates a unique ephemeral player, checks the real `/game` default/contact/reload flow, submits one real overall plan (1 AP) and visit preparation (0 AP, expected ready), reads the persisted runtime row, and removes that identity's game sessions in `finally`. A non-200 plan/preparation response now fails the process instead of returning success. Do not describe this as covered by the mock run.

The root agent's first production live run reached the contact overview but hit a strict Playwright selector that matched both the overview eyebrow and heading; its ephemeral session cleanup succeeded. The selector now targets the accessible heading. The root agent is rerunning the production smoke after a server workflow adjustment for a model `emptyresponse`; the final live result is pending and should be appended here by the root agent.

## Screenshots

- `after-global-desktop.png`, `after-contact-desktop.png`
- `after-email-desktop.png`, `after-wechat-desktop.png`, `after-phone-restored-desktop.png`
- `after-preparation-desktop.png`, `after-meeting-desktop.png`, `after-farewell-desktop.png`, `after-farewell-restored-desktop.png`
- `after-global-mobile.png`, `after-contact-mobile.png`
- `after-live-global.png`, `after-live-contact.png` are emitted only by the real live smoke.
## Final root verification

The root agent reran the complete mock against the final production build at http://127.0.0.1:3000: exit 0. Desktop and mobile screenshots were visually inspected, including global plan, contact overview, email composer, WeChat expression overlay, phone restore and visit flow. No page errors; the deliberate 409 and two visit confirmation dialogs are expected.

Final cached pnpm9 TypeScript, full ESLint, Next.js and tsup build passed. Related state, five-person, invitation, attachment, evaluation, metadata, preview, expressions and metrics regressions passed, including new formal preparation and chat costs tests. An independent read-only review confirmed the phone invitation fee, raw attachment fee, double-active session protection and expression thresholds were corrected.

Real single-save concurrency/replacement E2E passed. The final check-live.ts run exited 0: real authentication, new formal session, browser default/contact/reload, authoritative database reads, one detailed work plan saved for 1 AP, and one ready visit preparation saved for 0 AP; database version and runtime JSON matched both commands. The unique ephemeral sessions were deleted and cleanup was verified. Earlier live failures are retained as findings: strict UI locator, empty provider response, too many recommendations, and legitimate inadequate-plan rejection. The locator and workflow limits were fixed; the adequacy gate was retained and a concrete multi-step plan passed.

This does not claim live multi-turn chat, telephone dialogue, actual meeting AI or multiplayer broadcasting validation. No deployment or database migration occurred. Port3000 serves the final local production preview; temporary3012 was stopped.
