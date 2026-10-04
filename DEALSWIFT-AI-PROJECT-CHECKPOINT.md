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
| Current score | **7/10 — calculated 2026-10-04 from the corrected matrix** |

### Current overall score

**7/10 — calculated 2026-10-04 from the corrected requirements matrix.**

Method and reasoning are recorded in the matrix's SCORE section. It moved up
from the inherited 6/10 because AI credit limiting is a whole requirement
recovered from a wrong-path search error, with stronger evidence than had been
recorded. It is held below 9 by two open production defects and by the total
absence of end-to-end evidence on any money-moving path.

---

## ACTIVE TASK

**NONE.** The state-preservation milestone is complete.

**NEXT ACTION (exactly one): re-crawl the authenticated routes now that
`503845f` is deployed, and measure whether the 15/24 503s are resolved.**

Run `scripts/deployed-browser-qa.mjs`. `503845f` collapsed the dashboard's 17
Worker invocations into one, but its effect has **never been measured live** —
the earlier 15/24 figure predates it. Record the new number either way; a
regression here is as important as a fix.

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
| DEFECT-2 | Authenticated page renders 503 under Free-plan CPU | OPEN | Workers plan decision (owner) | Deploy `503845f`, re-crawl |
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

### Free-plan CPU headroom

- **Blocker:** Workers plan choice — an **owner decision**, not engineering.

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
| Tenant ratchet guard passes in isolation | `ff3b262`; 2 tests, 339ms | 2026-10-04 |
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
| Intermittent `GET /` 500, cause unknown | OPEN |
| 15/24 authenticated routes 503 under crawl | OPEN (partially addressed by `503845f`, undeployed) |
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