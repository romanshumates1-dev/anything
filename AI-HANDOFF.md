# AI-HANDOFF — read this first

**Last updated:** 2026-10-04 (session following commit `27cae46`)
**Purpose:** a new model should understand the project state from this file in under a minute, without reading history or re-auditing.

---

## CURRENT HEAD

`fa43bd0` (real-data fixes for `/achievements` + `/inbox`; backend fix `6b30d2c`).
**This file's own commit follows — read `git log --oneline -3` for exact HEAD.**
⚠️ This value was stale (`62c3c3b`) for several commits; a checkpoint whose HEAD
does not match the repository is how a new model re-audits from scratch. Keep it
current on every state commit.

## CURRENT BRANCH

`feat/cloudflare-workers`

## CURRENT SCORE

**8.5/10 — after the absence-claim re-audit.** Not inherited. Raised from 8 on
evidence: three more requirements recovered from false negatives (CRM contacts UI
live 200, gamification XP live 200 + 11 tests). **Ten false negatives total.**

Capped below 9 by: no money-moving path has **live** evidence, the public site
503s under sustained load, and the homepage 500 is unidentified. **10/10 needs the
Stripe webhook round-trip, live Apollo/Bedrock, and a paid Workers plan.**

## CURRENT TASK

State-preservation milestone COMPLETE. `N2-live` verification COMPLETE.
Deployment COMPLETE — Worker `499ceb4c` live, referral chain LIVE VERIFIED.
**No task in flight beyond NEXT ACTION.**

## NEXT ACTION

**Continue the fabricated-data sweep beyond `/achievements` and `/inbox`.**
Those two are fixed, deployed and live-verified. The same defect class has not
been swept repo-wide.

1. Search authenticated pages for **fallback** patterns specifically, not just
   `const mock…`: `|| mock`, `?? mock`, `if (!res.ok) return`, `.length > 0 ? x
   : y`, and hardcoded literals inside JSX (the contact panel's "Interested" /
   "85" / "123 Main St" were literals, not an array, and a search for `mock`
   would never have found them).
2. `/admin/*` is the next candidate — it is the only other area where page-level
   fixtures appeared.
3. Verify each candidate by reading the page source and confirming it calls its
   endpoint, then browser-verify with an authenticated session.

## LIVE-VERIFIED (authenticated, Worker `8b0da56b`)

Verified 2026-10-04 with a real session (`hasSession: true`), single sequential
browser run — no load testing, per the production safety rule.

| Route | Status | Mock data | Console | Page errors | Error boundary |
| --- | --- | --- | --- | --- | --- |
| `/achievements` | 200 | **none** | 0 | 0 | none |
| `/inbox` | 200 | **none** | 0 | 0 | none |
| `/campaigns` | 200 | — | 0 | 0 | none |
| `/lead-finder` | 200 | — | 0 | 0 | none |
| `/settings/billing` | 200 | — | 0 | 0 | none |
| `/dashboard` | **TIMEOUT 45s** | — | 0 | 0 | none |

⚠️ **`/dashboard` still exceeds a 45s browser timeout** — pre-existing, unchanged
by `6b30d2c`/`fa43bd0`, and consistent with the known Workers CPU ceiling. This is
the strongest remaining symptom of that problem and is worth measuring next.

## CURRENT TASK

Fabricated-data sweep — `/achievements` + `/inbox` **DONE and LIVE VERIFIED**;
points-farming vulnerability fixed. Sweep of remaining pages is next.

## CURRENT TASK

Browser console verification COMPLETE — **no error boundaries, no uncaught
exceptions.** Deployment, referral live verification, AI-credit verification and
authenticated page rendering are all COMPLETE.

---

## COMPLETED RECENTLY

| Commit | What | Verification |
| --- | --- | --- |
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
- **The deployed Worker is `499ceb4c`, built from commit `5c52120`.**
- **The Free-plan CPU ceiling is RESOLVED for authenticated APIs.** The old
  "15/24 routes 503 / /dashboard 12.4s" no longer reproduces. Live 2026-10-04:
  sign-in 200; `/api/dashboard/summary` 200 in 964ms **10/10 consecutive**;
  `/api/usage` 504ms; `/api/credits` 365ms; `/api/system/health` 180ms.
- ⚠️ **Authenticated PAGE routes are still unverified** — every one 307s to
  `/legal/accept` because the QA account never accepted legal terms. This is a
  test-account gap, not a product defect. Fix the account before concluding
  anything about page rendering.
- ⚠️ **There is no CRM `/contacts` page.** `/contacts` 404s because the route
  genuinely does not exist — only the public `/(marketing)/contact` is
  registered. That is a missing feature, not a broken link.
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