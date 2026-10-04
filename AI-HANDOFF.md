# AI-HANDOFF — read this first

**Last updated:** 2026-10-04 (session following commit `27cae46`)
**Purpose:** a new model should understand the project state from this file in under a minute, without reading history or re-auditing.

---

## CURRENT HEAD

`62c3c3b` (the commit that added this file; the code state it describes is `ff3b262`)

## CURRENT BRANCH

`feat/cloudflare-workers`

## CURRENT SCORE

**7/10 — calculated 2026-10-04 from the corrected requirements matrix.**

Not inherited. The prior "6/10" came from a matrix now known to be materially
inaccurate, so it was not authoritative. It moved **up** because AI credit
limiting is a whole requirement recovered from a wrong-path search error, and
its evidence turned out stronger than recorded (real-engine integration tests,
including a concurrency test).

It is not higher because: two production defects remain open (homepage 500,
Free-plan CPU ceiling), and **zero money-moving paths have end-to-end
evidence** — billing, payouts and tax all fail closed behind absent
credentials. That alone prevents 9/10.

## CURRENT TASK

State-preservation milestone COMPLETE. `N2-live` verification COMPLETE.
Deployment COMPLETE — Worker `499ceb4c` live, referral chain LIVE VERIFIED.
**No task in flight beyond NEXT ACTION.**

## NEXT ACTION

**Re-crawl the authenticated routes and measure whether `503845f` resolved the
15/24 503s.** Run `scripts/deployed-browser-qa.mjs`.

## CURRENT TASK

Deployment + live verification COMPLETE. Worker `499ceb4c` is live and the
referral chain is **LIVE VERIFIED**. No task in flight beyond this next action.

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
- ⚠️ **`scripts/wrangler-deploy.mjs` does NOT rebuild.** It deploys whatever is
  already in `.open-next`. Running it after a code change ships stale artifacts
  *and reports success*. Always `yarn cf:build` first. This cost a full deploy
  cycle on 2026-10-04.
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

- **The old root matrix was WRONG and has been replaced.** If you find a claim
  that AI credit ceilings are "ABSENT" / "NOT STARTED", it is the discarded
  false negative. They ship in `src/app/api/utils/`, NOT `src/app/api/credits/`.
  **A wrong-path grep caused this error — verify the path before believing an
  absence claim.**
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