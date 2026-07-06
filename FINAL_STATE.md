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

## NOT DEPLOYABLE / DEAD CODE (quarantined)
Two engines previously reported as passing (the earlier **"GATE PASS 87/100"
claim is retracted by this finding**) are **not deployable** and are quarantined:

- **`src/app/api/outreach/variant-allocator.ts`** (A/B Thompson-sampling) and
  **`src/app/api/outreach/resurrection-engine.ts`** (30/60/90-day sequences).

Evidence:
1. **Backing tables exist in NO schema, NO migration, and NOT in the live DB.**
   Three tables are referenced and absent everywhere: `message_performance_ledger`,
   `resurrection_campaign_config`, `resurrection_sent_log`. An
   `information_schema` check against the live Neon DB returns none of them.
2. **Never wired to any runtime path** — neither engine is imported by any route,
   cron, job, gateway, service, or page (grep across `src` = 0 references outside
   the engines' own files and tests). They are dead code.
3. **The in-file `ensurePerformanceLedgerSchema()` / `ensureResurrectionSchema()`
   DDL is never called**, so the tables are not created at runtime either.
4. **`ResurrectionEngine.getConfig()` reads `(config as any).rows`**, but this
   codebase's `sql` returns a plain array — so `.rows` is always `undefined` and
   `getConfig()` returns hard-coded defaults unconditionally, even if the table
   existed with saved config.

Making them real is deferred to a dedicated build session (migration 004 for the
3 tables + the `getConfig()` fix + runtime wiring + behavioral tests), NOT done
under this feature freeze. A **hermetic quarantine guard**
(`src/app/api/__tests__/quarantine-guard.test.ts`) fails CI if any runtime file
imports either engine, so the quarantine can't rot silently — delete that guard
in the same PR that makes the engines real.

## Skipped-test ledger (relabeled)
- **Tests 1–15 = MISSING_SCHEMA (quarantined)** — `variant-allocator.test.ts`
  (4) + `resurrection-engine.test.ts` (11). Query tables that exist in no schema,
  no migration, and not in the live DB; owning engines are quarantined dead code.
- **Tests 16–19 = LIVE_GATED** — `sms-gateway.test.ts` opt-out suppression (1) +
  `flows-live.test.ts` (3). Their tables exist; they only need a live DB/creds
  (`DATABASE_URL` / `RUN_LIVE_FLOWS=1`).

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
- **oxlint** RESOLVED: the repo-root `.eslintignore` (a blanket `*`) made oxlint
  silently scan 0 files and falsely pass. The CI step now uses `--no-ignore`
  (scoped to `apps/web/src`) and scans 204 files — CI log shows "84 warnings and
  0 errors". The 84 warnings are pre-existing unused-import/var noise (non-blocking
  by severity); the one deny-severity error it surfaced (a wizard `useEffect`
  missing-dep) was fixed.
- **19 skipped tests**: 15 = MISSING_SCHEMA (quarantined, see above), 4 = LIVE_GATED
  (need a live DB / `RUN_LIVE_FLOWS`).

## Deploy Correctness — Fresh DB Bootstrap ✅
**Fixed during verification sprint 2026-07**: The schema bootstrap (`schema.sql` +
`campaign-pipeline-schema.sql` + migrations 001–003) previously failed on truly
fresh Neon test databases with psql exit code 3. Root-cause: `campaign-pipeline-schema.sql`
created PostgreSQL ENUMs (campaign_direction, campaign_status, contact_status,
owner_range_request_status, message_template_kind) with bare `CREATE TYPE`
statements, which fail on re-runs but also could fail in certain contexts.

**Fix applied**: Wrapped all `CREATE TYPE` statements in PostgreSQL `DO` blocks
that check `pg_type` table first, making the schema idempotent and compatible
with all PostgreSQL versions (including pre-13, which don't support `CREATE TYPE
IF NOT EXISTS`).

**Permanent guard**: The e2e CI job (`e2e` in `.github/workflows/ci.yml`) now
runs the bootstrap against a fresh Neon test branch on every push/PR. This is
the definition of a fresh-deploy test — if the bootstrap succeeds and the 10-step
journey passes, the schema is deployable. The bootstrap is documented in the
workflow with the exact file order:
1. `schema.sql` (base tables)
2. `campaign-pipeline-schema.sql` (enums + campaign pipeline tables)
3. `migrations/001_add_missing_tables.sql` (GUI/API tables + optionality)
4. `migrations/002_pause_ai.sql` (leads.ai_paused column)
5. `migrations/003_auth_tables.sql` (better-auth schema)

All files are idempotent; safe to re-run. A failure here blocks the merge.

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
