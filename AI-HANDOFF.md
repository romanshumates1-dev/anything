# AI-HANDOFF — read this first

**Last updated:** 2026-10-07 (session following commit `a0c9ec6`)
**Purpose:** a new model should understand the project state from this file in under a minute, without reading history or re-auditing.

---

## CURRENT BRANCH

`feat/cloudflare-workers`

## CURRENT HEAD

`a0c9ec6` — on `feat/cloudflare-workers`. None of this is deployed to
production; the last live Worker is still `85de11a9` from `a576f2f`. The
`dealswift-loadtest` worker DOES serve the analytics fix (probe 2026-10-07:
104 routes / 0 server faults).

| Commit | What | Evidence |
| --- | --- | --- |
| `a0c9ec6` | **CRM analytics phantom columns** — `contracts.lead_id`, `message_events.opened_at`, `leads.zip_code` never existed; joins now use `seller_lead_id = l.id::text`, opens report honestly 0, regional view uses `zip`. New `schemaColumnTruth.guard.test.ts` static tree-scan guard + regression samples; `qa-page-probe` parameterised with all `analytics/crm` view variants | guards 8/8; oxlint 0/0; tsc clean; utils+pglite suites 1146 pass / 0 fail; **probe 104 routes / 0 SERVER_FAULTS, all 8 crm variants 200 incl. `groupBy=zipCode`** |
| `4036224` | `qa-accept.mjs` + `qa-page-probe.mjs` — legal-acceptance setup + authenticated page-route HTTP baseline | probe: 104 routes, 0 server faults (2026-10-07) |
| `8681150` | **run-migrations silently skipped commented statements** (deployed live 500). Comment-gated statements never ran: **388 of 773** statements applied corpus-wide, **1 of 13** CREATE TABLEs in 099, then "All migrations complete!" + exit 0. Also fixed a semicolon-then-trailing-comment merge in 082 and 3 swallowed `.catch` sites in `rewards/page.tsx` | 9 new guard tests; 3133 pass / 26 skip / 0 fail; gate PASS |
| `7e63233` | docs(matrix): V3 complete incl. rewards page | — |
| `2a6bc1a` | **V3-UI** rewards page + gamification sidebar gating | — |
| `a857b31` | docs(state): Y1/U1 and X1 verified at `68a67b4` | — |
| `68a67b4` | **X1 VERIFIED** — `entitlements.ts` fails closed on every degraded input | 16 tests |
| `a5fc054` | **Y1/U1 VERIFIED** — disabled stages never reported active | 15 + 28 tests |
| `ed683e5` | **V3** reward layer: migration 099 + economy + exactly-once claims | 58 tests |
| `141e063` | `/api/rewards` behind session + ON/OFF gates | 13 tests |
| `d5d6094` | `x-real-ip` caveat closed | 4 tests |
| `dac5d6e` | Better Auth limiter resolves client IP from the canonical trust list | 136 tests |

Gates at `a0c9ec6`: typecheck (`tsc -p tsconfig.typecheck.json --noEmit`) clean,
oxlint 0/0 on changed files, schema-truth + SQL-fragment guards 8/8, utils +
pglite suites **1146 passed / 0 failed**, page probe **104 routes / 0
SERVER_FAULTS** against `dealswift-loadtest`.
Gates at `8681150`: typecheck `TC_EXIT=0`, oxlint 0/0, **3133 passed / 26 skipped /
0 failed** (290 files), MIGRATION_GATE PASS (99 fresh-install + 101 idempotent
re-run, 17/17 tables).

⚠️ Keep this value current on every state commit — it has been stale before, and
a checkpoint whose HEAD does not match the repository is exactly how a new model
re-audits from scratch. Verify with `git log --oneline -3`.

## NEXT ACTION

**G2 — root-cause the intermittent `GET /` 500.** Diagnostics are live
(`a576f2f`, Worker `85de11a9`); on the next occurrence run
`wrangler tail --format pretty` and grep `[worker:unhandled]`. 40/40 no-repro
so far — act only on new evidence.

Queue, in order:

1. **X1 / Y1 / U1** — ✅ CLOSED `a5fc054`, `68a67b4`. Do not redo.
2. **V3-UI** — ✅ CLOSED `2a6bc1a`. Do not rebuild.
3. **QA-ACCEPT** — ✅ CLOSED (legal acceptance recorded; `qa-accept.mjs` +
   `qa-page-probe.mjs` committed `4036224`; probe 104 routes / 0 SERVER_FAULTS).
4. **Analytics phantom columns** — ✅ CLOSED `a0c9ec6` (all 8 `analytics/crm`
   variants 200, incl. `groupBy=zipCode` and `view=outreach`).
5. **G2** — *(NEXT)* intermittent `GET /` 500, cause unidentified.
6. **G1b** — Free-plan resource ceiling (Cloudflare 1102); owner decision.
7. **Deployment** — none of this is deployed to production; last live Worker is
   `85de11a9`. Always `yarn cf:build` before `scripts/wrangler-deploy.mjs`.
8. `BLOCKED-EXTERNAL`: Stripe live keys/webhook secret, Apollo keys, Bedrock,
   Google OAuth, Workers paid plan.

Open findings that must not be confused with completed work:

1. **Intermittent `GET /` 500** — diagnostics live (`a576f2f`, Worker `85de11a9`);
   **root cause unresolved**. Next occurrence: `wrangler tail --format pretty`,
   grep `[worker:unhandled]`.
2. **503 under sustained load** — **zero 5xx across 108 concurrent requests** on
   the isolated worker, but probe5/probe6 (2026-10-06) hit alternating 200/503
   under sustained sequential probing with `wrangler tail` confirming **CPU
   limit hit (Free plan)** — sustained traffic trips the ceiling too, not just
   bursts. Homepage warm median 124ms; cost is isolate cold start. Owner
   decision (G1b).
3. **Sign-in rate-limit "race" — WITHDRAWN, FALSE POSITIVE** (`d2eb0fe`). Limiter
   HOLDS (3,3,3,3,1 admitted vs limit 3, 64 concurrent requests). The old
   "admitted=4" was a fixed-window boundary artifact. **Do not rewrite it.**

### ISOLATED ENVIRONMENT EXISTS — use it, do not recreate

`apps/web/wrangler.loadtest.jsonc` → Worker **`dealswift-loadtest`**, 32 secrets
provisioned, **disjoint from the apex**. ⚠️ `dealswiftautomation.com` and
`dealswift-app.romanshumates1.workers.dev` are **THE SAME WORKER** — "workers.dev"
is **not** isolation. Probe scripts refuse to run unless `BASE` contains
`loadtest`. **All concurrency/load work belongs here.**

Never load-test the live apex; a previous session caused a real ~90s outage.

## THE `run-migrations.mjs` TRAP — read before touching migrations

`db/migrations/` is applied by **three different runners** and they are not
interchangeable:

| Runner | Splitter | Used by |
| --- | --- | --- |
| `scripts/migrate.mjs` | its own `splitSql` | `DEPLOY.md`, docker seed |
| `scripts/migration-gate.mjs` | `scripts/lib/split-sql.mjs` (**vetted**) | the PASS/FAIL gate |
| `scripts/run-migrations.mjs` | its own copy | single-file apply |

`run-migrations.mjs` drifted from the vetted splitter and lost statements
silently. **MIGRATION_GATE PASS does not imply `run-migrations.mjs` is correct** —
they are different code paths. That is now pinned by
`scripts/run-migrations.guard.test.ts`, which asserts the two agree statement
for statement across all 99 files. If you add a migration and the gate passes,
confirm the guard still passes too.

## DO NOT REPEAT (learned the hard way)

- **Do not re-audit `COMPLETE` / `LIVE VERIFIED` matrix rows.** That is the
  model-switch loop this file exists to prevent. Check the matrix first.
- **Do not declare a feature absent from one grep or one directory.** Ten
  false negatives are already recorded in the matrix (wrong path, wrong name).
  Before "ABSENT": check `src/**`, `api/**` routes, DB migrations, git history
  and branches.
- **Do not trust a passing gate as proof a sibling code path is also correct.**
  This is how the migration defect survived: `MIGRATION_GATE: PASS` while
  `run-migrations.mjs` applied half the corpus. Diff the paths.
- **Do not load/concurrency/CPU-stress the production apex.** A prior session
  caused a real ~90s outage. All of that belongs on `dealswift-loadtest`.
- **Do not trust `x-forwarded-for`** as a client IP. Use the canonical
  `clientIp.ts` trust list; a new test fails if `auth.ts` and `clientIp.ts`
  disagree.
- **Do not claim a negative result without a control.** When tailing logs to
  prove a warning is *gone*, first prove the tail can surface *a* warning.

## CURRENT SCORE

**8.5/10.** Unchanged by this session, and deliberately so: everything fixed
here was a *correctness* defect, not a missing capability. Full gate green does
not move the score; it is the baseline the score is measured against.

The ceiling is set by three *unmeasured* items, none of them code-fixable here:

- no money-moving path has live evidence (Stripe is test-mode verified; signed
  webhook delivery to the deployed Worker is unproven)
- 503s under sustained load (Free plan, not configurable)
- intermittent homepage 500, cause unidentified

`PRODUCTION_ENGINEERING_AUDIT.md` says 6/10. **It is stale** — dated 2026-10-03
against `c87d510`, and superseded by the matrix. Do not act on it.

## WITHDRAWN DEFECT — `/dashboard` "45s timeout" NEVER EXISTED (`f0074e2`)

Measured on Worker `8b0da56b`, authenticated, real browser: HTTP **200**, DOM
ready **219ms**, content visible **548ms**, heading `Welcome back, QA Audit Bot`.
The harness awaited `waitUntil: 'networkidle'`, which never settles on an
authenticated page (shell RSC prefetch, React Query revalidation, onboarding
PATCH on mount). **The instrument was wrong, not the product.** Endpoints behind
it measured 83–405ms. Do not "fix" dashboard performance — there is no evidence
of a defect.

## LIVE-VERIFIED (authenticated, Worker `8b0da56b`)

`routes=6 clean=6 noisy=0` — the first genuinely clean authenticated run in this
project (`f0074e2`). Single sequential browser run; no load testing, per the
production safety rule.

| Route | Status | DOM ready | Mock data | Console | Page errors | Boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | 200 | 268ms | none | 0 | 0 | none |
| `/campaigns` | 200 | 248ms | — | 0 | 0 | none |
| `/lead-finder` | 200 | 298ms | — | 0 | 0 | none |
| `/settings/billing` | 200 | 432ms | — | 0 | 0 | none |
| `/achievements` | 200 | 206ms | **none** | 0 | 0 | none |
| `/inbox` | 200 | 258ms | **none** | 0 | 0 | none |

`ERR_ABORTED` counts are **benign** and tracked separately: measured 19 API
requests initiated / 5 aborted on `/dashboard`, **0 failures across 10s idle**,
every aborted endpoint returning 200 on a direct call, and
`/api/user/preferences` requested **twice** — the strict-mode double-mount
signature. Real failures still count.

---

## COMPLETED RECENTLY

| Commit | What | Verification |
| --- | --- | --- |
| `cab6955` | Restored canonical `src/instrumentation.ts`; added sync contract guard for the required OpenNext Worker stub | **6/6 targeted tests; lint 0/0; `cf:build` passed; final handler asserted patched. Not deployed.** |
| `52ad8e5` | Aborted static chunks classified benign (asset confirmed served 200/28KB) | **FULL GATE: 3006 tests passed, 0 failed; build OK; browser clean=6 noisy=0** |
| `f0074e2` | `/dashboard` "45s timeout" — **harness bug, defect disproven**; `networkidle`→`domcontentloaded`; benign aborts separated | 6/6 routes 200, DOM ready 153–503ms |
| `0437912` | QA harness: creds no longer mangled by `cmd`; FATAL when logged out; mock-leak assertion added | **Live on Worker `8b0da56b`**: `/achievements` + `/inbox` 200, mockLeak=0, 0 console/page errors |
| `fa43bd0` | `/achievements` + `/inbox` now render REAL data (were hardcoded mock rows); thread selects `body`; dead controls removed | 44/44 related suites; 9/9 endpoints.contract; typecheck + oxlint clean; live-verified above |
| `6b30d2c` | Achievement points awarded exactly once (was repeatable by any caller); POST now gamification-gated; progress validated | **RED 8 failed/3 passed → GREEN 11/11**; 44/44 across achievements/conversations/leaderboard/gamification |
| `ff3b262` | Tenant-isolation guard given an I/O timeout budget (fixed the suite's only failure) | 2 passed in 339ms; 27 passed across sibling guards |
| `2ea6db3` | Referral share links pointed at the real signup route (`/signup` 404'd in production) | 14 passed; live 404 reproduced pre-fix |
| `27cae46` | Single source for `/api/user/preferences` reads | pre-existing |

## ⚠️ FABRICATED-DATA CLASS — read before trusting any "LIVE VERIFIED" UI row

Ten false negatives were found earlier (code missing that was assumed absent).
This class is the **opposite** and had never been searched for: pages that
**exist, return 200, and display invented data**. They survive every
"does it exist?" audit. Both were found under requirements already marked
verified.

| Where | What it showed | Now |
| --- | --- | --- |
| `/achievements` | Hardcoded 20 rows after a fake `setTimeout(500)`; never called the API. Fake points, fake 2024 dates, invented "$500,000 Platinum Club" tier | Real `fetch` + server aggregates (`fa43bd0`) |
| `/inbox` | `return data.length > 0 ? data : mockConversations;` — **an empty inbox rendered four strangers' rows**, and an outage was indistinguishable from success | Real fetch; error ≠ empty (`fa43bd0`) |
| Contact panel | Hardcoded Stage "Interested", Score 85, "123 Main St, Miami FL" | Real fields (`fa43bd0`) |
| Achievement POST | Credited points whenever the **request** said `unlock` — repeatable | Award on real transition only (`6b30d2c`) |

**When verifying a UI requirement, confirm the page actually CALLS its endpoint.**
A 200 plus a passing API test proves nothing if the component never issues the
request. `/leaderboard` was already correct and says so in a comment — that is
the pattern to expect.

## VERIFIED FACTS

Reusable. Do not re-verify unless the relevant code, deployment or environment changes.

- **`/signup?ref=` is FIXED IN PRODUCTION.** It returned 404; it now returns
  **307 → `/account/signup`**, with `?ref=CODE` and `&plan=pro` both preserved,
  landing on a 200 whose HTML contains the ref. Verified live 2026-10-04.
- **Referral banner renders on the live homepage** (3/3 requests 200) and
  `/referrals` returns 200. LIVE VERIFIED.
- **The deployed production Worker is `85de11a9`, built from commit `a576f2f`**
  (2026-10-04). The older `499ceb4c` / `5c52120` figure is superseded.
- **The Free-plan CPU ceiling is RESOLVED for authenticated APIs.** The old
  "15/24 routes 503 / /dashboard 12.4s" no longer reproduces. Live 2026-10-04:
  sign-in 200; `/api/dashboard/summary` 200 in 964ms **10/10 consecutive**;
  `/api/usage` 504ms; `/api/credits` 365ms; `/api/system/health` 180ms.
- ✅ **Authenticated PAGE routes ARE verified.** Legal acceptance was recorded
  for the QA account; `scripts/qa-page-probe.mjs` (committed `4036224`) reports
  **104 routes / 100 OK / 4 benign redirects / 0 SERVER_FAULTS** against
  `dealswift-loadtest` (2026-10-07). The old "every route 307s to
  `/legal/accept`" note is historical — do not re-open it.
- ✅ **CRM analytics schema-truth fix (`a0c9ec6`).** `contracts.lead_id`,
  `message_events.opened_at` and `leads.zip_code` were phantom columns that
  500'd the outreach and regional-zip views. Joins now use
  `seller_lead_id = l.id::text`, opens report honestly 0, regional uses
  `leads.zip`. Pinned by `schemaColumnTruth.guard.test.ts` (static tree scan +
  regression samples). All 8 `analytics/crm` variants 200 on the deployed
  loadtest worker.
- ⚠️ **`/contacts` is a 404 because that route genuinely does not exist** — only
  the public `/(marketing)/contact` is registered. The CRM contacts requirement
  is **CLOSED** via `/crm` (matrix false negative #8). Not a broken link; do not
  create a duplicate page.
- ⚠️ **`scripts/wrangler-deploy.mjs` does NOT rebuild.** It deploys whatever is
  already in `.open-next`. Running it after a code change ships stale artifacts
  *and reports success*. Always `yarn cf:build` first. This cost a full deploy
  cycle on 2026-10-04.
- ⚠️ **`scripts/deployed-browser-qa.mjs` HANGS** — and the cause is now understood.
  It sweeps ~24 routes across two viewports with **no delay between routes**,
  each allowing `domcontentloaded` 45s + `load` 20s + `networkidle` 12s. That is
  exactly the burst pattern that trips the shared CPU ceiling, so the script was
  very likely being throttled into its own long timeouts rather than being stuck
  on a bug. **Do not re-run it against production as written.** Use
  `scripts/authenticated-console-check.mjs` (hard per-route timeout, fewer
  routes), and add cooldowns between navigations if you extend it.
- ⚠️ **THE BINDING CONSTRAINT: burst load breaches the Free-plan CPU ceiling.**
  **Confirmed production incident:** three consecutive `GET /` returned
  **503 / Cloudflare 1102**, plus 503 on all four routes in a browser sweep;
  recovered to 200 after ~90s cooldown. Single requests are healthy (pages
  193–315ms; dashboard summary 10/10 clean).
  `limits.cpu_ms` is **rejected on the Free plan**, so this cannot be configured;
  it can only be bought or avoided. **Owner decision.**
- 🚨 **DO NOT load-test production. MANDATORY STANDING RULE.**
  **On 2026-10-04 this session caused a real incident**: a browser sweep tripped
  the CPU ceiling and `GET /` returned **503 / Cloudflare 1102** to real visitors
  for ~90s. Never run burst/concurrency/load/CPU-exhaustion tests against the
  live apex. Use local, preview, staging, workers.dev test deploys, mocks or
  PGlite. Keep live testing to a handful of requests with cooldowns.
  Full rule: `DEALSWIFT-AI-PROJECT-CHECKPOINT.md` → PRODUCTION SAFETY RULE.
  **If you see 503s, stop polling and wait 60–90s** — polling keeps the ceiling
  saturated. `/api/system/health` returning 200 while `/` still 503s is the early
  signal that it has cleared.
- **AI credit caps are enforced ATOMICALLY in Postgres** and verified on a real
  engine (PGlite): *"never oversells the cap under CONCURRENT consumption"*, plus
  daily/weekly/monthly denial, period boundaries, tenant isolation, and release
  never going negative — 10/10 pass, 2026-10-04. **Do not rebuild this.**
- **Purchased credits are correctly excluded** from the included-credit caps
  (`aiCreditLimits.ts:181-183`, `aiCreditGate.ts:103-108`).
- Sign-in CPU: 200 in 490ms; throttle refuses in 75ms pre-hash. Deployed at
  Worker `dd557bc1`. (Pre-dates this session; not re-verified here.)
- Referral attribution chain is pinned by 10 tests including 401/403/400 paths,
  self-referral rejection and legacy `?ref` preservation.

## OPEN BLOCKERS

**External — cannot be resolved in code:**

| Blocker | Blocks |
| --- | --- |
| `STRIPE_SECRET_KEY` absent | ALL live billing, subscriptions, payments, payouts |
| Apollo API key absent | live Apollo lead search |
| Bedrock credentials absent | live AI provider calls |
| Google OAuth credentials absent | live Google sign-in |
| Workers plan decision (owner) | full CPU headroom |

**Internal — unresolved production defects:**

1. **Intermittent `GET /` 500.** Cause UNIDENTIFIED. `TypeError:
   components.ComponentMod.handler is not a function`. Did not reproduce in
   40/40 controlled requests. The opennextjs chunk-loading hypothesis was
   investigated and **DISPROVEN** (deployed `handler.mjs` verified sound:
   2038 cases, all `require()` inlined, zero absolute paths). Do not re-investigate
   the chunk hypothesis without new evidence.
2. **Free-plan CPU ceiling.** Sign-in is FIXED (`c87d510`, deployed). Authenticated
   *page renders* remain broken: 15/24 routes 503, `/dashboard` 12.4s. Partially
   addressed by `503845f` (dashboard fan-out collapsed to one Worker invocation,
   deployed evidence still pending).

## CRITICAL WARNINGS

- ⚠️ **THE INHERITED MATRIX WAS WRONG TEN TIMES.** Every "ABSENT" claim was
  re-verified individually and ten were false negatives: AI credit caps, earnings
  date filters, AI calling, voice selection, trial demo data, referral banner,
  **CRM contacts page**, **gamification XP**, and two others.
  **Before rebuilding anything marked ABSENT, search by CONCEPT — file contents,
  DB columns, exports, the 86-page/370-route build manifest — not by directory
  name.** `api/crm`, `api/contacts`, `api/v1/contacts` and `app/crm` all exist
  under names you would never guess. Directory search alone has produced a false
  negative every single time it was trusted.
- ⚠️ **NEVER PASS QA CREDENTIALS VIA `cmd /c set VAR=value`.** cmd re-parses that
  line, so Node received values that were not the ones in the file. This produced
  a browser `401 Invalid email or password` **while a direct API call with the same
  credentials returned 200** — indistinguishable from a dead production login.
  Fixed in `0437912`: `authenticated-console-check.mjs` now reads
  `$TEMP\qa-cred.json` inside Node. **Production sign-in is healthy** — verified
  200, `hasSession: true`, redirect to `/dashboard`. Do not re-diagnose it.
- ⚠️ **A CLEAN BROWSER SWEEP MEANS NOTHING IF THE SESSION WAS NOT REAL.** The same
  script used to continue after sign-in failed, verifying every route logged out —
  and unauthenticated pages render clean, so it reported tidy results. It now
  prints `SESSION_PROBE` and a FATAL when `hasSession !== true`. Always read that
  line before trusting any route result from it.
- ⚠️ **THE MATRIX HAS PRODUCED TEN FALSE NEGATIVES *AND* FALSE POSITIVES.**
  False negatives (assumed absent, actually present) are recorded above.
  False positives — **code that exists, returns 200, and shows invented data** —
  were never searched for until 2026-10-04 and are just as dangerous: they
  certify a requirement as verified when the verification proves nothing.
  `/achievements` and `/inbox` both passed "live 200" while rendering hardcoded
  rows. **Before believing any UI evidence, confirm the component actually CALLS
  its endpoint.** A passing API test does not help if the page never issues the
  request.
- ⚠️ **CHECK YOUR OWN SEARCH FLAGS BEFORE BELIEVING A ZERO.** This cycle I used a
  non-recursive `Get-ChildItem -File` on `apps/web/db/`, which silently skipped
  `db/migrations/`, and nearly recorded an 11th false negative claiming the
  achievements tables did not exist. They do — in migration 068. Use
  `git ls-files` to enumerate files reliably before concluding anything is absent.
  The pre-existing `.tmp-*.log` files and `.tmp-qa-creds.env` are untracked
  scratch. **`.tmp-qa-creds.env` may contain credentials — never commit it and
  never print its contents.**
- `git status` shows `docs/superpowers/PRODUCTION_ENGINEERING_AUDIT.md` as
  untracked; it is a *historical, partly incorrect* report. Treat as context, not
  truth (priority order: repo > checkpoint > matrix > reports).

## DO NOT REPEAT

- Do **not** re-implement/rework AI credit weekly/daily caps — they exist and are tested.
- Do **not** "fix" the sign-in rate limiter. The "RACY: limit bypassed" verdict was
  a **false positive** from a fixed-window boundary artifact in the measuring
  script. Mid-window retest on the isolated worker: admitted 3,3,3,3,1 against a
  limit of 3 over 64 concurrent requests — it **holds** (`d2eb0fe`). Acting on
  the old claim would have meant rewriting a working security control.
- Do **not** treat `dealswift-app.romanshumates1.workers.dev` as an isolated
  environment. It is **THE SAME WORKER** as the apex (no `routes` entry in
  wrangler.jsonc). Use **`dealswift-loadtest.romanshumates1.workers.dev`**
  (`wrangler.loadtest.jsonc`), which is genuinely disjoint.
- Do **not** run `_ratelimit-race.mjs` / `_argon2-parallel.mjs` against the apex.
  They now refuse unless `BASE` contains `loadtest`; that guard exists because a
  past session caused a real ~90s outage by bursting production.
- Do **not** re-add "the homepage 500 has no telemetry" as an open finding. The
  worker `fetch` wrapper logs unhandled throws as `[worker:unhandled]` with
  `suspected_resource_kill` (`a576f2f`). The 500 itself is **still unfixed and
  unreproduced** — only its observability changed. Do not read that as a fix.
- Do **not** "fix" `/dashboard` performance. **The 45s timeout defect never
  existed** — it was the QA harness waiting on `networkidle` (`f0074e2`). Real
  measurement: HTTP 200, DOM ready 219ms, content visible 548ms. The harness now
  reports `domReady` per route, so genuine slowness would show as a number.
- Do **not** treat `ERR_ABORTED` counts as failures. Measured: 19 API requests
  initiated / 5 aborted on `/dashboard`, **0 failures in 10s idle**, every aborted
  endpoint returning 200 directly, and `/api/user/preferences` requested twice —
  the strict-mode double-mount signature. The harness separates `benignAborts`.
  Timeouts, 4xx/5xx and connection errors still count as failures.
- Do **not** re-run the fabricated-data sweep. All 76 authenticated `page.tsx`
  files were checked on 2026-10-04 by **shape** (`|| mock`, `?? mock`,
  `if (!res.ok) return mock…`, pages with no API call, hardcoded name/address
  literals) and **no further instances were found**. The 17 pages that make no
  API call were each inspected and are legitimate: marketing/legal (static),
  `campaigns/planner` (a calculator), `admin/users` (4-line re-export of a
  component that does fetch), `(dashboard)/automation`, `settings/accessibility`,
  and two access-state pages.
- Do **not** treat the 19 `if (!res.ok) return []` sites as this same defect —
  they return an empty state, not fabricated content. Known weaker error
  affordance, deliberately not bundled; do not "fix" them as a side effect.
- Do **not** re-implement/rework the achievement points-award guard — fixed in `6b30d2c`
  with 11 tests. The award now depends on a real unlocked transition, not on the request.
- Do **not** re-wire `/achievements` or `/inbox` to their APIs — done in `fa43bd0`.
  Do not reintroduce a mock fallback there; that fallback was the defect.
- Do **not** re-audit whether the achievements/leaderboard backends exist — they do,
  with schema in `db/migrations/068_user_profile_and_gamification.sql`. Note
  `apps/web/db/migrations/` is the real path: `apps/web/db/` also holds loose
  `.sql` files, and a non-recursive search of the parent **misses the migrations**.
- Do **not** enable the inbox message composer without an explicit product decision —
  it triggers real outbound SMS/email.
- Do **not** re-implement/rework the sign-in pre-hash cost guard — deployed and measured.
- Do **not** re-investigate the opennextjs chunk-loading cause of the homepage 500 — disproven.
- Do **not** re-run the full 3013-test suite for an isolated change. It takes ~6
  minutes and `collect` is 268s. Use targeted runs.
- Do **not** rebuild the referral-link fix — landed in `2ea6db3`.
- Do **not** re-audit billing/tax/withdrawals absent a dependency change.

## REQUIRED FILES TO READ

1. `DEALSWIFT-AI-PROJECT-CHECKPOINT.md` — full state
2. `UNIFIED-REQUIREMENTS-MATRIX.md` — per-requirement status + evidence
3. `apps/web/src/app/api/utils/aiCreditDb.ts` — where NEXT ACTION begins