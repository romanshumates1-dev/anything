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
| HEAD | `141e063` — four commits since `8451715`: `dac5d6e` (Better Auth limiter IP config), `d5d6094` (deployment-architecture caveat closed), `ed683e5` (**V3** gamification reward layer), `141e063` (`/api/rewards` route). **All not deployed.** |
| Deployment target | Cloudflare Workers via OpenNext (`wrangler`), `scripts/wrangler-deploy.mjs` |
| Production domain | `https://dealswiftautomation.com` |
| Last known deployed version | **Worker `85de11a9`** — deployed 2026-10-04 from `a576f2f`. Adds unhandled-throw telemetry. Full gate green: typecheck OK, lint 0/0, **3017 tests passed / 0 failed**, `cf:build` OK, authenticated browser **clean=6 noisy=0**. Live `/` and `/api/system/health` 200. |
| Environment note | Windows + opennext 1.20.6 + Next 16.3.6 |
| Current score | **8.5/10** — see SCORE RATIONALE below | |

### Current overall score

**8.5/10 — calculated 2026-10-04 from the corrected requirements matrix.**

Method and reasoning are recorded in the matrix's SCORE section. It rose from
the inherited 6/10 because working requirements had been recovered from
wrong-path search errors, then to 8.5/10 on cumulative verified scope. It is
held below 9 by two open production defects and by the absence of end-to-end
evidence on any money-moving path. Restoring the instrumentation source does
not change the score: it closes a maintenance gap, not a product requirement.

---

## SCORE RATIONALE — 8.5/10 (unchanged, but one supporting claim WITHDRAWN)

Not inherited, and not adjusted by feel. Raised from 8 because **three
requirements were recovered from false negatives**: the CRM contacts UI (live
200), the gamification XP/points **backend** (11 tests), and confirmation that
the AI-credit work stands. **Ten false negatives have now been found.**

**WITHDRAWN, THEN RE-ESTABLISHED (2026-10-04, commits `fa43bd0`, `0437912`):**
the original "gamification XP — live 200" evidence was **not valid**. `/achievements`
returned 200 while serving a hardcoded array and never calling its API, so that
200 certified nothing. The page is now real and **re-verified properly** — an
authenticated session, on the deployed Worker, asserting the fabricated strings
are absent from the rendered HTML, not merely that a request returned 200. The
requirement is back at LIVE VERIFIED on evidence that can actually fail.

The score itself does not move for this: the capability was already counted on
backend evidence, and what changed is the *quality* of the evidence, not the
number of satisfied requirements. Nothing was inflated to offset the correction
and nothing was deflated to punish it.

Still capped below 9:
- **The full gate passes at `52ad8e5`** (3006 tests, 0 failed; build OK;
  authenticated browser clean=6). That is the ceiling being set by the three
  items below, not by code quality.
- No money-moving path has **live** evidence. Stripe is verified in **test mode**
  against the real API (52 tests + a real test-mode round-trip), but signed
  webhook delivery to the deployed Worker is unproven.
- **The public site 503s under sustained load** (Cloudflare 1102). Not
  configurable on the Free plan. *(The related claim that `/dashboard` also
  times out at 45s was a HARNESS BUG and is withdrawn — see below.)*
- The intermittent homepage 500 remains unidentified.

The last two are **unmeasured**, not unbuilt. Both are being treated as an
assumption too readily: "the Workers plan is too small" has never been
established by measurement, and the homepage 500 has never been reproduced at
all. Closing either with evidence is the only route to 9 that does not depend on
a credential.

**10/10 is unreachable in this environment** — it needs the Stripe webhook
round-trip, live Apollo and Bedrock credentials, and a paid Workers plan.

---

## ACTIVE TASK

**Y1 / U1 — ENABLED-PHASE EXCLUSION IN ANALYTICS — NOT YET VERIFIED.**

The matrix records both as code-present but unproven: Y1 "Metrics reflect only
enabled phases" (`IMPLEMENTED`, **NOT VERIFIED**) and U1 "Admin analytics from
real records … must reflect only ENABLED phases — NOT VERIFIED". Next action:
read `api/analytics` and the admin/funnel routes, locate where campaign workflow
phases gate the aggregation, then write a test that disables a phase and asserts
the disabled phase is excluded. **The analytics exist — verify, do not rebuild.**

Closed this session:

1. **`x-real-ip` deployment caveat — CLOSED (`d5d6094`).** Live probe shows both
   the apex and workers.dev return `server: cloudflare` with `cf-ray` and **no**
   `x-vercel-*` headers, so Cloudflare is the only live edge. `git ls-files`
   finds **zero** nginx/Caddy/traefik/haproxy configs, and the root Dockerfile
   exposes the Next server directly on `:4000`. Conclusion: `cf-connecting-ip`
   is the only header guaranteed edge-overwritten today; `x-real-ip` and
   `x-vercel-forwarded-for` are retained as *defensive* entries for the
   documented-but-inactive runtimes, and `x-forwarded-for` stays excluded.
   Documented in `apps/web/DEPLOYMENT-ARCHITECTURE.md`; pinned by
   `clientIp.deployment-architecture.test.ts`, which also fails if someone adds
   a reverse proxy without re-verifying.
2. **V3 gamification reward layer — IMPLEMENTED (`ed683e5`, `141e063`).** Was
   genuinely NOT STARTED. Now: migration 099 (13 tables), pure economy module,
   exactly-once server claims, `/api/rewards`. **85 tests green** incl. a PGlite
   concurrency proof. **Remaining: UI page and deploy.**

Prior investigations remain CLOSED:

1. **Fabricated-data sweep — COMPLETE.** `/achievements` and `/inbox` fixed,
   deployed and LIVE VERIFIED (`fa43bd0`, `0437912`); the achievement
   points-farming vulnerability fixed and tested (`6b30d2c`); all 76
   authenticated pages swept by shape, **no further instances found**.
2. **`/dashboard` "45s timeout" — DEFECT DISPROVEN (`f0074e2`).** It never
   existed. Measured authenticated on Worker `8b0da56b`: HTTP **200**, DOM ready
   **219ms**, content visible **548ms**, heading `Welcome back, QA Audit Bot`.
   The cause was the QA harness waiting on `waitUntil: 'networkidle'`, which
   never settles on an authenticated page (shell RSC prefetch, React Query
   revalidation, onboarding PATCH on mount). **The instrument was wrong, not the
   product.** Endpoints behind it measured 83–405ms.

**NEXT ACTION (exactly one): verify Y1/U1 — write the enabled-phase exclusion
test for `api/analytics`. Do not send burst traffic to the production apex.**

The full gate is green at `52ad8e5`, so neither is a regression; both are
long-standing and both still block a 9. They are also the only items left that
are genuinely unmeasured rather than unbuilt.

1. **Intermittent `GET /` 500** — **diagnostics shipped** (`a576f2f`, Worker
   `85de11a9`); **root cause STILL unresolved**. The wrapper logs
   `[worker:unhandled]` + `suspected_resource_kill`. Next occurrence:
   `wrangler tail --format pretty`, grep that marker. Mechanism (unconfirmed):
   `handler` is explicitly assigned, so undefined **iff the page module failed to
   load**. Not reproduced (12/12 workers.dev, 6/6 apex, and 0/108 5xx under
   bounded concurrency on the isolated worker).
2. **503 under sustained load** — per-invocation cost measured (homepage warm
   median 124ms; the cost is **isolate cold start**). **Zero 5xx across 108
   concurrent requests** on the isolated worker. So at this concurrency the Free
   plan is not exhausting CPU on any endpoint. Higher concurrency still untested.
3. **Sign-in rate-limit "race" — WITHDRAWN, IT WAS A FALSE POSITIVE** (`d2eb0fe`).
   The limiter **holds**: mid-window bursts admitted 3,3,3,3,1 against a limit of
   3 across 64 concurrent requests. The earlier "admitted=4" was a **fixed-window
   boundary artifact** in the measuring script. **Do not rewrite this limiter.**
   Residual, documented and accepted: fixed windows admit ~2x across a boundary.
4. **Instrumentation source/patch maintenance gap — RESOLVED (`cab6955`), not
   deployed.** `src/instrumentation.ts` is again the canonical dev/Docker/Vercel
   source; OpenNext still needs the self-contained Worker stub because adapter
   1.20.6 omits the Turbopack instrumentation chunk. The new contract guard
   compares fatal/degraded env lists and Workers no-throw semantics (6/6 pass).
   `cf:build` passed and the built `handler.mjs` contains the self-contained boot
   register while the broken Turbopack stub is absent. This preserves diagnostics;
   it does **not** reproduce or fix the intermittent homepage 500.

### ISOLATED ENVIRONMENT NOW EXISTS — use it, do not recreate

`apps/web/wrangler.loadtest.jsonc` → Worker **`dealswift-loadtest`** (32 secrets
provisioned). **Fully disjoint from the apex.** ⚠️ `dealswiftautomation.com` and
`dealswift-app.romanshumates1.workers.dev` are **THE SAME WORKER** — "workers.dev"
is NOT isolation. Probe scripts now refuse to run unless `BASE` contains
`loadtest`. **All concurrency/CPU/load work belongs here.**

**Never** reproduce load behaviour on the live apex: a previous session caused a
genuine ~90-second production outage that way. Load experiments belong in an
isolated environment.

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
| ⭐ **FULL GATE PASSES at `52ad8e5`** — typecheck OK, lint 0/0, **3006 tests passed / 26 skipped / 0 failed** (277 files, 180.92s), `cf:build` OK, authenticated browser **clean=6 noisy=0** | run at this HEAD; re-run only if these files change | 2026-10-04 |
| ⭐ **`/dashboard` is NOT slow — the 45s "timeout" never existed** | authenticated, Worker `8b0da56b`: HTTP 200, DOM ready 219ms, content visible 548ms. Cause was the harness awaiting `networkidle` (`f0074e2`) | 2026-10-04 |
| ⭐ **`ERR_ABORTED` on authenticated pages is benign** | 19 API requests initiated / 5 aborted on `/dashboard`, **0 failures across 10s idle**, every aborted endpoint 200 on a direct call; `/api/user/preferences` requested twice = strict-mode double-mount. Aborted chunk verified served: 200, 28445 bytes | 2026-10-04 |
| ⭐ **All 76 authenticated pages checked for fabricated data — none found** | swept by shape (`\|\| mock`, no-fetch pages, hardcoded JSX literals), not by the word "mock" | 2026-10-04 |
| ⭐ **Achievement points are awarded exactly once** | `6b30d2c`, 11 tests written first (RED 8 failed → GREEN 11/11) | 2026-10-04 |
| `/achievements` and `/inbox` render real data, no mock content | authenticated live run: 200, mockLeak=0, 0 console/page errors | 2026-10-04 |
| Production sign-in is healthy | 200, `hasSession: true`, redirect to `/dashboard`. A past `401` was `cmd`-mangled credentials in the harness (`0437912`), NOT a product fault | 2026-10-04 |
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

## 🚨 PRODUCTION SAFETY RULE (mandatory — binding on every future session)

**On 2026-10-04 this session caused a real production incident.** A 4-route
browser sweep tripped the Cloudflare Free-plan CPU ceiling: three consecutive
`GET /` returned **503 / Cloudflare 1102** for roughly 90 seconds, affecting real
visitors including logged-out ones.

**NEVER, against the live apex or any production domain:**

- high-concurrency authentication probes
- burst login tests or brute-force simulations
- CPU-exhaustion / resource-exhaustion experiments
- repeated high-frequency browser sweeps
- uncontrolled parallel route crawling
- load or stress testing of any kind

**Use instead:** local, an isolated Worker, a preview/staging deployment,
`workers.dev` test deployment, mocks, or PGlite.

**Production testing must stay bounded, low-volume, representative and
non-destructive.** In practice: a handful of requests, with cooldowns between
them, one account at a time.

The scripts most likely to violate this are the automated sweeps. This is why
`deployed-browser-qa.mjs` was given a 4s inter-route cooldown and a 503 abort
guard (`a77ec6a`) — it sweeps ~24 routes across two viewports and was throttling
itself into the ceiling. Prefer `scripts/authenticated-console-check.mjs`, which
uses four routes and a hard timeout.

## CURRENT DEPLOYED VERSION

Worker `499ceb4c`, deployed 2026-10-04 from commit `5c52120`.

| Failure | Status |
| --- | --- |
| Intermittent `GET /` 500, cause unknown | OPEN — unreproduced; homepage 3/3 = 200 on 2026-10-04 |
| ~~15/24 authenticated routes 503~~ | **RESOLVED 2026-10-04** — pages render in 193–315ms |
| Burst sign-in can return 1102 | OPEN — bounded, self-recovers in ~25s |
| No live billing/Apollo/Bedrock/Google verification | BLOCKED-EXTERNAL |

---

## RECENT COMMITS

```
141e063  feat(gamification): expose the V3 reward surface behind session + ON/OFF gates  → 13 tests PASS
ed683e5  feat(gamification): add V3 reward layer (seasons, battle pass, crates, spins…)  → 58 tests + migration gate PASS
d5d6094  docs(auth): verify deployment architecture behind the client-IP trust list     → 4 tests PASS
dac5d6e  fix(auth): resolve Better Auth limiter IP from trusted edge headers            → 136 tests PASS
ff3b262  test(security): give the tenant ratchet an I/O timeout budget  → 2 tests + 27 siblings PASS
2ea6db3  fix(referrals): point share links at the real signup route    → 14 tests PASS, live 404 reproduced
```

None of the four are deployed. Last deployed Worker remains `85de11a9`.

---

## DO NOT REPEAT

1. AI credit weekly/daily caps — **implemented and tested**. Do not rebuild.
2. Sign-in pre-hash cost guard — deployed and measured. Do not rebuild.
3. opennextjs chunk-loading investigation — **disproven**. Do not repeat.
4. Referral-link fix — landed. Do not redo.
5. Full 3013-test suite for isolated changes — ~6 min, `collect` 268s. Target instead.
6. Billing/tax/withdrawals/Apollo/migration re-audits absent a dependency change.
7. Repository-wide archaeology — architecture is already mapped in the matrix.
8. **V3 gamification reward layer** — now built and tested (`ed683e5`, `141e063`).
   Do not re-verify its absence; do not rebuild it. Only the UI page is missing.
9. **`x-real-ip` deployment question** — answered with live evidence (`d5d6094`).
   Do not re-probe unless the deployment target changes.
10. **`better-auth` IP-header self-correction** — the wrong `['cf-connecting-ip']`-only
    config was caught by inspecting the compiled bundle and comparing against
    `clientIp.ts`. Do not "simplify" that list back down; the shared-bucket
    failure it causes is documented in `DEPLOYMENT-ARCHITECTURE.md`.

## SECURITY NOTE

This checkpoint records **credential NAMES only** (e.g. `STRIPE_SECRET_KEY
required`). It never contains passwords, keys, tokens, cookies or customer data.
`.tmp-qa-creds.env` in the working tree may hold real credentials — never commit
or print it.