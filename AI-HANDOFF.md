# AI-HANDOFF — read this first

**Last updated:** 2026-10-04 (session following commit `27cae46`)
**Purpose:** a new model should understand the project state from this file in under a minute, without reading history or re-auditing.

---

## CURRENT HEAD

`ff3b262a13bc87f25e438b83b717cb1d5a1f44da`

## CURRENT BRANCH

`feat/cloudflare-workers`

## CURRENT SCORE

**PROVISIONAL — REQUIRES RECALCULATION FROM THE CORRECTED MATRIX.**

Do **not** treat the inherited "6/10" as authoritative. It was computed from a
matrix that was demonstrably wrong (see AI-CREDIT CORRECTION below), so it is
neither a floor nor a ceiling. Recalculate from `UNIFIED-REQUIREMENTS-MATRIX.md`
before quoting any number.

Two independent reasons it cannot move up yet: two production defects are still
open (homepage 500, Free-plan CPU ceiling), and no money-moving path has
end-to-end evidence because provider credentials are absent.

## CURRENT TASK

State-preservation milestone COMPLETE (3 commits landed). **No task in flight.**

## NEXT ACTION

**Verify the AI-credit period caps against the live database, then re-derive the
score from the corrected matrix.**

Concretely: confirm `ai_credit_usage` rows carry `week`/`month` period keys and
that `deriveAiCreditPeriodCaps` output (`weekly = floor(monthly/4)`,
`daily = floor(monthly/20)`) matches what is actually persisted. The caps are
proven by 19 unit tests and a static route-gating ratchet, but **not yet proven
against the real ledger**. That is the single highest-value gap, because it is
the difference between "the math is right" and "the math runs in production".

File to start: `apps/web/src/app/api/utils/aiCreditDb.ts` (the SQL side of
`consumeIncludedPeriods`).

---

## COMPLETED RECENTLY

| Commit | What | Verification |
| --- | --- | --- |
| `ff3b262` | Tenant-isolation guard given an I/O timeout budget (fixed the suite's only failure) | 2 passed in 339ms; 27 passed across sibling guards |
| `2ea6db3` | Referral share links pointed at the real signup route (`/signup` 404'd in production) | 14 passed; live 404 reproduced pre-fix |
| `27cae46` | Single source for `/api/user/preferences` reads | pre-existing |

## VERIFIED FACTS

Reusable. Do not re-verify unless the relevant code, deployment or environment changes.

- **`/signup?ref=` returns 404 in production; `/account/signup` returns 200.**
  Reproduced live 2026-10-04. Fixed in `2ea6db3`, not yet deployed.
- **AI credit period caps ARE implemented and correct** — see correction below.
  19 unit tests + 5 static gate tests + 3 synthetic-gate tests pass.
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