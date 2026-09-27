# Production Hardening Mission — Durable Status (survives context compaction)

Last updated: 2026-09-26 (session 4 — portal auth, cross-tenant disclosure, fabricated data, money authority; defects #15–#23)
Branch: `feat/cloudflare-workers` @ `b15fa9f`
Recovery points (DO NOT DELETE):
- `production-hardening-checkpoint-b15fa9f` -> b15fa9f
- `backup/working-tree-20260925` -> b15fa9f
- Stash `stash@{0}` applied with --index (pre-existing work, was restored)

## Dirty tree policy
- 41 tracked files modified/staged = PRE-EXISTING work from earlier hardening session (auth, middleware, signup restrictions, billing, Apollo, Shell/SupportChat, .env examples).
- Many untracked `*.test.ts` files = authored during this mission (kept).
- NEVER `git reset --hard`, `git clean -fd`, or discard these.

## Completed with evidence (prior sessions)
- Plan duplication fix: `getAllPlansFromDB` canonicalization (billing/subscribe, billing/plans, billingEntitlements).
- Dual signup authority resolved: `app_settings.signup_restrictions` is source of truth; env `ALLOWED_EMAIL_DOMAINS` demoted to fallback allowlist. Tests: `email-domain-policy.test.ts`, `access-control.test.ts`.
- Apollo integration architecture implemented (config/client/normalizer/route + tests). Suite green (26/26).
- Sidebar long-email fix (Shell.tsx) + SupportChat redesign + support route hardening.
- Focused regression: 73/73 green at last run (tier limits, subscribe, stripe-checkout, apollo, email-domain, plan catalog, credits, authz, access-control).

## Phase 11 — AI credit period limits (daily/weekly/monthly on INCLUDED credits)
- Status: IMPLEMENTATION COMPLETE · AUTOMATED VERIFICATION COMPLETE ·
  PRODUCTION-LEVEL VERIFICATION **COMPLETE for the DB layer** (real Postgres via PGlite),
  **PENDING** for the live AI-provider failure path (no provider key).
- Rule: monthly M -> weekly cap M/4 -> daily cap M/20. INCLUDED credits are capped per
  UTC day/week/month; PURCHASED credits BYPASS those caps and are only reached once included
  credits are capped/exhausted. An unlimited plan (-1) is never capped and consumes nothing.
- Files:
  - `aiCreditLimits.ts` — pure policy (cap derivation, period keys, orchestration), no DB import.
  - `aiCreditDb.ts` — the Postgres implementation of the injected deps.
  - `aiCreditGate.ts` — the single gate AI routes call (`authorizeAiRequest`).
  - `jobs.ts` — `ai_reply` gates on `authorizeAiRequest` and compensates if the AI throws.
  - `db/migrations/088_ai_credit_period_limits.sql` — schema.
- Verified against a REAL Postgres engine (PGlite = Postgres/WASM), migrations 080+086+088
  applied from disk, production modules wired to it (only the DB connection substituted):
  - `aiCreditLimits.pglite.test.ts` (10) — migration applies + re-applies, daily/weekly/monthly
    caps, day/week/month rollover, tenant isolation, release floors at 0, CHECK blocks
    negatives, zero cap = unlimited, and **40 concurrent attempts against a cap of 5 grant
    exactly 5**.
  - `aiCreditGate.pglite.test.ts` (10) — included consumed, purchased fallback, purchased NOT
    capped, no-subscription denial, unlimited consumes nothing, release compensates and is
    idempotent, 30-way concurrent included and 20-way concurrent purchased cannot oversell.
- STILL PENDING: compensation against a real AI provider (no key). Migrations not applied to
  the production Neon instance (no prod DB credentials).

## Defects found by independent adversarial review (fixed this session)
1. CRITICAL — unauthenticated forged contract-signing: `MockEsignProvider.verifyWebhook()`
   accepts any signature and `ESIGN_PROVIDER` defaults to `mock`; `/api/esign/webhook` had no
   production guard. Fixed with a 503 guard (`ALLOW_MOCK_ESIGN_WEBHOOKS`), mirroring payments.
2. CRITICAL — `/api/esign/mock-sign` (dev-only tool that fires forged `signed` webhooks) was
   mounted in production. Now 404s in production.
3. HIGH — `authorizeAiRequest` denied orgs with zero *included* credits, locking paying
   customers out of credits they had PURCHASED. Contradicted the core requirement. Fixed.
4. MEDIUM — `/api/marketing/stats` returned a RANDOM city as `lastSignupLocation`, shipped to
   users by `LiveSocialProof.tsx` as a fake "someone just signed up" alert. Now null.
5. MEDIUM — same endpoint published the exact customer count to anonymous visitors. Removed.
6. LOW — unauthenticated step-out confirm leaked internal error text and served a cacheable
   response containing a one-time token. Now `no-store` + `no-referrer` + generic 500.

## Defects found by independent adversarial review (session 2 — EXPANDED sweep)
The six session-1 findings were treated as evidence the METHODOLOGY works, not as the
complete list. A second, broader sweep (3 new scanners) found 4 more.

| # | Sev | Defect | Where | Fixed |
|---|-----|--------|-------|-------|
| 7 | **CRITICAL** | **Cross-tenant data leak.** `/api/analytics/advanced` (2186 lines) resolved NO organization and filtered NO query. Any authenticated user of any tenant could read every tenant's funnel, pipeline value, avg deal value, ROI and geographic performance. 16 SQL templates, all unscoped. | `analytics/advanced/route.ts` | **Y** — all 16 scoped; structural test enforces completeness |
| 8 | **CRITICAL** | **Same class, second instance.** `/api/analytics/ai-recommendations` called `getOrganization()` but never used it in any of its 5 queries — cross-tenant funnel data fed directly into AI recommendations. | `analytics/ai-recommendations/route.ts` | **Y** — all 5 scoped |
| 9 | **HIGH** | **IDOR / missing ownership check.** `/api/actions/[id]` org-scoped the ACTION row but its `getEntityData`/`executeAction` helpers resolved leads, campaigns, contracts and conversations by bare id with no org predicate. `executeAction` accepted `organizationId` and never used it in any SQL. | `actions/[id]/route.ts` | **Y** — 14 lookups + mutations scoped |
| 10 | **MEDIUM** | **CSP blocks Cloudflare Web Analytics.** Found by real browser QA: the beacon from `static.cloudflareinsights.com` was rejected on 11/13 public routes, so Web Analytics silently collected nothing. | `next.config.js` | **Y** — script-src + connect-src allow it |

### New verification capability established (session 2)
- **Browser QA unblocked.** Prior sessions recorded "no installable browser". That was wrong:
  Microsoft Edge 153 is installed and Playwright drives any Chromium browser by path, so
  NO download is needed. 13 public routes + 3 viewports exercised against production.
  Result: 12/13 x HTTP 200, 0 JS page errors, **0px horizontal overflow at 375/768/1440**.
  The one systematic finding was the CSP bug (#10).
- **Load/performance harness with a safety gate.** `scripts/perf-harness.cjs` REFUSES
  concurrency against any non-local host without explicit authorisation (verified: exit 2,
  zero requests sent). `measure` mode is low-volume sequential sampling and is safe.
  Production measurement: **36 requests, 0 errors**, p50 57–917ms, p95 up to 1029ms.
  Concurrency numbers are NOT claimed — no staging target exists.
- **Tenant isolation proven on real Postgres** with two synthetic orgs (ORG A / ORG B),
  7 tests: A cannot read B's leads/pipeline/credits/AI counters, and an unscoped query IS
  shown to leak, so the filter is demonstrably load-bearing.

See `docs/superpowers/MASTER-REQUIREMENTS-MATRIX.md` for the full traceability matrix.

## Defects found by continuing class sweeps (2026-09-26 session 3)
The Finding 13 residual (`sms/inbound:101` simulator-secret `!==`) was fixed and, per the
methodology (fix the class, not the instance), swept across the whole tree.

| # | Sev | Defect | Where | Fixed |
|---|-----|--------|-------|-------|
| 11 | **HIGH** | **Fail-open cron auth.** `if (CRON_SECRET && provided !== CRON_SECRET)` skipped authentication entirely when the env secret was unset — unauthenticated trigger for bulk campaign automation. | `campaigns/automation/cron/route.ts` | **Y** — fails closed outside development; timing-safe |
| 12 | **HIGH** | **`Bearer undefined` acceptance.** `authHeader === \`Bearer ${cronSecret}\`` accepted the literal string when `CRON_SECRET` was unset in production. | `pipeline/cron/route.ts` | **Y** — fail closed in prod; timing-safe |
| 13 | MED | Non-constant-time secret comparison (timing oracle) at **12 sites / 9 files** (sms+keyword inbound, opt-out, email inbound/ses-events, cron earnings+system cron, jobs process, authz ×2, organization-context). | see matrix §8 | **Y** — shared `timingSafeSecretEqual` (SHA-256 → `crypto.timingSafeEqual`, fails closed on empty/missing) |
| 14 | LOW | `DEPLOY.md` told operators to subscribe `/api/sms/inbound?secret=...` for Twilio/SNS — the route never reads `?secret=`; SNS belongs on `/api/sms/sns-inbound`. | `DEPLOY.md` | **Y** — corrected with auth-model notes |

Ratchet: `src/app/api/__tests__/security/secret-compare-guard.test.ts` (static scan, fails the
build on any raw `===`/`!==` against a secret-shaped operand, asserts all 12 call sites keep
the helper import). Evidence: full vitest **202 files / 2301 passed / 0 failed**; new
`secretCompare.test.ts` (8); `tsc --noEmit` clean. Accepted residual: `?s=` query-param secret
for email/SNS providers (URL-only configuration; header preferred where supported).

## Defects found by continuing class sweeps (2026-09-26 session 4 — portal, tenancy, fabrication, money)

Session 3's secret-compare sweep exposed a METHODOLOGY, not just a list: every finding
was re-expressed as a class ("who else does this?") and swept. Session 4 applied the same
method to four more classes — unsigned public credentials, cross-tenant disclosure,
fabricated data, and caller-controlled money — and found 8 more defects.

| # | Sev | Defect | Where | Fixed |
|---|-----|--------|-------|-------|
| 15 | **CRITICAL** | **Unsigned, unauthenticated seller portal.** `/api/portal/offer` treated base64url("leadId:action:ts") as a credential (no signature, no expiry check) and ALSO accepted a bare `?leadId=` with no token at all on GET, and NO credential on POST — so anyone could read any tenant's offer (owner name, address, valuations, offer amount) and mutate it (`accept`/`counter`/`decline`, status flips + negotiation_queue inserts) for any lead id. | `portal/offer/route.ts`, `campaigns/templates/autonomous-mvp.ts` (token minted unsigned) | **Y** — new `utils/portalToken.ts` (HMAC-SHA256 + timing-safe compare + 14-day TTL), GET/POST require signed token OR session scoped by org, token is bound to leadId+action, minting path signs. Fails closed without `PORTAL_TOKEN_SECRET`. |
| 16 | **HIGH** | `/api/portal/closing` session path (GET **and** POST) resolved the lead with `WHERE id = ${leadId}` — any authenticated user of any tenant could read or mutate another tenant's closing by id (docs, payment details, notary schedule). | `portal/closing/route.ts` | **Y** — session path now verifies lead ownership in the caller's org; token path unchanged (DB-stored random token bound to lead_id). |
| 17 | **HIGH** | **Cross-tenant leaderboard disclosure.** `/api/leaderboard` ranked EVERY account on the platform and returned name, revenue, deals, response rate to any authenticated user. | `api/leaderboard/route.ts` | **Y** — board, rank CTE and totalUsers all scoped to the caller's organization. |
| 18 | **HIGH** | **Fabricated leaderboard shown to real users.** `leaderboard/page.tsx` queryFn returned 20 invented people with invented revenue figures ("Alex Johnson, $125,000"), with no API call at all. | `(dashboard)/leaderboard/page.tsx` | **Y** — mock array deleted; page now calls the real API and renders an honest empty state ("Rankings appear here once deals close"). |
| 19 | **HIGH** | **Fabricated market data (comps).** `/api/comps` fell back to `generateSimulatedComps()` (random prices labelled `dataSource:'simulated'`) whenever no provider key was configured — i.e. always, in this deployment. Offers were derived from made-up comps. | `api/comps/route.ts` | **Y** — simulated comps behind `syntheticDataAllowed('ALLOW_SIMULATED_COMPS')` (dev-only); production now returns 503 `COMPS_UNAVAILABLE` instead of numbers. |
| 20 | **HIGH** | **Fabricated leads.** `lead-finder/public-sources/fetch` simulated leads whenever a provider key was missing; `lead-finder/public-pool` and `lead-finder/auto-expand` generated invented owners/addresses/distress scores — all of it inserted into `sourced_leads` as real inventory eligible for campaigns. | 3 routes | **Y** — `utils/syntheticData.ts` gate (`ALLOW_SIMULATED_LEADS`, dev-only); production generates nothing and says so. |
| 21 | **HIGH** | **Caller-controlled money (Stripe intent).** `/api/payments/stripe` POST created a real PaymentIntent for the caller-supplied `amountCents`, and its "existing payment" dedupe lookup was not org-scoped. | `payments/stripe/route.ts` | **Y** — fee resolved from the buyer contract via shared `utils/assignmentFee.ts` (parity with charge-assignment; 409 `FEE_NOT_DETERMINED` / `FEE_MISMATCH`), lookup org-scoped. |
| 22 | MED | `territories/[id]` PATCH/DELETE did an org-scoped existence check but then mutated with `WHERE id = ${id}` (unscoped) — a window for cross-tenant write on id collision/race. | `territories/[id]/route.ts` | **Y** — org predicate added to both mutations. |
| 23 | MED | `lead-finder/plan` inventory counts and `lead-finder/create-campaign` selection/claim (including caller-supplied `leadIds`) read `sourced_leads` with no tenant predicate. | 2 routes | **Y** — all 5 queries restricted to `source_id IN (lead_sources of this org, or platform-wide NULL-org sources)`. |
| 24 | **HIGH** | **Public funnel broken + orphaned leads.** `/api/consent/capture` (the public "get a cash offer" form) inserted leads without `organization_id`, which is NOT NULL (migration 030) — every submission threw (500), so inbound seller consent was never captured. Same class as BREAKAGE_TABLE #35. | `consent/capture/route.ts` | **Y** — captures attributed to the platform's primary organization (`utils/platformOrg.ts`, mirroring organization-context's fallback); upsert-by-email/phone now org-scoped; 503 with a precise error if no org exists. |
| 25 | **HIGH** | Same class, second instance: `/api/outreach/keyword-inbound` (the $0-acquisition inbound SMS funnel) inserted leads without `organization_id` — every keyword enrollment failed. | `outreach/keyword-inbound/route.ts` | **Y** — same attribution; ratchet added (below). |

| 26 | **HIGH** | **Fabricated inventory, class #20 re-opened.** Two more simulator consumers wrote invented owners/properties into `sourced_leads` with no flag check: `/api/campaigns/mega-launch` (3 INSERTs; every "lead" produced by `simulateBySourceType`) and `/api/lead-finder/scraper` (simulator is the DEFAULT mode — `USE_SIMULATOR_DEFAULT = true` — and the real-scraper path also fell back to the simulator whenever a scraper was missing, returned nothing, or threw). | 2 routes | **Y** — `mega-launch` 503s with `SIMULATED_LEADS_DISABLED` unless `ALLOW_SIMULATED_LEADS`; `scraper` degrades to real scraping only (`useSimulatorEffective`), and simulator fallbacks return a failure result instead of invented rows. New ratchet guards the class (below). |
| 27 | **CRITICAL** | **Driver transaction failure & mock desynchronization.** `src/app/api/utils/sql.ts` wrapped queries in an async function returning standard Promises, breaking Neon's strict `transaction()` requirement for `[Symbol.toStringTag] === 'NeonQueryPromise'`. Multi-statement batches threw in production while 116 tests mocked the utility wholesale. Simultaneously, `POST /api/withdrawals` reserved funds with undeclared `PENDING_WITHDRAWAL` status (violating check constraints), and legacy unit tests asserted sequential loose writes instead of the unified batch transaction contract. | `utils/sql.ts`, `withdrawals/route.ts`, `withdrawals.test.ts`, migration 091 | **Y** — Driver query wrapper preserves tag & parameters with lazy execution; added migration 091 widening check constraint; restaged withdrawal route and test suite to run as one atomic `sql.transaction` batch with pre-batch tax reads. Ratchet added: `sqlTransactionShape.test.ts`. |


Ratchet for #24/#25: `src/app/api/__tests__/security/lead-insert-org-guard.test.ts` statically
walks shipped source and fails the build if ANY `INSERT INTO leads` omits `organization_id`,
and asserts both public entry points keep using the shared resolver.

Ratchet for #26: `src/app/api/__tests__/security/synthetic-lead-gate.test.ts` statically walks
shipped source and fails the build if any consumer of `simulateBySourceType` / `generateMarketLeads` /
`simulateLeads` lacks a `syntheticDataAllowed` gate, and pins the two hardened routes
(3 tests, passing).

Class sweep (session 5, adversarial) — remaining route-level `... WHERE id = ${...}` mutations:
`actions/[id]` (org predicate on both statements), `feedback/[id]` (ownership check before delete),
`jv` orphan-cleanup (deletes only the contract inserted in the same request), `territories/[id]`
(org predicate on both), `campaigns/[id]/regions` (campaign verified against the org in both handlers),
`lead-finder/sources/[id]` (org predicate + requireAdmin) — all safe. `compliance.ts` and
`ghostErrorSweep.ts` DELETE globally by design (platform maintenance, not tenant data).
`integrations` keys `organization_id` with `session.user.id` in all four queries across both routes —
internally consistent, so no cross-tenant path; recorded as a modeling smell (user-scoped data stored
in a tenant column), not a defect.

Query-parameter token inventory (residuals reviewed, threat-modeled): `contracts/step-out/confirm?token=`
uses `crypto.randomBytes(32)` + 48 h expiry + DB-bound lookup + `Referrer-Policy` — accepted.
`email/inbound` and `email/ses-events` accept `?s=<shared secret>` (providers cannot send custom
headers) — accepted, with the recorded caveat that these secrets can appear in provider logs.
`esign/mock-sign` hard-404s in production. `portal/closing` and `portal/offer` are HMAC-signed.

Self-inflicted regression caught by the gate during this session (recorded for honesty):
the charge-assignment edit referenced `amount` inside `catch` where it is out of scope —
`tsc -p tsconfig.typecheck.json` failed, fixed by hoisting `resolvedAmountCents`.

**Verification (session 4):**
- `tsc -p tsconfig.typecheck.json --noEmit` → **EXIT=0** (run before and after the lead-finder edits).
- `yarn test src/app/api/__tests__/security` → **9 files passed / 0 failed** (adds
  `portal-token-guard.test.ts`: 9 tests — round-trip, legacy unsigned rejection, payload
  forgery, signature tamper, stale/future TTL, action binding, fail-closed with no secret,
  secret removal, malformed inputs).
- `yarn test src/app/api/payments` → 2 files passed.
- Full suite re-run → **207 passed / 1 skipped (208 files), 0 failed, EXIT=0**.
- New ratchets: `portal-token-guard.test.ts` (9) and `lead-insert-org-guard.test.ts` (2).

**Verification (session 5 — class sweep of #26 + suites re-run):**
- `yarn typecheck` (`tsc -p tsconfig.typecheck.json --noEmit`) → **EXIT=0** (after both route gates and the new ratchet).
- `yarn test src/app/api/__tests__/security` → **11 files passed / 0 failed, EXIT=0** (now includes `synthetic-lead-gate.test.ts`).
- Full suite re-run → **209 files passed / 1 skipped (210); 2340 tests passed / 23 skipped / 30 todo (2393); EXIT=0.**
- New ratchet `synthetic-lead-gate.test.ts` → 3/3 passing (class gate + both hardened routes pinned).
- CI enforcement: the root `.github/workflows/ci.yml` `web` job runs `yarn typecheck` + the full mocked
  suite on every `feat/**` push, so all ratchets above are merge-blocking, not advisory.


**Verification (session 6 — multi-tenant matrix, test repairs, CSP & security headers):**
- `tenant-isolation-2026-09-26.test.ts` test structure repaired: unblocked 5 shadowed TCPA & outreach tests; suite now passes **10/10 tests, EXIT=0**.
- Added `multitenant-matrix.test.ts` on real PGlite Postgres: **16/16 tests passing** across `leads/[id]`, `campaigns/[id]`, `territories/[id]`, `actions/[id]`, and `portal/closing`.
- Added CSP & Production Security Headers ratchet in `regression-guards.test.ts`: **7/7 tests passing**, enforcing `nosniff`, `DENY`, `X-XSS-Protection`, `strict-origin-when-cross-origin`, `Permissions-Policy`, `https://static.cloudflareinsights.com` in `script-src` and `connect-src`, and API `Cache-Control: no-store, no-cache, must-revalidate`.
- Verified Browser QA artifacts (`browser-qa-artifacts/`) and headless Edge execution against 13 routes and 3 viewports.
- Security ratchet suites: **12 files, 123 tests, 0 failures, EXIT=0**.
- Typecheck: `tsc -p tsconfig.typecheck.json --noEmit` → **EXIT=0**.


**Verification (session 7 — database driver & withdrawal atomic transaction semantics):**
- Restored Neon driver tagged-query contract in `src/app/api/utils/sql.ts`: preserved `[Symbol.toStringTag] = 'NeonQueryPromise'` and `parameterizedQuery` while retaining bounded retry for transient errors.
- Added migration `091_earnings_pending_withdrawal_status.sql` allowing legal status transition to `PENDING_WITHDRAWAL`.
- Fixed schema migration gap idempotency (`066_chatgpt_style_pricing.sql` and `073_earnings_escrow.sql`).
- Gated audit logging inside `withdrawals/route.ts` with `organization_id` bound to avoid aggregate oracle leakage.
- Restaged legacy tests in `withdrawals.test.ts` to mock pre-batch withholding queries and route batch queries via `mockBatch`.
- Added ratchet test: `sqlTransactionShape.test.ts` (4/4 passed).
- Test suites: `tax` + `withdrawals` + `earnings` + `sql` (7 files, 100 passed, 0 failed, EXIT=0).
- Security ratchet suites: 16 files, 157 passed, 0 failed, EXIT=0.
- Full Vitest suite: 225 test files passed, 1 skipped (2559 passed, 0 failed, EXIT=0).
- Typecheck: `tsc -p tsconfig.typecheck.json --noEmit` clean, EXIT=0.

Accepted residual (documented, not silently ignored): `closings.portal_access_token` rows
with `portal_token_expires_at IS NULL` never expire; token is random + DB-bound, but rotation
policy is an operator task. Recommendation: set expiry when minting.


- Stripe live/test-key verification: BLOCKED (no test credentials). Mock-provider coverage only.
- Apollo live API verification: BLOCKED (no APOLLO_API_KEY).
- Production Neon schema verification: BLOCKED (no prod DB creds). Migrations validated locally only.
- Shopify: deeper repo search performed; no integration found -> architecture doc + safe stub only.
- Live-domain browser E2E at dealswiftautomation.com: BLOCKED (no owner session/credentials supplied in env).

## Session 7 (2026-09-26) — CSRF choke point, client-secret defect, supply-chain audit

### Defect #28 — CSRF: no origin check on any `/api/*` route (FIXED)

**Root cause.** The session cookie is `sameSite: 'none'` (load-bearing for mobile
iframes — `src/lib/auth.ts` marks it DO-NOT-CHANGE), so a cross-site request
carries the victim's cookie. A `validateCsrf` helper existed but was called by
only **9** of ~274 routes; every other state-changing route (withdrawals,
earnings refund, tax settings, leads, campaigns, bank accounts…) was reachable
from a hostile page. `text/plain` and form submissions are CORS-"simple", so the
browser sends them **without a preflight**, and `request.json()` parses the body
regardless of content type — so "we return no CORS headers" did not protect
anything. No `Access-Control-*` header is set anywhere in the app (verified by
grep across `src/` and `next.config.js`).

**Fix.** `crossSiteRejection()` in `api/utils/csrfProtection.ts`, wired as the
first statement of `middleware()`. One choke point: every route, including ones
added later.

- Rejects unsafe methods (POST/PUT/PATCH/DELETE) whose `Origin` (or, absent
  Origin, `Referer`) is not the request's own host or a configured origin →
  `403 {error: 'Cross-origin request rejected'}`, `Cache-Control: no-store`.
- Explicitly allowed, each with a stated reason: safe methods; requests with
  **no** Origin and no Referer (webhooks, health probes, curl — browsers always
  send Origin cross-site, so absence marks non-browser traffic that never
  carries ambient cookies); `Authorization: Bearer df_*` (header-authenticated
  v1 API, mirroring the skip `validateCsrf` already applied).
- `x-forwarded-host` is read when building the request host set, because this
  repo deploys behind Cloudflare Workers: without it the internal `Host` would
  mismatch the browser Origin and **every mutation would 403 in production**.
- Also fixed a latent 500: `validateCsrf` did `new URL(origin)` unguarded, so
  the legal header value `Origin: null` (sandboxed iframe) threw. It now
  returns `valid: false`.

**Evidence.** `csrfOrigin.test.ts` (17 tests) + `middleware.test.ts` (4 tests,
wiring through real `NextRequest`) — 21/21 green, including proxy-deployment
allow case and the "forwarded host must not become a bypass" case. Full suite
with the gate live: **2595 passed / 0 failed, exit 0**. Typecheck exit 0.

### Defect #29 — reversible "token" in a client component (FIXED)

`components/compliance/CANSPAMFooter.tsx` is `'use client'` and defined
`generateCANSPAMFooterHTML()` building
`base64url(`${contactId}:${process.env.EMAIL_UNSUB_SECRET}`)`. Two problems: in
a client bundle the env var is `undefined`, so it silently fell back to a
hardcoded `'dev-secret'`; and base64 is an **encoding, not a MAC**, so any email
receiving such a link could decode the unsubscribe secret and forge tokens. The
function had no callers (the live path is `withCanSpamFooter()` in
`api/utils/emailDriver.ts`, which receives an already-minted server URL), so it
was removed along with the client-side `contactId:placeholder` token forging.
Removal is recorded in `components/compliance/index.ts`.

**Guard:** `api/__tests__/security/client-secret-scan.test.ts` — (A) no
`'use client'` file reads a non-`NEXT_PUBLIC_` secret-bearing env var, (B) no
shipped file reversibly encodes secret material, (C/D) the helper cannot come
back, (E) self-check that the detector still flags the original vulnerable line
(a ratchet that stopped detecting its own bug would be worse than none).
Two documented exceptions: RFC 7617 HTTP Basic auth (`smsDriver.ts` builds the
`Authorization` header server-side) and `portalToken.ts`, which base64url-encodes
the *payload* and HMAC-signs it with the secret as key.

### Requirement #2 — long username/email sidebar (test gap closed)

The `Shell.tsx` fix (`min-w-0` + `truncate` + `title`) had no test.
`components/Shell.test.tsx` renders the shell with a 300-character unbroken
email and pins the contract in both identity blocks (collapsed button and open
dropdown): `truncate`, correct `title`, and the `min-w-0` wrapper without which
`truncate` can never engage. jsdom performs no layout, so browser
confirmation remains outstanding — recorded, not claimed.

### Gate config gap: component tests were not in `yarn test`

`yarn test` runs `--config src/app/api/vitest.config.ts`, whose `include` was
`**/*.test.ts` only, and whose environment is `node`. No `.test.tsx` had ever
been collected (the repo had none), so the new `TaxReportPanel` tests would have
been silently excluded from the merge-blocking gate. `include` now also matches
`*.test.tsx`; each such file carries its own
`// @vitest-environment jsdom` docblock, so node remains the default.

### Supply chain: audit run (row was UNVERIFIED)

`yarn npm audit` (evidence kept: `docs/superpowers/evidence/audit-before-upgrade.json`
— 28 advisories — and `audit-after-upgrade.json` — 1):

| package | installed | advisories | severities | fixed in |
|---|---|---|---|---|
| better-auth | 1.5.6 | 10 | 1 critical, 5 high, 3 moderate, 1 low | 1.6.22 |
| next | 16.2.6 | 11 | 2 critical, 6 high, 3 moderate | 16.3.3 |
| nodemailer | 9.0.3 | 4 | 2 high, 2 moderate | 9.1.0 |
| ws | 8.20.0 | 2 | 1 high, 1 moderate | 8.21.0 |
| vitest | 3.2.6 | 1 | moderate | 4.1.11 (dev-only, major) |

Declared minimums in `apps/web/package.json` were raised to the fixed versions
so a fresh install cannot resolve to a vulnerable build again; lockfile bumped
to better-auth 1.7.6 / next 16.3.6 / nodemailer 9.1.1 / ws 8.22.0.

**Post-upgrade verification:** typecheck **exit 0** (so better-auth 1.7.6 and
next 16.3.6 are type-compatible with the shipped auth config) and full suite
**2597 passed / 0 failed, exit 0** (231 files) with the upgrades installed.
`yarn npm audit` afterwards reports **1 advisory instead of 28** — every
production-dependency advisory (better-auth, next, nodemailer, ws) is closed.

**`vitest` 3→4 was attempted and deliberately reverted.** It is the only
remaining advisory (GHSA-82fw-gwwq-j7x9, moderate, path traversal in the
dev-only mocker) and the only fix is a **major** bump. Measured result: **30
tests failed across 33 files** (e.g. `stripeProvider`, `bedrock-client`,
`seo-ratchet`, `valuation`) on vitest 4.1.11 — mock/hoisting semantics changed.
Shipping a suite that cannot gate the repo is worse than one moderate
dev-only advisory, so `vitest` stays at `^3.2.6` and the residual is recorded
here. It is a test-runner dependency: it does not ship to production and cannot
be reached by an attacker. Remediation is a dedicated task (migrate mocks file
by file, then re-run this audit), not a mid-mission risk.

## Rules reminders
- Evidence-only claims. Code inspection != verification.
- Financial logic: server-authoritative, atomic, idempotent.
- Smallest safe change; preserve all infrastructure.
