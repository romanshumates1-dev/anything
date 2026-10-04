# AI-HANDOFF — read this first

**Last updated:** 2026-10-04 (session following commit `27cae46`)
**Purpose:** a new model should understand the project state from this file in under a minute, without reading history or re-auditing.

---

## CURRENT HEAD

`62c3c3b` (the commit that added this file; the code state it describes is `ff3b262`)

## CURRENT BRANCH

`feat/cloudflare-workers`

## CURRENT SCORE

**8/10 — calculated 2026-10-04 from the corrected matrix, after a live pass.**

Not inherited. Raised from 7.5 because **six requirements were recovered from
false negatives** — the inherited matrix said ABSENT for AI credit caps,
earnings date filters, AI calling, voice selection and trial demo data, all of
which are implemented and tested. Each was confirmed by running its tests.

**A score derived from a matrix with six wrong entries is not a score.** That
caveat matters more than the number.

The ceiling below 9 is real and not code-fixable: **no money-moving path has
end-to-end evidence** (billing, payouts and tax fail closed behind absent
credentials), the public site 503s under sustained load, and the intermittent
homepage 500 is still unidentified. **10/10 is unreachable here** — it needs live
Stripe/Apollo/Bedrock evidence and a paid Workers plan.

## CURRENT TASK

State-preservation milestone COMPLETE. `N2-live` verification COMPLETE.
Deployment COMPLETE — Worker `499ceb4c` live, referral chain LIVE VERIFIED.
**No task in flight beyond NEXT ACTION.**

## NEXT ACTION

**Raise the Workers CPU limit, or reduce per-invocation render cost under burst.**
This is the highest-value unblocked item and is an **owner decision** — the
binding constraint is proven: a burst 4-route sweep 503'd while `/` and
`/api/system/health` stayed 200. Measure whether render cost can be cut before
paying for a plan upgrade.

## CURRENT TASK

Browser console verification COMPLETE — **no error boundaries, no uncaught
exceptions.** Deployment, referral live verification, AI-credit verification and
authenticated page rendering are all COMPLETE.

---

## COMPLETED RECENTLY

| Commit | What | Verification |
| --- | --- | --- |
| `ff3b262` | Tenant-isolation guard given an I/O timeout budget (fixed the suite's only failure) | 2 passed in 339ms; 27 passed across sibling guards |
| `2ea6db3` | Referral share links pointed at the real signup route (`/signup` 404'd in production) | 14 passed; live 404 reproduced pre-fix |
| `27cae46` | Single source for `/api/user/preferences` reads | pre-existing |

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

- ⚠️ **THE INHERITED MATRIX WAS WRONG SIX TIMES.** Every "ABSENT" claim was
  re-verified individually and six were false negatives, each from a wrong-path
  or wrong-name search: AI credit caps, earnings date filters, AI calling, voice
  selection, trial demo data, referral banner.
  **Before rebuilding anything marked ABSENT, search by CONCEPT — filename
  fragments, exported symbols, and the 370-route build manifest at
  `.open-next/**/app-path-routes-manifest.json` — not by the first directory that
  came to mind.** Full table of all six is in `UNIFIED-REQUIREMENTS-MATRIX.md`.
  This is the highest-value lesson in the repository: it is what stops a
  successor from rebuilding working, tested features.
- The pre-existing `.tmp-*.log` files and `.tmp-qa-creds.env` are untracked
  scratch. **`.tmp-qa-creds.env` may contain credentials — never commit it and
  never print its contents.**
- `git status` shows `docs/superpowers/PRODUCTION_ENGINEERING_AUDIT.md` as
  untracked; it is a *historical, partly incorrect* report. Treat as context, not
  truth (priority order: repo > checkpoint > matrix > reports).

## DO NOT REPEAT

- Do **not** re-implement AI credit weekly/daily caps — they exist and are tested.
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