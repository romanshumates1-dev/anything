# PRODUCTION HARDENING - MASTER STATUS MANIFEST

**This is the persistent source of truth for the mission.** Read this first,
then `PRODUCTION-HARDENING-CHECKPOINT.md`, then `ACCEPTANCE-MATRIX.md`.

Status values: NOT_STARTED | IN_PROGRESS | PARTIAL | BLOCKED | UNVERIFIED | COMPLETE
COMPLETE requires evidence. Code existing is NOT completion.

Last updated: 2026-10-01. Branch `feat/cloudflare-workers`.
Headline: **C4 full runtime gate green — build exit 0, browser QA 70/70, unit
2821/0, security 18/0, tenant 15/0 leaks, API probe PASS, E2E 2 passed.** The
gate also caught and fixed a severe defect: the app shell was withholding
*every* page's server-rendered HTML (0 visible text site-wide), which had
silently removed all crawlable text and the reviews schema.org markup.

## A. ORIGINAL 17 REQUESTED ITEMS

| # | Item | Status | Evidence / Remaining work |
|---|---|---|---|
| 1 | AI support + smaller optimized control | UNVERIFIED | Implemented (session 6) + adversarial suite green. Not re-verified in browser this session. |
| 2 | Long username/email sidebar scaling | UNVERIFIED | Implemented. Needs browser check with a long email. |
| 3 | Apollo lead source | BLOCKED | Needs `APOLLO_API_KEY`. Config gating/normalisation/dedup/attribution/credits implemented + tested. Only live credential check remains. |
| 4 | Third-party lead sources + pricing/upcharge | PARTIAL | Buyer discovery + upcharge implemented. Billing path not re-verified. |
| 5 | Free-trial demo/mock data | PARTIAL | 14-day trial created on signup (verified). Demo-data safety not re-audited. |
| 6 | Performance | UNVERIFIED | Original 5-10s complaint. No measurement this session. MUST measure. |
| 7 | Complete site functionality | PARTIAL | **Browser QA 70/70 confirmed at C4** (35 routes × desktop+mobile, 0 console errors, 0 non-2xx). All pages load and render. Authenticated interactive flows still not clicked through in a browser. |
| 8 | Shopify / purchases / withdrawals | PARTIAL | Architecture not decided (lead source vs checkout rail). Withdrawals exist. |
| 9 | Subscriptions / billing | UNVERIFIED | Stripe keys absent -> BLOCKED for live; plan gate passed (7 plans). |
| 10 | AI weekly/daily credit limits | COMPLETE | **C5 verified.** Included credits capped at M/4 weekly (25%) and M/20 daily (20% of weekly), keyed on UTC day / ISO week / calendar month. Purchased credits are a separate bucket the caps never touch. 58/0 tests incl. PGlite: cap denial, boundary reset, tenant isolation, no oversell under concurrency, repeated requestId no double-charge, purchased still served at cap. |
| 11 | Restricted signup setting | COMPLETE | `app_settings.signup_restrictions` = {restricted:true, domains:[dealswiftautomation.com]}. Verified: non-allowlisted domain -> 403. |
| 12 | Billing/payment UI + backend | PARTIAL | Tax/payout UI shipped (c068aed). Not re-verified. |
| 13 | Payout/earnings date filters | UNVERIFIED | Not checked this session. |
| 14 | Earnings/tax reporting | PARTIAL | **C5:** `/api/tax/report` buckets day/week/month/quarter/year in SQL (`date_trunc`), never in JS; tenant-scoped by BOTH user_id and organization_id; CSV export carries the disclaimer and `Cache-Control: no-store`. 166/0 financial tests. Not verified against real ledger volume or a downloaded file opened end-to-end. |
| 15 | Optional auto tax withholding | PARTIAL | **C5:** per-seller setting, OFF by default, rate validated as integer 0..10000 bps and rejected (400) rather than clamped; org resolved from session only (no mass-assignable tenant field); withheld inside the withdrawal transaction; release/compensation never goes below zero; withheld balance excluded from payout. 25/0 taxWithholding tests. |
| 16 | Premium UI/VFX/UX polish | IN_PROGRESS | Pricing React-key fix in progress. Full visual audit not done. |
| 17 | SEO | PARTIAL | **C4 fixed the critical half.** The app shell was server-rendering a spinner for every route, so indexable marketing pages had 0 crawlable text and `/reviews` schema.org never reached the HTML. After the fix: `/reviews` 1,036 chars + `AggregateRating` present, `/pricing` 6,013, `/faq` 4,247, `/trust` 2,900, `/how-it-works` 3,107. robots/sitemap/canonical still not re-audited. |

## B. DISCOVERED DEFECTS (all fixed unless noted)

| ID | Defect | Status | Evidence |
|---|---|---|---|
| #30 | Signup/session transaction visibility | COMPLETE | Synthetic signup 200 + session created. |
| #31 | Missing owner_user_id on org create | COMPLETE | Org auto-create logs success. |
| #32 | Nested SQL fragments (66 sites) | COMPLETE | scan-fragments = 0; hard-zero guard. |
| #33 | contracts.metadata missing | COMPLETE | Migration 092. |
| #34 | Rate-limit uuid vs text org id | COMPLETE | Migration 093. |
| #35 | Prompt-injection bypass of review | COMPLETE | Markers + human review. |
| #36 | Public endpoint leaked user_id | COMPLETE | api-probe asserts no user_id/author_id. |
| #37 | sql.unsafe bound as a value -> 2 x 500 | COMPLETE | Guard bans it in templates. |
| #38-#40, #43-#45 | Schema-nonexistent columns/tables (8 endpoints) | COMPLETE | All 8 now 200 (live). |
| #41 | /buyers `buyers.map is not a function` | COMPLETE (unverified in browser) | Response shape fixed; error surfaced. |
| #42 | /pricing React key warning | IN_PROGRESS | Fixed this session; browser re-verify pending. |
| #46 | dashboard/activity silent 500 -> [] | COMPLETE | Now 200. |
| #47 | weekly-progress returned zeros | COMPLETE | Now 200. |
| NEW | Auth endpoints logged nothing on 5xx | COMPLETE | api/auth/[...all] now logs >=500. |
| NEW | 48 users with no org membership (data) | UNVERIFIED | Historical orphans from pre-#31 era. Cleanup/audit NOT done. |
| NEW | Whole-tree scan guards flaky at 5s | COMPLETE | 30s timeouts. |
| #48 | Provider outage -> opaque 500 on 3 AI routes | COMPLETE | Shared `providerFailureResponse`: 502 + classified `failureClass`; raw provider text logged server-side only. `negotiation/analyze`, `templates/generate`, `conversations/message`. |
| #49 | AI credits burned on failed or invalid requests | COMPLETE | `templates/generate`: all input bounds now run BEFORE the credit gate (was: charged then 400). `conversations/message`: refund on provider failure AND on post-gate failure (persist/queue) via the outer handler; `negotiation/analyze` now reports the real `release()` outcome instead of hardcoding `creditReleased: true`. |
| #50 | **App shell withheld every page's server-rendered HTML** | COMPLETE | `Shell.tsx` returned a spinner instead of `children` whenever `useSession().isPending` — always true during SSR, since it is a client hook. Measured site-wide visible text was **0 chars** on `/reviews`, `/pricing`, `/faq`, `/trust`. Removed all crawlable text, the `/reviews` schema.org `AggregateRating`, and made LCP a spinner. Unknown session now renders as signed-out **for layout only** (sidebar is chrome, not an authz boundary). After: 1,036 / 6,013 / 4,247 / 2,900 chars respectively. Regression test: `Shell.test.tsx` "must not withhold page content". |
| #51 | Console 401 on every public page load | COMPLETE | `AccessibilityProvider` fetched `/api/user/preferences` unconditionally; anonymous visitors get 401, which the browser logs as an error. Now gated on having a session. Console errors + non-2xx across `/`, `/dashboard`, `/reviews`, `/settings` = 0. |
| #50 | Support chat dialog: no Escape, hidden panel still focusable | COMPLETE | Escape closes the dialog; the closed panel is `inert` (React 19) behind `aria-hidden`; launcher/panel ARIA wiring. |

## C. GATE STATUS (last full run, commit 21fabc7 + pricing fix)

| Gate | Result |
|---|---|
| typecheck | PASS exit 0 |
| unit suite | PASS 2645/0 (235 files) |
| build | PASS exit 0 |
| E2E | PASS 2 exit 0 |
| api-probe | PASS exit 0 |
| verify-sql-fixes | 13/13 |
| scan-fragments | 0 |
| browser QA | **70/70 PASS** (session 4) |`n| tenant-isolation/IDOR probe | **15 checks, 0 leaks, exit 0** |`n| production perf | warm 37-95ms; cold 445-1490ms; 5-10s claim NOT reproducible |

### C2. FRESH RE-RUN — 2026-09-30, commit 298b86a (AI failure-path repair)

| Gate | Result |
|---|---|
| typecheck | PASS exit 0 |
| unit suite | PASS 2808 passed / 0 failed (252 files passed, 1 skipped, 30 todo) |

The remaining gates (build, E2E, api-probe, verify-sql-fixes, browser QA) have
NOT been re-run since 21fabc7 — the table above does not cover 298b86a. One
transient failure was seen while the suite ran concurrently with typecheck
(`bankAccounts.security.test.ts` beforeAll hook timeout at 60s); it passes
10/10 in isolation in 8.5s, so it is a load flake, not a regression.

### C3. FRESH RE-RUN — 2026-09-30, commit 3e86c54 (silent-failure sweep + rate-limit bypass + download-authz)

Work: `trustSignals.ts` 6→0, `campaigns/monitor/route.ts` 7→0,
`pipeline-health-engine.ts` 7→0 silent catches (all now `logFallback`; fail
direction unchanged, behaviour preserved). Baselines zeroed + the three files
added to the guard's named zero-site assertion. New:
`rate-limit-bypass.pglite.test.ts` (6 tests: forged-XFF rotation collapses to
one bucket; unidentified callers fail closed with no row written; a 30-call
concurrent burst yields exactly 5 allowed; buckets independent per
(identifier, action) — all against a real Postgres engine with the production
SQL) and `download-authz.guard.test.ts` (3 tests: every Content-Disposition
route references auth; the 6-route download inventory is exact; each route
holds its named guard).

| Gate | Result |
|---|---|
| typecheck (`node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit`) | PASS 0 errors |
| unit suite (`npx vitest run --config src/app/api/vitest.config.ts`) | PASS **2817 passed / 0 failed** (254 files passed, 1 skipped, 23 skipped tests, 30 todo) in 225s |

Notes: the suite grew +9 tests vs C2 (3 download-authz + 6 rate-limit-bypass;
one early red on the bypass suite was a wrong test-side index — `results[4]`
is the allowed 5th request, not the denied 6th — fixed to assert the denied
set explicitly). Scope deliberately unchanged: build, E2E, api-probe,
verify-sql-fixes, browser QA still not re-run since 21fabc7.


### C4. FULL RUNTIME GATE (build + live server) — 2026-10-01, commit 0acc701

First time the whole chain was executed end to end: production build,
`next start` on :4000, then every runtime probe against that real server.

**Defect found and fixed — the app shipped no server-rendered HTML.**
`<Shell>` is a client component reading the session with a client-side hook,
so on the server `isPending` is always true. It answered that by returning a
spinner *instead of* `children`, making the spinner the server-rendered HTML
of every route. Measured on the real server before the fix:

| Route | Status | Bytes | Visible text (before → after) |
|---|---|---|---|
| `/reviews` | 200 | 26,611 → 42,955 | **0 → 1,036** |
| `/pricing` | 200 | 61,577 → 140,363 | **0 → 6,013** |
| `/faq` | 200 | 44,503 → 63,141 | **0 → 4,247** |
| `/trust` | 200 | 42,758 → 62,203 | **0 → 2,900** |
| `/how-it-works` | 200 | — | **0 → 3,107** |

Consequences: the indexable marketing pages carried no crawlable text, the
`/reviews` schema.org `AggregateRating` (deliberately rendered server-side)
never reached the HTML, and LCP measured a loading icon. Unknown session is
now treated as signed-out **for layout only** — the sidebar is chrome, never
an authorization boundary; middleware and per-route/per-API session checks
still gate all data, and `!session` still returns before the sidebar.

Also fixed: `AccessibilityProvider` fetched `/api/user/preferences` for
anonymous visitors → 401 → a browser console error on every public page.
Now gated on having a session. Console errors + non-2xx across `/`,
`/dashboard`, `/reviews`, `/settings` went to **0**.

Harness correction: browser-QA demanded >400 chars of text, which cannot
tell a blank page from a deliberately short one. `/account/signin` and
`/account/forgot-password` are short login forms flagged THIN while working
(verified after hydration: 2 inputs / 1 button / 1 form). The gate now also
accepts a genuinely rendered set of interactive controls, so a page that
renders nothing still fails.

| Gate | Result |
|---|---|
| typecheck (`npm run typecheck`) | PASS 0 errors |
| unit suite (`npm test`) | PASS **2821 passed / 0 failed** (254 files) in 251s — +4 vs C3, the new SSR/console tests |
| build (`npm run build`) | PASS exit 0, 315/315 static pages |
| browser QA (real Edge, 35 routes × 2 viewports) | PASS **70 pass / 0 fail** (was 65/5) |
| security probe (`scripts/security-probe.mjs`) | PASS 18 checks, 0 failures |
| tenant isolation (`scripts/tenant-isolation-probe.mjs`) | PASS 15 checks, 0 leaks |
| API probe (`scripts/api-probe.mjs`) | PASS (unauthenticated never 2xx; public feedback leaks nothing) |
| SQL verification (`scripts/verify-sql-fixes.mjs`) | PASS 13/0 |
| fragment scan (`scripts/scan-fragments.mjs`) | PASS 0 nested-fragment sites |
| Playwright E2E | PASS 2 passed / 1 skipped (pre-existing `test.fixme` spec drift) |

TDD: the two regression tests were written first and watched fail
(2 failed / 5 passed) before any production edit, then pass 7/7.

**Scope honesty.** Everything above is *local* verification against a local
production build. Nothing here is a deployed-production result, and no gate
in this run exercised payments, withdrawals, tax reporting, AI credit
limits, Apollo, or the Cloudflare Worker path — see section D.

### C5. FINANCIAL / AI-CREDIT VERIFICATION + PRODUCTION CHECK — 2026-10-01

C4 fixed the runtime defects. C5 went after the two highest-risk areas that
could be verified without live payment credentials: the **financial system**
(withdrawals, earnings, tax withholding, bank accounts) and **AI credit
limiting** (item K).

**Item K is COMPLETE and the arithmetic is right.** `aiCreditLimits.ts` caps
included credits at `M/4` weekly (25%) and `M/20` daily (= 20% of the weekly
allowance), keyed on UTC day / ISO week / calendar month so every instance
agrees. Purchased credits are a **separate bucket the caps never touch**,
which is exactly the requirement's warning. Verified by
`npx vitest run aiCreditLimits aiCreditGate aiCreditDb` → **58 passed, 0
failed** across 5 files, including PGlite (real Postgres) suites asserting:
daily/weekly/monthly denial, period-boundary reset, tenant isolation, release
compensation never going below zero, no oversell under concurrency, a repeated
`requestId` not double-charging, and purchased credits still served when the
included cap is reached or the plan includes no AI credits at all.

**Financial system is COMPLETE for the tested paths.** `npx vitest run
withdrawals taxWithholding taxLedger tax-report tax-settings
tax-withdrawal earningsEscrow tenant-isolation-financial bank-accounts` →
**166 passed, 0 failed**. Withdrawal creation is a single transaction using
`FOR UPDATE SKIP LOCKED` with an idempotent pre-generated id, and tax is
withheld inside that same transaction so it can neither be lost nor charged
for a rejected withdrawal.

**Defect found and fixed (#52): a stale suite was asserting a false gap.**
`bank-accounts/__tests__/bank-accounts.test.ts` was a pre-implementation
scaffold whose 30 `it.todo` markers all read "routes not implemented". The
routes have existed for some time (`next build` emits them; the C4 API probe
answered 200) and are covered for real by `bank-accounts-lifecycle.test.ts`
and `bankAccounts.security.test.ts`. The stale file was removed and its
genuinely useful security notes preserved in the surviving suite's header.
Effect: the gate stops reporting a phantom "30 todo" gap, and bank-accounts
now reports **29 passed / 0 skipped / 0 todo**.

| Gate | Result |
|---|---|
| typecheck (`npm run typecheck`) | PASS 0 errors |
| unit suite (`npm test`) | PASS **2821 passed / 0 failed / 0 todo** (254 files) in 145s |
| AI credit limiting suite | PASS 58/0 (5 files) |
| financial suite | PASS 166/0 (11 files) |
| bank-accounts after cleanup | PASS 29 passed / 0 skipped / 0 todo |
| live production (read-only GET) | `/`, `/pricing`, `/reviews` all 200 with **0 visible text** — #50 confirmed live; fix committed but **not deployed** |

Still NOT verified, unchanged: any real payment-provider behaviour, Shopify,
Apollo live ingestion, and the Cloudflare Worker runtime.

## D. EXTERNAL BLOCKERS (do not stop other work for these)

### PRODUCTION CONFIRMS #50 IS LIVE (read-only, 2026-10-01)

The app-shell defect is **not** a local-only artifact — it is on the deployed
site right now. Verified with read-only GETs against the live domain:

| Route | Status | Bytes | Visible text | Spinner in HTML |
|---|---|---|---|---|
| `/` | 200 | 87,819 | **0** | yes |
| `/pricing` | 200 | 69,673 | **0** | yes |
| `/reviews` | 200 | 27,223 | **0** | yes |

So the marketing surface currently presents no server-rendered text to any
crawler or to a first paint. The fix is committed (`0acc701`) and verified
locally, but **it is not deployed**, and deploying it is the single
highest-value action available. The live `/reviews` does carry its
`application/ld+json` block, which confirms the data layer works and the
content is simply not being rendered into the HTML.


- `APOLLO_API_KEY` - blocks Apollo live verification only.
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` - blocks live billing. All
  plans currently have `stripe_price_id = null`.
- Deployed-domain seeded owner/admin credentials - blocks deployed browser QA.
- Confirmation that the configured Neon DB is production.

## E. HIGHEST-VALUE NEXT WORK (in order)

1. Confirm browser QA 70/70 after the #42 fix.
2. Create the master manifest JSON (this doc's machine-readable twin).
3. Original 17 items 1,2,6,7,13,14,15,17 - browser + functional verification.
4. Security addendum: full adversarial pass (IDOR, tenant isolation, AI
   injection, payment abuse, race conditions).
5. Data-leak audit across bundles, source maps, storage, logs, error messages.
6. Performance measurement (item 6 is an original requirement).
7. Financial lifecycle tests in sandbox (atomicity, idempotency, concurrency).
8. Final full regression + independent adversarial review.
