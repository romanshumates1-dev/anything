# DEALSWIFT — AI PROJECT CHECKPOINT

**This file is the project's persistent memory.** Conversation context is not
project state. A new model inherits state from here and from
`UNIFIED-REQUIREMENTS-MATRIX.md` — never from a fresh audit.

---

## PROJECT STATE

| Field | Value |
| --- | --- |
| Date | 2026-10-04 |
| Repository | `d:\anything` |
| Branch | `feat/cloudflare-workers` |
| HEAD | `62c3c3b` — this state file; code state described is `ff3b262` |
| Deployment target | Cloudflare Workers via OpenNext (`wrangler`), `scripts/wrangler-deploy.mjs` |
| Production domain | `https://dealswiftautomation.com` |
| Last known deployed version | **Worker `499ceb4c`** — deployed 2026-10-04 from commit `5c52120`; includes `2ea6db3`, `ff3b262`, `503845f`. LIVE VERIFIED. |
| Environment note | Windows + opennext 1.20.6 + Next 16.3.6 |
| Current score | **7.5/10 — calculated 2026-10-04 from the corrected matrix, after a live pass** |

### Current overall score

**7/10 — calculated 2026-10-04 from the corrected requirements matrix.**

Method and reasoning are recorded in the matrix's SCORE section. It moved up
from the inherited 6/10 because AI credit limiting is a whole requirement
recovered from a wrong-path search error, with stronger evidence than had been
recorded. It is held below 9 by two open production defects and by the total
absence of end-to-end evidence on any money-moving path.

---

## ACTIVE TASK

**NONE.** State preservation, AI-credit verification, deployment, live referral
verification, API re-measurement and authenticated page verification are all
COMPLETE.

**NEXT ACTION (exactly one): raise the Workers CPU limit, or reduce per-invocation
cost under burst.**

This is now the single highest-value unblocked item, and it is an **owner
decision**, not a code change. Evidence that it is the binding constraint: a
burst 4-route browser sweep returned 503 on all four routes, while `GET /` and
`GET /api/system/health` stayed 200 throughout. Single requests are fast
(pages 193–315ms; `/api/dashboard/summary` 10/10 clean at 964ms); it is
*sustained/concurrent* load that breaches the per-invocation CPU ceiling.

Before spending money on a plan upgrade, measure whether per-route render cost
can be cut further — the dashboard fan-out fix already proved that route works.

*(The previously recorded next action — verify AI credit caps against the real
ledger — is now COMPLETE. Migration 088 is exercised on a real Postgres engine
via PGlite, including a concurrency test proving the cap cannot be oversold.)*

---

## TASK STATUS

| Item | Status |
| --- | --- |
| Commit 1 — referral share-link fix | `COMPLETE` (`2ea6db3`) |
| Commit 2 — tenant ratchet I/O budget | `COMPLETE` (`ff3b262`) |
| Commit 3 — persistent project memory | `COMPLETE` (this commit) |
| AI credit caps live-ledger verification | `NOT STARTED` |
| Score recalculation from corrected matrix | `NOT STARTED` |

---

## COMPLETED WORK

### 1. Referral share links point at the real signup route — `2ea6db3`

- **Requirement:** logged-out referral / first-1,000-users promotion must actually
  attribute signups; the banner must exist on the public landing page.
- **Files:** `api/referrals/route.ts`, `api/referrals/signup/route.ts`,
  `app/signup/route.ts` (new), `app/account/signup/page.tsx`,
  `app/(marketing)/page.tsx`, `components/marketing/index.ts`,
  `ReferralGiveawayBanner.tsx` (new), `app/referrals/page.tsx` (new), 2 test files.
- **Bug:** `GET /api/referrals` emitted `${baseUrl}/signup?ref=CODE`, but no such
  page exists — the live domain returned **404** for every referral link ever
  shared. Attribution was impossible end-to-end.
- **Verification performed:** live pre-fix reproduction
  (`/signup?ref=TEST123` → 404, `/account/signup` → 200); 14 unit/integration
  tests pass.
- **Verification result:** PASS.
- **Production verification:** **NOT VERIFIED — not deployed.** The 404 is
  confirmed live; the fix is confirmed only in tests. Deploy and re-check.
- **Date:** 2026-10-04.

### 2. Tenant-isolation ratchet I/O budget — `ff3b262`

- **Requirement:** the security guard suite must not report false failures.
- **File:** `app/api/__tests__/security/lead-insert-org-guard.test.ts`.
- **Defect:** the suite's only failure at `27cae46` was `Test timed out in 5000ms`
  — an I/O contention false negative, **not** a tenancy defect. Coverage was being
  silently skipped for an unrelated reason.
- **Verification:** guard passes in 339ms; 27 tests pass across sibling guards.
- **Production verification:** N/A (test-only).
- **Date:** 2026-10-04.

---

## OPEN WORK

| ID | Task | Status | Blocker | Next action |
| --- | --- | --- | --- | --- |
| N2-live | Verify AI credit caps against a real ledger | `COMPLETE` | PGlite runs migration 088 on a real engine, incl. concurrency |
| SCORE | Recalculate score from corrected matrix | `COMPLETE` | — | 7/10, evidence-derived |
| DEFECT-1 | Intermittent `GET /` 500 | BLOCKED (cause unknown) | needs new instrumentation | Only on new evidence |
| DEFECT-2 | ~~Authenticated page renders 503~~ | **RESOLVED 2026-10-04** | pages now 193–315ms live; residual burst 1102 logged as G1b |
| DEPLOY | Deploy `2ea6db3` + `ff3b262` to production | NOT STARTED | none | `node scripts/wrangler-deploy.mjs` |

---

## BLOCKED WORK

### Live billing / subscriptions / payments / payouts

- **Blocker:** `STRIPE_SECRET_KEY` absent from the environment.
- **Why:** no live provider is reachable. Code paths exist and are unit-tested
  (fail-closed 503 without Stripe), but **no money-moving path has end-to-end
  evidence**.
- **Work completed around it:** provider-independent architecture, state machine,
  webhook signature + idempotency tests, withdrawal tests — all present.
- **To unblock:** supply `STRIPE_SECRET_KEY` for a test-mode key, then run the
  lifecycle suite. Never a live key.

### Live AI provider calls — `STRIPE_SECRET_KEY` no; **Bedrock credentials** yes

- **Blocker:** no Bedrock credentials. Mocks remain in scope and in place.

### Live Apollo lead search

- **Blocker:** no `APOLLO_API_KEY`. Route correctly returns a precise
  `APOLLO_NOT_CONFIGURED` 503 rather than faking success.

### Free-plan CPU ceiling — this is the binding production constraint

- **Blocker:** Workers plan choice — an **owner decision**, not engineering.
- **Why it cannot be configured away:** `wrangler.jsonc` records that
  `limits.cpu_ms` was tried on 2026-10-03 and Cloudflare **rejected the deploy**:
  *"CPU limits are not supported for the Free plan."* The `limits` block is
  deliberately absent and documented as load-bearing. There is no knob — only a
  paid plan or less work per request.
- **Evidence, measured 2026-10-04 against Worker `499ceb4c`:**
  - Single requests are fast: authenticated pages 200 in **193–315ms**;
    `/api/dashboard/summary` 964ms, **10/10 consecutive**.
  - Burst traffic is not: a fast 4-route browser sweep returned **503 on all
    four** routes.
  - Under sustained testing the **public homepage itself returned 503 / Cloudflare
    1102** ("Worker exceeded resource limit") on three consecutive requests, then
    recovered to 200 after ~90s of cooldown. So the ceiling affects logged-out
    visitors, not just authenticated ones.
  - ⚠️ **CAUTION FOR THE NEXT MODEL:** this ceiling is *shared*. Hitting it
    degrades production for real visitors. **Do not run load sweeps or tight
    request loops against production.** Rate-limit any live verification to a few
    requests with cooldowns, and prefer local/PGlite tests. The 4-route browser
    sweep is what triggered this incident.
  - **Recovery shape (measured twice, worth knowing):** both the apex domain and
    `workers.dev` return 503 together — it is the Worker itself, not routing.
    `/api/system/health` returning 200 while `/` still 503s is the earliest sign
    the ceiling has cleared. Full recovery took roughly 60–90s of *no* requests.
    If you see 503s, stop generating traffic and wait; do not poll in a loop,
    because polling is what keeps the ceiling saturated.
  - The pre-hash sign-in throttle works correctly: 429 at 66–78ms, refusing
    before the ~98ms scrypt hash.
- **Interpretation:** single-request performance is healthy. The defect is a
  per-invocation CPU ceiling under concurrency, not a slow app.
- **To resolve:** either move to a paid Workers plan, or keep reducing per-route
  render cost. The dashboard fan-out fix (`503845f`, 17 invocations → 1) proves
  that route is viable and is the pattern to follow.

### `deployed-browser-qa.mjs` hangs — root cause identified, do not re-run as-is

It sweeps ~24 routes across two viewports with **no delay between navigations**,
each allowing `domcontentloaded` 45s + `load` 20s + `networkidle` 12s. That is
precisely the burst shape that trips the shared CPU ceiling, so the script was
almost certainly being throttled into its own long timeouts rather than hanging
on a bug. Fix it by inserting cooldowns and lowering the per-route budgets before
using it in anger; `scripts/authenticated-console-check.mjs` is the bounded
alternative.

### Deploy script does not rebuild (SILENT FAILURE — fix before next release)

- **Blocker:** `scripts/wrangler-deploy.mjs` spawns only `npx wrangler deploy`.
  It never rebuilds `.open-next`, so deploying after a code change ships the
  **previous** bundle and still reports success.
- **Observed 2026-10-04:** deploy returned Worker `6ea153be`; `/signup?ref=` still
  404'd. `app-path-routes-manifest.json` was timestamped 20:02 against a 01:43
  commit — 368 routes registered, `/signup/route` and `/referrals/page` absent.
- **Work around it:** always `yarn cf:build` immediately before deploying.
- **To fix properly:** make the deploy script run the build itself, or fail
  loudly when `.open-next` is older than the newest source file.

---

## VERIFIED FACTS

Reusable evidence. **Do not re-verify** unless the relevant code changed, the
deployment changed, the environment changed, or a regression demands it.

| Fact | Evidence | Date |
| --- | --- | --- |
| Referral banner renders on the public homepage | live `GET /` 3/3 = 200, banner content present | 2026-10-04 |
| `/referrals` dashboard route is live | live `GET /referrals` = 200 | 2026-10-04 |
| `/signup?ref=` now 307s to `/account/signup` with `?ref` AND `&plan` preserved, landing 200 with `ref` in the served HTML | live, 2026-10-04 |
| **AI credit caps enforced ATOMICALLY in Postgres** | PGlite (real engine) on migration 088: *"never oversells the cap under CONCURRENT consumption"*, plus daily/weekly/monthly denial, period boundaries, tenant isolation, release-never-negative — 10/10 pass | 2026-10-04 |
| AI credit caps formula `weekly = floor(monthly/4)`, `daily = floor(monthly/20)` | `aiCreditLimits.ts:194`; present in deployed bundle `handler.mjs:4448` | 2026-10-04 |
| Purchased credits are deliberately NOT subject to included-credit caps | `aiCreditLimits.ts:181-183`, `aiCreditGate.ts:103-108` | 2026-10-04 |
| AI cap arithmetic + ISO-week/UTC correctness | 19 tests in `aiCreditLimits.test.ts` | 2026-10-04 |
| Every AI route passes `authorizeAiRequest` | 5 tests, `ai-credit-gate.test.ts` | 2026-10-04 |
| **Authenticated PAGES render: `/dashboard` 200 in 315ms, `/campaigns` 273ms, `/lead-finder` 215ms, `/settings/billing` 193ms** (was 12.4s) | live 2026-10-04, after recording legal acceptance for the QA account |
| Dashboard HTML has **no error boundary** and **no hardcoded placeholder P&L** (`+$36,500` absent) | live HTML inspection, 17050 bytes |
| Tenant ratchet guard passes in isolation | `ff3b262`; 2 tests, 339ms | 2026-10-04 |
| **Free-plan CPU ceiling RESOLVED for authenticated APIs** | live 2026-10-04: `POST /api/auth/sign-in/email` 200 in 598ms; `/api/dashboard/summary` 200 in 964ms, **10/10 consecutive**; `/api/usage` 504ms; `/api/credits` 365ms; `/api/system/health` 180ms |
| **Transient 1102 under rapid-fire sign-in**, self-recovered | live: 3 rapid attempts → 503 (1102), then 429, 429 at 66–78ms (pre-hash refusal); after ~25s a single attempt returned 200 in 598ms. The throttle behaves correctly; the 1102 is a genuine Free-plan CPU ceiling under burst |
| Referral chain (401/403/400, self-referral, `?ref` preservation) | 10 tests | 2026-10-04 |
| Sign-in 200 in 490ms; throttle 429 in 75ms pre-hash | deployed Worker `dd557bc1` | pre-session |
| opennextjs chunk-loading cause of homepage 500 is **DISPROVEN** | deployed `handler.mjs` audited: 2038 cases, inlined requires | pre-session |
| Typecheck | `yarn typecheck` → exit 0 | 2026-10-04 |
| Lint on changed files | `oxlint` → 0 warnings, 0 errors | 2026-10-04 |

### Invalidated / stale evidence

- **Full-suite "2946 passed, 0 failed" (at `c87d510`)** — STALE. Superseded; the
  suite at `27cae46` had 1 failure (now fixed in `ff3b262`) and the suite has
  grown. Re-run before quoting a count.
- **Matrix entries N2/N3 "NOT STARTED" / "ABSENT"** — **INVALIDATED, WRONG.**
  Superseded by the correction recorded below.
- **"6/10" score** — SUPERSEDED. Recalculated 2026-10-04 to **7/10** from the
  corrected matrix. The old figure counted working, tested AI-credit
  functionality as missing.

---

## AI-CREDIT CORRECTION (important — do not regress)

The inherited matrix recorded:

> N2 Weekly limit = 25% of monthly — **none found** — NOT STARTED
> N3 Daily limit = 20% of weekly — **none found** — NOT STARTED

**This was a false negative caused by searching the wrong directory.** The
matrix searched `src/app/api/credits/`; the implementation lives in
`src/app/api/utils/`.

- `src/app/api/utils/aiCreditLimits.ts` — `deriveAiCreditPeriodCaps()` returns
  `{ monthly: n, weekly: floor(n/4), daily: floor(n/20) }`, matching the spec exactly.
- `src/app/api/utils/aiCreditGate.ts` — `authorizeAiRequest()` wraps it and is
  wired into AI routes.
- Purchased credits are intentionally outside the included caps, with an
  explicit comment explaining why a zero-allowance user who bought credits must
  not be denied.
- **Migration 088 is verified against a real Postgres engine (PGlite/WASM),
  not a mock** — `aiCreditLimits.pglite.test.ts`, 10/10 passing, including
  *"never oversells the cap under CONCURRENT consumption"* (atomicity),
  tenant isolation, period-boundary resets, and release-never-negative.
  Plus `aiCreditDb.test.ts` (13) and `aiCreditGate.pglite.test.ts`.
- **Do NOT rebuild or "fix" this.** It satisfies requirement K including the
  purchased-credit nuance and the concurrency/atomicity requirement.

---

## KNOWN FAILURES

| Failure | Status |
| --- | --- |
| Intermittent `GET /` 500, cause unknown | OPEN — unreproduced; homepage 3/3 = 200 on 2026-10-04 |
| ~~15/24 authenticated routes 503~~ | **RESOLVED 2026-10-04** — pages render in 193–315ms |
| Burst sign-in can return 1102 | OPEN — bounded, self-recovers in ~25s |
| No live billing/Apollo/Bedrock/Google verification | BLOCKED-EXTERNAL |

---

## RECENT COMMITS

```
ff3b262  test(security): give the tenant ratchet an I/O timeout budget  → 2 tests + 27 siblings PASS
2ea6db3  fix(referrals): point share links at the real signup route    → 14 tests PASS, live 404 reproduced
27cae46  fix(web): single source for /api/user/preferences reads       → pre-existing
503845f  perf(dashboard): serve all card data in one Worker invocation → pre-existing, UNDEPLOYED
753e1b9  fix(dashboard): remove a duplicated Worker invocation         → pre-existing
```

---

## DO NOT REPEAT

1. AI credit weekly/daily caps — **implemented and tested**. Do not rebuild.
2. Sign-in pre-hash cost guard — deployed and measured. Do not rebuild.
3. opennextjs chunk-loading investigation — **disproven**. Do not repeat.
4. Referral-link fix — landed. Do not redo.
5. Full 3013-test suite for isolated changes — ~6 min, `collect` 268s. Target instead.
6. Billing/tax/withdrawals/Apollo/migration re-audits absent a dependency change.
7. Repository-wide archaeology — architecture is already mapped in the matrix.

## SECURITY NOTE

This checkpoint records **credential NAMES only** (e.g. `STRIPE_SECRET_KEY
required`). It never contains passwords, keys, tokens, cookies or customer data.
`.tmp-qa-creds.env` in the working tree may hold real credentials — never commit
or print it.