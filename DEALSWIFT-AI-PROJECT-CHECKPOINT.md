# DEALSWIFT — AI PROJECT CHECKPOINT

**This file is the project's persistent memory.** Conversation context is not
project state. A new model inherits state from here and from
`UNIFIED-REQUIREMENTS-MATRIX.md` — never from a fresh audit.

---

## SESSION UPDATE — 2026-10-12 (contract-summary delivery + F3 credit-tier investigation)

Branch `feat/gamification-rewards`. `git fetch` confirms **no remote drift** — all
three commits are present and pushed: `08b4c85` (F2/F3/F4 dashboard
tenant-isolation), `44705f0` (checkpoint doc fix), `74ec70b` (plain-language
contract summary, new this session).

### Phase 1 — reconciled actual repository state
- Current branch: `feat/gamification-rewards`. Working tree: only scratch files
  untracked; all feature files committed (git status: staged={}, unstaged={}).
- Confirmed via `git log` + `git show 74ec70b:src/app/contracts/page.tsx`:
  `import ContractPlainSummary` + `<ContractPlainSummary contract={contract} />`
  rendered in each contract card. No duplicate implementations, no history rewrite.
- The prior "reported" results (3460 passed per 2026-10-11; 66/66 for F2/F3/F4) are
  **recorded from prior sessions** and were not re-run this session (see Phase 2).

### Phase 2 — command-runner diagnosis (PRECISE LIMITATION)
The `run_commands` shell runner entered a **persistent failure mode** mid-session.
Every invocation serializes the tool's own argument envelope as the literal script
body, so PowerShell receives `<arg_key>commands</arg_key>["..."]` where it expects the
command string; `& ([ScriptBlock]::Create($c))` then parses `<` as the reserved
future-use operator → `The '<' operator is reserved for future use.`. It first
appeared intermittent (some `echo`/`powershell -File` calls succeeded), then became
total — even `echo hi` now fails. **CI cannot substitute**: the workflow file lives at
`apps/web/.github/workflows/ci.yml`, and its own header states it must be copied to the
repo-root `.github/workflows/` to activate; no root workflow exists, so GitHub Actions
does not run here.

A self-detaching full-suite runner is **staged but not yet executed**:
`d:/anything/tmp_full_verify.bat`. When the shell recovers, run
`cmd /c d:\anything\tmp_full_verify.bat` — it launches detached and writes
`tmp_tsc_done.txt` / `tmp_vitest_done.txt` plus `tmp_tsc.log` / `tmp_vitest_full.log`.

### Phase 3 — verification gates (honest status)
- **Gate A full typecheck** (`tsc -p tsconfig.typecheck.json --noEmit`): NOT EXECUTABLE
  this session (shell dead). Alternative captured THIS SESSION: scoped
  `tsc -p apps/web/tsconfig.verify.json --noEmit` over **all three changed files**
  (`plainContractSummary.ts`, `ContractPlainSummary.tsx`, `page.tsx`) → **EXIT 0**,
  zero errors. (Scratch config, not committed.)
- **Gate B full regression suite**: NOT EXECUTABLE this session (shell dead; CI inactive).
  Alternative captured THIS SESSION: `vitest run --config src/app/api/vitest.config.ts
  src/app/api/utils/__tests__/plainContractSummary.test.ts` → **18 passed (18), exit 0**.
  The 66/66 tenant-isolation/credits suite from `08b4c85` is un-confirmed *here*
  (reported result only).
- **Gate C contract-summary correctness**: VERIFIED — pure builder deterministic;
  anti-fabrication tests pass (no invented price/date/fee); date-only TZ regression
  closed; component typed against the real `ContractData` shape (scoped tsc confirms
  assignability).

### Delivered this session (next unblocked master requirement)
Plain-language contract summary — explicitly requested in `nexttodo.md` ("clear and
simple … so a 3rd grader … can understand why it's a good deal"). Self-contained and
credential-free, so it was the highest-priority *unblocked* item.
- `src/app/api/utils/plainContractSummary.ts` — pure builder + helpers; anti-fabrication
  guardrails; TZ-correct date-only formatter (closes `2026-03-04`→`March 3` for UTC-West);
  whole-dollar money.
- `src/components/contracts/ContractPlainSummary.tsx` — `'use client` render.
- `src/app/contracts/page.tsx` — render it near the top of each contract card.
- `__tests__/plainContractSummary.test.ts` — 18 tests incl. anti-fabrication + TZ regression.
- Commit `74ec70b`, pushed.

### Phase 4 — F3 credit-tier investigation (READ-ONLY; no production data touched)
Authoritative, from migrations:
- `subscription_plans.tier` CHECK + seeds (migrations 025/035/067):
  `free, starter, pro, professional, business, scale, enterprise`.
- `credit_costs` seeded (080) for only: `FREE, STARTER, PRO, BUSINESS, ENTERPRISE`.
- **Gap**: real paid plans `professional` ($249/mo, migration 035) and `scale`
  ($2,499/mo, migration 067) have **no** `credit_costs` rows, so `subscription_plans.tier`
  legitimately drifts from the `CREDIT_TIERS` set.

Current safe behavior (verified by existing tests in `08b4c85`, re-read this session):
- `getAllCosts('scale' | 'professional' | '' | 'GARBAGE_TIER')` **throws**
  "Unknown subscription tier … refusing to price it at FREE" (credits.test.ts:250-255);
  `sql` is never called — **fail-closed, no silent FREE pricing on the dashboard path**.
- `getCredits` degrades: balance + history served, `costs: {}` (NOT FREE, no 500) for
  `scale`/`professional` (getCredits.tierResilience.test.ts).

Residual (not a safety/honesty defect): singular `getCreditCost(action, tier)` still
falls back to the `FREE` `credit_costs` row for an unmapped tier — **tested-as-intentional**
(credits.test.ts:81-89 "falls back to FREE tier cost if tier not found"). For paying
Scale/Professional customers it underprices per-action usage.

Recommendation (NOT implemented — pricing-sensitive; needs TDD which requires a working
shell, and billing-owner sign-off): add an **idempotent** migration seeding
`credit_costs` rows for `PROFESSIONAL` & `SCALE` at the **best existing rate**
(ENTERPRISE-equivalent), derived from migration 067's overage ordering (Scale has the
lowest overage $/unit → lowest credit surcharge). Back it with a failing test first
(`getAllCosts('scale')` returns real costs, never FREE). Do NOT modify real customer
balances or invent a non-authoritative mapping.

### Remaining master-scope status
- Homepage G2 500: **unchanged** — matrix G2 remains DIAGNOSABLE (memory hypothesis
  unmeasured; 40/40 no-repro). No new evidence obtainable (no live/prod access).
- Stripe live webhook: **BLOCKED-EXTERNAL** (needs `STRIPE_SECRET_KEY` +
  `STRIPE_WEBHOOK_SECRET`); provider-independent webhook tests already pass (52 billing
  tests). No live round-trip possible without secrets.
- Buyer-matching / payment-method-gated assignment / fee disbursement / assignment
  emails / campaign launch (nexttodo.md): **BLOCKED-EXTERNAL** on Stripe Connect / AWS /
  email credentials + design; not started.
- Next genuinely unblocked requirement once the shell recovers: re-run
  `tmp_full_verify.bat` to close Gate A + B, then implement the PROFESSIONAL/SCALE
  `credit_costs` migration with a TDD test (or resume credential-blocked items).





**Branch `feat/gamification-rewards`.** Typecheck = **0 errors**. Full regression suite = **3460 passed / 0 failed** (325 files, 26 PGlite-skipped). All work TDD RED→GREEN.

### XP double-award fix — root cause and proof
- **Root cause** — `awardXp` accepted an optional `eventKey` but the runtime schema lacked the exact-once ledger that made replay/concurrency safe. The general account XP path was writing directly to `public.user_stats.points` without a database-enforced unique row for `(user_id, event_key)`, so a refresh, duplicate request, or concurrent retry could award the same logical event multiple times.
- **Schema fix** — added migration `101_user_xp_events.sql` creating `public.user_xp_events` with `UNIQUE(user_id, event_key)` and `CHECK (xp > 0)`, matching the product pattern already used by seasonal XP and the reward surfaces.
- **Atomic write fix** — `awardXp()` now uses `INSERT ... ON CONFLICT DO NOTHING` into `public.user_xp_events` first, then updates `public.user_stats.points` only when the insert actually created a row. That preserves legitimate distinct events while making replayed or concurrent duplicates a no-op.
- **Regression proof** — `npx vitest run --config src/app/api/vitest.config.ts src/app/api/utils/__tests__/gamificationRewards.pglite.test.ts` => **1 file passed, 15 tests passed, exit 0**. The test exercises: normal valid awards, replayed key dedupe, concurrent duplicate attempts, distinct event keys, and persisted event records.
- **Status** — `awardXp` double-award risk is now closed with database-enforced idempotency and real Postgres-backed regression coverage.

### Delivered this session
- **Crate backend fix** — `crates.server.ts` imported `secureRoll` from `crates.ts` (never exported → runtime crash, masked by the route test's full mock). Moved to server-only `node:crypto.randomInt(0,10000)`.
- **Crate API + pure module** — `api/utils/crates.ts` (13 tests), `api/crates/route.ts` (13).
- **Crate shop UI `/crates`** — `app/crates/page.tsx` + test (3); nav link in `Shell.tsx` (sidebar + user menu, `requiresGamification`).
- **Page tests** for `/rewards`, `/achievements`, `/leaderboard` (3 each, NEW) — server-authoritative rendering, 404→"turned off", no fabrication, redeem POST+refetch.
- **Dashboard skins now genuinely applied (GAP CLOSED)** — equipped theme was decorative. New pure `api/utils/cosmeticTheme.ts` (6 tests) maps theme cosmetics→CSS vars; `Shell.tsx` applies them app-wide; `Shell.theme.test.tsx` (1) asserts root container gets `--accent-blue:#7c3aed` for equipped nebula skin.
- **Seasonal progression + competitions (GAP CLOSED)** — `gamification_seasons` and `competitions` tables existed (migration 099) but had no API surface or UI. This session adds:
  - GET `/api/seasons` — live season, caller's XP/rank, battle-pass state, **org-scoped standings** (display names only, tenant-isolated via `organization_members` join, banned users excluded), and active competitions. Returns 404 when gamification is OFF.
  - `seasonStandingsForOrg()` in `seasonalProgress.server.ts` — joins `organization_members`, filters banned users, uses pure `standingsWithRanks` for tie-safe ranking.
  - `SeasonStandings.tsx` client panel — server-authoritative by design: every number (XP, rank, countdown, standings) comes from the API payload; never fabricated. Honest empty state when no season is live; "turned off" on 404.
  - Migration `100_season_xp_events.sql` — idempotency ledger (`UNIQUE(user_id, season_id, reason)`) so concurrent/replay XP credits are `INSERT...ON CONFLICT DO UPDATE`-atomic, never double-awarded.
  - **Full regression**: 3460 passed / 0 failed (325 files, 26 PGlite-skipped).
- **Migration guard test fix** — `scripts/run-migrations.guard.test.ts` counts updated (773→776, 388→389) to match the `stripTrailingComment` fix that correctly handles migration 082's `; -- $5k` trailing comment. Both counts derived from running the fixed splitter against the real corpus; the guard still proves the original bug dropped 389/776 statements.

### Gamification gap matrix (vs `roman.agent.md` 1254–1298)
| Capability | State |
| --- | --- |
| account XP / levels | IMPLEMENTED+TESTED (`/rewards`) |
| battle-pass / game-pass | IMPLEMENTED+TESTED (`/rewards` + `/seasons`) |
| weekly spin wheel | IMPLEMENTED+TESTED (`/rewards`) |
| redeemable 1x–10x use codes | IMPLEMENTED+TESTED (`/rewards`) |
| monthly giveaways | IMPLEMENTED+TESTED (`/rewards`) |
| dashboard skins | IMPLEMENTED+TESTED (genuinely applied) |
| crates / rewards | IMPLEMENTED+TESTED (backend+API+UI) |
| **seasonal progression** | **IMPLEMENTED+TESTED** (API `/api/seasons`, `SeasonStandings.tsx` panel on `/rewards`, `seasonStandingsForOrg` with tenant isolation, PGlite tests) |
| **competitions** | **IMPLEMENTED+TESTED** (live competitions returned by `/api/seasons`, rendered in `SeasonStandings.tsx`, `activeCompetitions()` server function) |

---

## PROJECT STATE

| Field | Value |
| --- | --- |
| Date | 2026-10-07 |
| Repository | `d:\anything` |
| Branch | `feat/gamification-rewards` |
| HEAD | `638c7c3` — season standings UI + API + tenant-isolated org standings (closes seasonal progression + competitions PARTIAL gap). On top of `22f950d` (crate shop UI, cosmetic themes, reward page tests), `4479ad0` (pure seasonal progression rules), `aa7864f` (season XP idempotency ledger migration 100), `2a6bc1a` (rewards page + gamification sidebar gating), and the SET AB slice (`2b9cab9`/`da2b6c9`). **None deployed to production** (last live Worker `85de11a9`). |
| Deployment target | Cloudflare Workers via OpenNext (`wrangler`), `scripts/wrangler-deploy.mjs` |
| Production domain | `https://dealswiftautomation.com` |
| Last known deployed version | **Worker `85de11a9`** — deployed 2026-10-04 from `a576f2f`. Adds unhandled-throw telemetry. Full gate green: typecheck OK, lint 0/0, **3017 tests passed / 0 failed**, `cf:build` OK, authenticated browser **clean=6 noisy=0**. Live `/` and `/api/system/health` 200. |
| Environment note | Windows + opennext 1.20.6 + Next 16.3.6 |
| Current score | **8.5/10** — baseline on model switch; do NOT reset (see matrix SCORE) |
| Score last calculated at commit | `ff3b262` (matrix regenerated 2026-10-04); evidence refreshed through `a0c9ec6` (2026-10-07) — no requirement changes, score unchanged |

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

**G2 — BLOCKED-EXTERNAL (2026-10-07)**

Attempted: controlled concurrency load test against `dealswift-loadtest` with `wrangler tail` capture.

Precondition verification results:
- `CF_API_TOKEN` env: unset
- `CF_ACCOUNT_ID` env: unset
- `npx wrangler whoami`: hangs → times out (no stored auth in `.wrangler/state/v3`)
- Result: **NOT AUTHENTICATED**

`BLOCKER: Cloudflare diagnostic execution unavailable`
`REASON: No Wrangler authentication credentials (CF_API_TOKEN/CF_ACCOUNT_ID) present locally; wrangler whoami times out with no stored auth config.`
`NEXT ACTION WHEN UNBLOCKED: run G2 isolated concurrency diagnostic (10 concurrent + 2 heavy authenticated routes, 60s/180-req cap, early-stop on 5xx, wrangler tail capture for [worker:unhandled] / suspected_resource_kill markers)`

Diagnostics code ships in `a576f2f` (Worker `85de11a9`): the fetch wrapper logs
`[worker:unhandled]` + `suspected_resource_kill`. On the next occurrence run
`wrangler tail --format pretty` and grep that marker. Not reproduced in 40/40
checks. Do not send burst traffic to the production apex.

**DO NOT REPEAT (model-switch protection):** Cloudflare authentication was checked
and is unavailable. Do not re-check unless credentials/environment changed.

## FROZEN EXTERNAL BLOCKERS

| Blocker | Status | Exact unblock action |
| --- | --- | --- |
| G2 — intermittent homepage 500 live diagnostic | BLOCKED-EXTERNAL | Authenticate Wrangler (CF_API_TOKEN/CF_ACCOUNT_ID or `wrangler login`); then run the existing controlled isolated G2 test against `dealswift-loadtest` with `wrangler tail` |
| G1b — Free-plan CPU ceiling (Cloudflare 1102) | OWNER-DECISION | Owner evaluates/approves Workers plan upgrade (only if final evidence demonstrates it is necessary). Do NOT upgrade it yourself; do NOT weaken auth security |
| DEPLOY — ship current HEAD to production | BLOCKED-EXTERNAL | Authorized Cloudflare deployment credentials/environment |
| STRIPE live webhook round-trip | BLOCKED-EXTERNAL | Live `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` via `wrangler secret put` |
| APOLLO live API calls | BLOCKED-EXTERNAL | `APOLLO_API_KEY` via `wrangler secret put` |
| Twilio/Bedrock live calls | BLOCKED-EXTERNAL | Provider credentials (Twilio keys, AWS Bedrock keys) |
| Google OAuth live sign-in | BLOCKED-EXTERNAL | OAuth client credentials |
| Real inbox delivery verification | BLOCKED-EXTERNAL | Live email provider + real inbox |

All provider-independent engineering is continuing. See OPEN WORK below for
the engineering-owned requirements in dependency order.

Closed this session (2026-10-07):

1. **QA-ACCEPT — DONE.** Legal acceptance recorded for the QA account;
   `qa-accept.mjs` + `qa-page-probe.mjs` committed (`4036224`).
2. **Analytics phantom columns — DONE (`a0c9ec6`).** `contracts.lead_id`,
   `message_events.opened_at`, `leads.zip_code` never existed; fixed at 7 query
   sites, pinned by `schemaColumnTruth.guard.test.ts`. Probe 2026-10-07:
   **104 routes / 100 OK / 0 SERVER_FAULTS**, all 8 `analytics/crm` variants 200
   including `groupBy=zipCode`.

Closed this session (2026-10-11):

1. **AB5 — SET AB slice 2 enforcement — DONE (`2b9cab9`).** Feature choices now
   gated at nav, API, and seeding level. Server gate `featureChoices.server.ts`
   (`isFeatureEnabledForUser`, `requireFeatureEnabled`). Shell nav hides CRM
   Analytics when `advanced_analytics` declined. API routes gate: analytics/advanced,
   analytics/crm, ai-recommendations (ai_automation), campaigns (phone/sms/email
   channels), organizations + free-tier/seed (demo_data). 56/56 tests pass
   (enforcement 10, Shell nav-gating 2, server gate 8, codec 15, route 6,
   questionnaire 4). tsc 0 errors, oxlint 0 warnings.

Closed prior session:

1. **Y1 / U1 — VERIFIED (`a5fc054`, `eced6d4`).** Both were code-present but
   unproven. The campaign builder is the only place workflow stages are defined
   for display, and `campaignPhases.enabled.test.ts` proves every reporting path
   (`getCampaignSummary().phaseCount`, `getChannelStats`,
   `estimateCampaignDuration`, `estimateCampaignCost`) excludes disabled phases —
   using roman.agent.md's own Campaign A and Campaign B — plus validation
   rejecting all-off and enabled-on-disabled-channel. **15/15 pass**, 28/28
   existing siblings. `api/analytics` derives stages from real rows, and no admin
   route has a stage dimension at all.
2. **X1 — VERIFIED (`68a67b4`).** `entitlements.ts` had **no test file at all**,
   which is why this sat IN PROGRESS. Now proven fail-closed: no subscription
   row, unknown tier string, NULL tier, empty result and a DB throw all resolve
   to `FREE`; `enforceEntitlement` throws and audits `feature_denied`. The
   billing UI already throws on `!res.ok`, renders an error branch, and defaults
   `currentTier` to `'free'`. **16/16 pass.**
3. **`x-real-ip` caveat — CLOSED (`d5d6094`).** Live probe shows both the apex and
   workers.dev are `server: cloudflare` with no `x-vercel-*`; `git ls-files` finds
   **zero** nginx/Caddy/traefik configs; the Dockerfile exposes :4000 with no
   proxy. `cf-connecting-ip` is the only header guaranteed edge-overwritten today;
   the other two are defensive for documented-but-inactive runtimes.
   `x-forwarded-for` stays excluded. Documented in `DEPLOYMENT-ARCHITECTURE.md`.
4. **V3 reward layer — IMPLEMENTED (`ed683e5`, `141e063`).** Was genuinely NOT
   STARTED. Migration 099 (13 tables), pure economy, exactly-once claims, route.
   **85 tests green** incl. a PGlite concurrency proof.

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

**NEXT ACTION (exactly one): G2 is BLOCKED-EXTERNAL — no Cloudflare auth available locally. H1 CLOSED (`48bdaf3`): the `next/link` mock in `apps/web/src/components/Shell.test.tsx` spread `...rest` onto a raw `<a>`, so React logged `Received \`false\` for a non-boolean attribute \`prefetch\`` on every render — an avoidable console error. The mock now destructures `prefetch` out and drops it, and a new test (`Shell renders without leaking non-boolean attributes (H1)`) captures real `console.error` output and asserts no non-boolean-attribute warning, with an `anchors > 0` guard so an empty render cannot pass vacuously. **Production code unchanged — `Shell.tsx` was NOT modified**; real `next/link` consumes `prefetch` and never renders it to the DOM, so the leak was test-only. Mutation-proven: a temp copy (`Shell.h1mut.test.tsx`) with the destructure reverted to the leaking `...rest` makes the new test FAIL with React's verbatim warning; real impl → 11/11 pass. Regression: `src/components` 9 files / 59 tests pass. Anti-loop: do not edit `Shell.tsx` for this, and do not revisit unless that mock regresses. B1/B2 remains CLOSED (`954c910`, `Shell.tsx` correct as-is, 10 tests mutation-proven). Next genuinely unfinished item after H1 is G1b (Free-plan resource ceiling — owner decision) — see AI-HANDOFF queue.

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
| AI credit caps live-ledger verification | `COMPLETE` (PGlite runs migration 088 on a real engine, incl. concurrency) |
| Score recalculation from corrected matrix | `COMPLETE` (8.5/10, matrix SCORE section) |
| QA-ACCEPT — legal acceptance + page-route probe | `COMPLETE` (`4036224`; probe 104 routes / 0 SERVER_FAULTS) |
| Analytics phantom-column fix + schema-truth guard | `COMPLETE` (`a0c9ec6`; guards 8/8, all crm variants 200) |

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
| SCORE | Recalculate score from corrected matrix | `COMPLETE` | — | 8.5/10, evidence-derived (matrix SCORE section) |
| ANALYTICS | CRM analytics phantom-column 500s | `COMPLETE` (`a0c9ec6`) | guards 8/8; probe: all 8 crm variants 200 |
| QA-ACCEPT | Legal acceptance so page routes render | `COMPLETE` (`4036224`) | probe: 104 routes / 0 SERVER_FAULTS |
| DEFECT-1 | Intermittent `GET /` 500 | BLOCKED (cause unknown) | needs new instrumentation | Only on new evidence |
| DEFECT-2 | ~~Authenticated page renders 503~~ | **RESOLVED 2026-10-04** | pages now 193–315ms live; residual burst 1102 logged as G1b |
| DEPLOY | Ship current HEAD (through `a0c9ec6`) to production | NOT STARTED | none | `yarn cf:build` first — `scripts/wrangler-deploy.mjs` does NOT rebuild |

---

## BLOCKED WORK

### Live billing / subscriptions / payments / payouts

- **Blocker:** a **test-mode** `STRIPE_SECRET_KEY` is now present in
  `apps/web/.env` (never commit or print it; `STRIPE_PROVIDER=mock`). Still
  owner-blocked: the **live** round-trip needs production key material and a
  `STRIPE_WEBHOOK_SECRET` for signed webhook delivery to the deployed Worker.
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
| ⭐ **FULL SUITE PASSES at code HEAD `a0c9ec6`** — **3139 passed / 26 skipped / 0 failed** (290 files, 207.6s), vitest with project config | run 2026-10-07; re-run only if relevant files change | 2026-10-07 |
| ⭐ **Page probe: 104 routes / 100 OK / 4 benign redirects / 0 SERVER_FAULTS** on `dealswift-loadtest`, incl. all 8 `analytics/crm` variants (`view=regional&groupBy=zipCode` 200, `view=outreach` 200) | `qa-page-probe.mjs` at `a0c9ec6` | 2026-10-07 |
| ⭐ **Schema-truth guard pins the phantom-column rules** — contracts joins via `seller_lead_id = l.id::text`; no `message_events.opened_at`; `leads.zip` not `zip_code`. Regression samples prove the scan is not vacuous | `schemaColumnTruth.guard.test.ts`, 8/8 pass with `sqlFragmentComposition.guard` | 2026-10-07 |
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

Worker `85de11a9`, deployed 2026-10-04 from commit `a576f2f` (supersedes the
older `499ceb4c` / `5c52120` figure). Nothing since `a576f2f` is deployed to
production; the `dealswift-loadtest` worker separately serves the analytics
fix (probe 2026-10-07: 104 routes / 0 faults).

| Failure | Status |
| --- | --- |
| Intermittent `GET /` 500, cause unknown | OPEN — unreproduced; homepage 3/3 = 200 on 2026-10-04 |
| ~~15/24 authenticated routes 503~~ | **RESOLVED 2026-10-04** — pages render in 193–315ms |
| Burst sign-in can return 1102 | OPEN — bounded, self-recovers in ~25s |
| No live billing/Apollo/Bedrock/Google verification | BLOCKED-EXTERNAL |

---

## RECENT COMMITS

```
71252d0  test(migrations): fix stale counts in run-migrations guard after stripTrailingComment
638c7c3  feat(gamification): season standings UI + API + tenant-isolated org standings
aa7864f  feat(gamification): write season XP through an idempotency ledger (migration 100)
4479ad0  feat(gamification): add pure seasonal progression rules
22f950d  feat(gamification): crate shop UI, cosmetic themes, reward page tests
a0c9ec6  fix(analytics): correct phantom columns in CRM engine      → guards 8/8; probe 104 routes / 0 faults
4036224  test(qa): legal-acceptance setup + page-route probes       → probe 104 routes / 0 faults
a19cbdc  docs(matrix): close RUNMIG/SQLFRAG/V3-UI, record the green-gate lesson
9a25669  docs(state): refresh handoff to 8681150, record migration-runner trap
8681150  fix(migrations): stop run-migrations skipping comments     → 9 guard tests; 3133 pass / 0 fail
7e63233  docs(matrix): V3 complete incl. rewards page
2a6bc1a  feat(gamification): rewards page + gamification sidebar gating
68a67b4  test(billing): prove entitlements fail closed, closing X1  → 16 tests PASS
a5fc054  test(campaigns): disabled workflow stages never active     → 15 + 28 tests PASS
```

None of these are deployed to production; last live production Worker remains
`85de11a9`. The `dealswift-loadtest` worker serves the analytics fix (probe
2026-10-07).

---

## DO NOT REPEAT

1. AI credit weekly/daily caps — **implemented and tested**. Do not rebuild.
2. Sign-in pre-hash cost guard — deployed and measured. Do not rebuild.
3. opennextjs chunk-loading investigation — **disproven**. Do not repeat.
4. Referral-link fix — landed. Do not redo.
5. Full 3013-test suite for isolated changes — ~6 min, `collect` 268s. Target instead.
6. Billing/tax/withdrawals/Apollo/migration re-audits absent a dependency change.
7. Repository-wide archaeology — architecture is already mapped in the matrix.
8. **V3 gamification reward layer** — now built and tested (`ed683e5`, `141e063`, `22f950d`, `4479ad0`, `aa7864f`, `638c7c3`). Reward suite, seasons API, competition API, SeasonStandings UI panel, migration guard tests — all green. Full regression: 3460 passed / 0 failed. Do not rebuild.
9. **`x-real-ip` deployment question** — answered with live evidence (`d5d6094`).
   Do not re-probe unless the deployment target changes.
10. **`better-auth` IP-header self-correction** — the wrong `['cf-connecting-ip']`-only
    config was caught by inspecting the compiled bundle and comparing against
    `clientIp.ts`. Do not "simplify" that list back down; the shared-bucket
    failure it causes is documented in `DEPLOYMENT-ARCHITECTURE.md`.
11. **Y1 / U1 (enabled-phase exclusion) — VERIFIED `a5fc054`.** Do not re-audit.
    The campaign builder already filters disabled phases; the test now pins it.
12. **H1 `prefetch` console warning — CLOSED `48bdaf3`, and do NOT edit
    `Shell.tsx` for it.** The leak was the test's own `next/link` mock
    spreading `...rest` onto a raw `<a>`; real `next/link` consumes `prefetch`.
    The mock destructures it out and a guard test fails if it returns.
12. **X1 (UI must not claim what the backend denies) — VERIFIED `68a67b4`.**
    `entitlements.ts` now has a test file proving fail-closed. Do not rebuild
    the gate; it is correct.
13. **CRM analytics phantom columns — FIXED `a0c9ec6`.** Do not hand-scan for
    `lead_id`/`opened_at`/`zip_code`; `schemaColumnTruth.guard.test.ts` fails the
    build on all three. Do not re-run the probe just to prove the analytics
    views 200 — probe 2026-10-07 (104 routes / 0 faults) is the evidence.
14. **QA-ACCEPT — DONE.** Legal acceptance is recorded; `qa-accept.mjs` and
    `qa-page-probe.mjs` are committed (`4036224`). Do not re-open the
    "every page 307s to /legal/accept" finding.

## SECURITY NOTE

This checkpoint records **credential NAMES only** (e.g. `STRIPE_SECRET_KEY
required`). It never contains passwords, keys, tokens, cookies or customer data.
`.tmp-qa-creds.env` in the working tree may hold real credentials — never commit
or print it.