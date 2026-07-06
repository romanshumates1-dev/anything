# DealFlow AI — Verified Milestone (`v1.0.0-verified`)

Frozen state of the verification sprint. Every "code shipped, tests green" claim
was replaced with a behavioral test that fails when the feature is broken, four
ghost/inert features were discovered and built, and a 10-step E2E journey now
guards the full campaign→inbox→approvals pipeline in CI.

## Test counts
| Suite | Result |
|---|---|
| TypeScript (`tsconfig.typecheck.json`, CI gate) | **exit 0** |
| TypeScript (plain `tsc`, source only) | **exit 0** |
| oxlint (`.oxlintrc.json`) | **0 errors** |
| Unit + integration (vitest) | **242 passed / 19 skipped** (261 total, 34 files) — was 190/19 at sprint start |
| Playwright E2E (10-step journey) | **3/3 green** (~6.5s each) |

52 new behavioral tests were added; each was demonstrated to FAIL on a
deliberate break and pass again on restore (non-vacuous).

## E2E status
`apps/web/e2e/journey.spec.ts` — one spec, the full journey, **3/3 consecutive green**:
login → wizard (Step 1–4) → enable Test Mode → launch → **TEST badge on /campaigns**
→ signed Twilio inbound webhook → **/inbox shows the lead** → open thread →
**reply renders** → seed owner-range approval → **approve from /approvals** →
assert **negotiation unblocked in DB** (`AWAITING_OWNER_RANGE → NEGOTIATING`, price
ladder written).

Harness: `playwright.config.ts` (`yarn test:e2e`). Local runs drive the system
Edge browser (`channel: msedge`) because the Playwright chromium download is
blocked by TLS interception in the authoring environment; CI sets
`PW_CHANNEL=chromium` to use the bundled browser.

## Lighthouse (production build, desktop preset)
| Route | Performance (before → after) | Accessibility | Best-Practices |
|---|---|---|---|
| `/` | 62 → **72** | 92 | 96 |
| `/campaigns` | 53 → **66** | 91 | 96 |
| `/campaigns/wizard` | 53 → **67** | 91 | 96 |
| `/inbox` | 57 → **77** | 96 | 96 |

Fix applied (top opportunity): removed a render-blocking, entirely-unused
FontAwesome Pro stylesheet from the root layout (~1000 ms unused CSS; the app
uses `lucide-react`). Accessibility and Best-Practices exceed 85 on all four
routes. (Dev-server performance was ~30; production is the meaningful measure.)

## Ghost/inert features found and built (audit trail)
These were reported "PASS ✅" in earlier phases but had **no working backend** —
earlier GUI phases were built and "verified" against routes/behaviors that did
not exist, and unit suites passed vacuously by mocking the missing layer. The
E2E journey is what surfaced them; it now runs in CI so this cannot recur.

- **Item 4 — rate limiting**: was inert dead code (never wired as middleware,
  keyed per-IP, headers set on the wrong response). Rebuilt as a per-KEY sliding
  window, wired (`matcher: /api/v1/*`, docs page exempt), 401 before budget,
  `Retry-After` + `X-RateLimit-*` on the returned response.
- **Item 6b — pause-AI**: no column, no toggle route (UI hit a 404), inbound
  enqueued no AI job. Built `leads.ai_paused` + `/api/leads/[id]/ai` + inbound
  `ai_reply` enqueue gated on pause + a safe (no-send) `ai_reply` job handler.
- **Item 8 — OpenAPI**: `/api/openapi` did not exist (Swagger UI at `/api/v1/docs`
  pointed at a dead URL). Built a static OpenAPI 3.0.3 doc (7 v1 resource groups,
  Bearer scheme).
- **Approvals tail (the money queue)**: `/approvals` called `/api/approvals` +
  `/api/approvals/[id]`, neither of which existed. Built both — org-scoped,
  idempotent, with negotiation-unblock (writes the price ladder, flips the
  contact out of `AWAITING_OWNER_RANGE`, enqueues the next AI turn). Includes a
  dedicated org-isolation test (another org's approval is invisible → 404, no
  side effects).
- Supporting fixes the journey forced: `/campaigns` read the legacy `campaigns`
  table with no TEST badge → repointed to `/api/outreach/campaigns` (distinct
  react-query key to avoid a Shell dedupe collision); conversation thread read
  `message_events` instead of `ai_conversations.history`; inbox link used
  `conversation.id` instead of `lead_id`; Next-16 async `params` (Promise) read
  synchronously in several routes + the inbox `[leadId]` client page.

## CI (`.github/workflows/ci.yml`) — the permanent guard
On every push / PR to `main`:
1. **web** — `yarn install --immutable` → typecheck (shipped code) → **oxlint** →
   full unit/integration suite.
2. **e2e** — applies schema + migrations to a Neon test branch, installs
   Playwright + chromium, runs the **10-step journey**. A failure **blocks the
   merge**. Requires the `TEST_DATABASE_URL` repo secret.
3. **flows-live** — Layer-C live flow runner (existing).

## Known limitations
- **Lighthouse Performance 66–77 (<85 target)** on localhost, single-core-CPU-
  throttled runs. Accessibility/Best-Practices pass. Closing the gap needs
  framework-JS/code-splitting work beyond a one-line fix — a follow-up.
- **Live-cred OTP** (item 3 real SMS send/verify against Twilio) still needs a
  manual check with live credentials. Its limit *logic* is behaviorally tested.
- **Pre-existing dynamic routes still use synchronous Next-16 `params`** (cancel,
  contacts, pause, resume, stats, `settings/api-keys/[id]`, `test-phones/[id]`).
  Not touched this sprint (out of scope). They surface only in a build-time route
  validator (`.next/types`), not the CI typecheck — a follow-up.
- **`@playwright/test` is not in `yarn.lock`** (registry TLS blocked in the
  authoring env); the CI e2e job installs it explicitly. Locally it lives in
  `node_modules` via an isolated-npm install.
- **oxlint** currently reports 0 errors but also scans 0 files in the authoring
  environment (path/ignore resolution quirk under Yarn Berry) — verify it scans
  sources on the first real CI run.
- 19 tests are DB/live-cred-gated skips (see the skipped-test audit in the
  session ledger); 15 additionally need tables absent from the repo schema and
  require a fully-provisioned Neon branch.

## Environment variables for live operation
Set in `apps/web/.env` (git-ignored) or the deploy environment:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection (app + auth) |
| `BETTER_AUTH_SECRET` | better-auth session signing |
| `BETTER_AUTH_URL` | e.g. `http://localhost:4000` / prod URL |
| `JOB_RUNNER_SECRET` | authenticates the worker → `/api/jobs/process` |
| `SMS_INBOUND_SECRET` | inbound SMS webhook auth (`x-sms-secret`) |
| `CRON_SECRET` | cron worker → `/api/system/cron` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio API + inbound signature validation |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio Messaging Service |
| `TWILIO_NUMBER_TYPE`, `OWNER_NUMBER` | number config + owner short-circuit |
| `TWILIO_10DLC_ASSIGNED_MPS`, `TWILIO_10DLC_TMOBILE_DAILY_CAP` | 10DLC throughput caps |
| CI only: `TEST_DATABASE_URL` (repo secret) | Neon test branch for e2e + flows-live |
