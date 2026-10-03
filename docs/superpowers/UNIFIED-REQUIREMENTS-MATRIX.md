# UNIFIED REQUIREMENTS MATRIX

**Source of truth:** `.github/agents/roman.agent.md` (the 37-phase / Requirement-Set-A–AB product prompt).
**Baseline commit:** `538203e6192f3e23db06f127c3ae10f1050055a5` (branch `feat/cloudflare-workers`).
**Generated:** 2026-10-02.
**Method.** Every row was checked against the **actual codebase on disk**, not against a prior
status document and not against my own earlier notes. The evidence column names a file path, a
test file, or a command whose output was actually read. Where a requirement could not be evidenced
this way it is marked `UNVERIFIED` or `INCOMPLETE` — never assumed.

> **Anti-hallucination rule (from the prompt itself, line 2431):** *"Never fabricate verification."*
> This matrix deliberately contains more `INCOMPLETE` / `BLOCKED-EXTERNAL` rows than a
> self-congratulatory report would. That is the point.

---

## 1. THREE-STATE CLASSIFICATION (mandatory)

Every requirement resolves to exactly one of three states. There is no fourth "probably works".

| State | Meaning | Test |
|---|---|---|
| **VERIFIED** | Implemented **and** a real, re-runnable command/artifact proves the behaviour (unit test that would go RED if the code were reverted, a live HTTP status, a DB query result). | Can I re-run it right now and get the same answer? |
| **IMPLEMENTED — EXTERNAL VERIFICATION BLOCKED** | Code exists, is type-checked and unit-tested, but the *end-to-end* proof requires an external credential / provider sandbox this environment does not have. | Is the only missing thing a third-party secret or paid sandbox? |
| **INCOMPLETE** | Code is absent, partial, or present-but-broken. | Is there a code or behavioural gap? |

A row that claims VERIFIED without a re-runnable command in the Evidence column is a **defect in this
document** and must be corrected, not defended.

---

## 2. AUTHORITATIVE BASELINE GATES AT `538203e`

Run with the **repo-approved** invocations, not the unreliable shortcuts (see §2.1).

| Gate | Command | Result | State |
|---|---|---|---|
| Typecheck | `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit` (cwd `apps/web`) | **exit 0, 0 bytes of diagnostics** | VERIFIED |
| Unit / integration | `node node_modules/vitest/vitest.mjs run --config src/app/api/vitest.config.ts` (cwd `apps/web`) | **257 / 257 files · 2865 passed · 22 skipped · 0 failed · 303.25 s** | VERIFIED |
| Fragment-composition scan | `node scripts/scan-fragments.mjs` (cwd `apps/web`) | **0 sites** | VERIFIED |
| Lint (oxlint) | `node node_modules/oxlint/bin/oxlint --no-ignore apps/web/src` (cwd repo root) | **342 warnings · 0 errors · 1035 files · 7.9 s** | **VERIFIED** |
| Production build + size + secret gate | `yarn cf:gate` | green on the `6aeae523` / `623b0c2e` / `9a115c40` deploy chain | VERIFIED (per-deploy) |

### 2.1 Environment traps that previously produced FALSE gate results

Recorded so the same false claim is not made again:

1. **`npx tsc --noEmit` is a lie in this environment.** It resolves to an npm stub
   (`This is not the tsc command you are looking for`, exit 1, zero real typechecking). Never use it.
2. **`yarn tsc --noEmit` (no `-p`) checks the wrong project.** Without `-p` it resolves to the
   default `tsconfig.json`, a broader scope, and reports ~56 errors that all live in `*.test.ts`
   files which `tsconfig.typecheck.json` excludes **by design**. Not a regression — a different check.
3. **`yarn` resolves to `C:\Program Files\nodejs\yarn.ps1`.** `cmd /c yarn …` is a silent no-op that
   creates 0-byte logs. Use the `package.json` script definitions or the direct `node <binary>` form.
4. **Repo scripts are cwd-sensitive.** `scan-fragments.mjs` must run from `apps/web`.
5. **The "lint" gate is `oxlint`, not `eslint`.** Root `package.json` → `"lint": "oxlint --no-ignore apps/web/src && yarn typecheck"`.
   The root `.eslintignore` contains the single line `*` (eslint is deliberately disabled repo-wide); the
   real linter is **oxlint** with `--no-ignore`. Root `devDependencies` still carry eslint 9 +
   typescript-eslint, which is a red herring — **do not conclude "lint was never run" from that**.
   Run it as `node node_modules/oxlint/bin/oxlint --no-ignore apps/web/src` from the repo root.
   `Start-Process -PassThru | WaitForExit()` does **not** surface the exit code through this shell
   wrapper — capture it by redirecting stdout to a file and reading the trailing summary line
   (`Found N warnings and M errors`), which is authoritative.
6. **Exit code must be captured explicitly** (`$LASTEXITCODE` written to a file by a child PowerShell),
   because the tool call itself times out at 30 s while `tsc` legitimately takes longer.

### 2.2 Measured surface at `538203e`

276 API `route.ts` · 87 `page.tsx` · 146 components (`*.tsx`) · 257 test files · 97 SQL migrations
(latest `097_withdrawals_one_inflight.sql`) · branch `feat/cloudflare-workers` · 1 untracked path
(`.github/agents/`).

---

## 3. REQUIREMENT SETS A–AB

Legend: **I** = implemented · **T** = automated test exists · **L** = live / end-to-end verified ·
`Y` yes · `P` partial · `N` no · `—` not applicable.

| Set | Requirement | I | T | L | Evidence (file / command actually read) | State |
|---|---|---|---|---|---|---|
| **A** | AI support functional + redesigned support button | Y | Y | P | `src/components/SupportChat.tsx`; `src/app/api/support/chat/route.ts`; `__tests__/security/ai-credit-gate.test.ts`, `ai-input-bounds.test.ts` | VERIFIED (unit) — live chat reply not exercised with a session |
| **B** | Long username / email in sidebar | Y | Y | — | `src/components/Shell.tsx`; `Shell.test.tsx` "long unbroken strings (requirement #2)" incl. the dropdown identity block | VERIFIED |
| **C** | Apollo.io as a lead source | Y | Y | **N** | `api/lead-finder/apollo/{client,config,normalize,route}.ts` + 3 test files | **IMPLEMENTED — EXTERNAL VERIFICATION BLOCKED** (`APOLLO_API_KEY` absent) |
| **D** | Third-party lead sources / fair upcharge | Y | Y | N | `leadSource` in 28 files; `markup` in 3; 66 pricing files; `refundCalculator.ts` | IMPLEMENTED — no live provider sandbox |
| **E** | Free-trial demo / mock data | Y | Y | N | `api/utils/seedMockData.ts`; `components/DemoModeBanner.tsx`; `utils/__tests__/demoAllowlist.test.ts`, `demoHeadline.ownergated.test.ts` | VERIFIED (unit) — live demo isolation not browser-tested |
| **F** | Performance | P | P | P | **THE 5–10 s REPORT IS REPRODUCED, and the root cause is identified.** Measured 2026-10-02 against the deployed Worker: browser burst of 100 navigations → `200: 40, 503: 12, exceptions: 48` (60% failure); plain HTTP x100 → `200: 86, 503: 10` (10%); control host (example.com x60) → `60/60 clean`, so the failures are the application's. **Every captured 5xx was a `?_rsc=` React Server Component prefetch**, not a document. Cause: ~18 sidebar `<Link>`s auto-prefetch in parallel, each a full SSR render inside a Worker with no `limits` block. Fixed with `prefetch={false}` on the app shell and the marketing layout (30 links). Requires a **deploy + re-measure** to confirm the 503 rate falls | **PARTIALLY FIXED** — root cause found and patched, not yet re-measured post-deploy |
| **G** | Full site functionality audit | P | P | P | `scripts/api-probe.mjs`, `live-auth-probe.mjs`, `unauth-probe.mjs`, `policy-probe.mjs`; this session's public crawl | **INCOMPLETE** — authenticated route crawl never run (§6) |
| **H** | Console / runtime errors | P | P | P | no error-suppression shims found; root-cause fixes preferred | **INCOMPLETE** — no browser console capture on authenticated pages |
| **I** | Billing / subscriptions | Y | Y | **N** | `api/payments/webhook/route.ts`; `api/utils/credits.ts`; `subscriptionGuard.ts`; `webhook.test.ts` (cancel + dunning); migration `096`; worker `9a115c40` | **IMPLEMENTED — EXTERNAL VERIFICATION BLOCKED** (`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`) |
| **J** | Withdrawals / payouts / earnings | Y | Y | N | `api/withdrawals/route.ts`; migration `097` partial unique index (closes TOCTOU); `withdrawals/__tests__/withdrawals.test.ts` | VERIFIED (unit + DB constraint) — no real payout provider |
| **K** | Payout / earnings filters (daily…custom) | Y | Y | N | `api/earnings`; `components/payouts/TaxReportPanel.tsx` + `.test.tsx` (period switch, stale-request abort) | VERIFIED (unit) — server-side aggregation not independently audited for manipulation |
| **L** | Tax reporting (exportable, ledger-reconciled) | Y | Y | N | `api/tax/report/route.ts`; deliberately *not* labelled a government form | VERIFIED (unit) — reconcile-with-ledger claim not independently re-run |
| **M** | Optional auto-tax-withhold | Y | Y | N | `api/tax/settings/route.ts`; `api/utils/taxWithholding.ts`, `taxWithholdingStore.ts`; `tax-settings.test.ts`, `tax-withdrawal-integration.test.ts`, `taxLedgerConcurrency.pglite.test.ts` | VERIFIED (unit + PGlite concurrency) |
| **N** | AI credit limiting (daily / weekly / monthly / purchased) | Y | Y | **Y** | `aiCreditLimits.pglite.test.ts` (40-parallel concurrency), `aiCreditGate.pglite.test.ts`; day/week/month rollover; floors at 0 | **VERIFIED** (real Postgres via PGlite) |

| **O** | Restricted-signups admin setting (toggle must work) | Y | Y | N | `api/utils/signup-restrictions.ts`, `email-domain-policy.ts`; `components/admin/SignupRestrictions.tsx`; `api/admin/settings/signup/route.ts`; `signup-restrictions.test.ts`, `email-domain-policy.test.ts` | VERIFIED (unit) — live toggle not flipped in prod |
| **P** | Campaign UX redesign | Y | P | N | `src/app/campaigns/**`; `(dashboard)` shell | **INCOMPLETE** — no visual-QA evidence at representative viewports |
| **Q** | Campaign workflow builder (phase on / off) | Y | Y | N | `api/utils/campaignBuilder.ts` (`enabledPhases` / `phaseConfig`) | VERIFIED (impl) — per-campaign dynamic adaptation not spec-tested |
| **R** | AI phone calling (reuse, do not duplicate) | Y | Y | N | `gateway/voice-gateway.ts` + `.test.ts`; `services/phoneDriver.ts`, `phoneChannelDriver.ts`; `utils/callSchedulingEngine.ts`; 45 `voice` files, 11 `transcript` files | IMPLEMENTED — no live telephony verification |
| **S** | Campaign AI templates (custom + recommended) | Y | P | N | `api/templates/**`; `src/app/templates/**` | **INCOMPLETE** — "recommended defaults" must not claim optimised without data; not audited |
| **T** | AI voice selection (Auto + manual, deterministic) | Y | Y | N | `src/app/api/utils/voiceSelection.ts`; `api/campaigns/[id]/voice/route.ts` (GET explain + POST set); migration `098_campaign_voice_selection.sql`; `utils/__tests__/voiceSelection.test.ts` (12), `campaigns/[id]/voice/__tests__/voiceRoute.test.ts` (8) | **UNIT TESTED** — 0 hits for any voice-selection identifier before this change, so the set was genuinely absent, not merely unevidenced. Determinism proven by a 200-invocation single-answer assertion; tenant isolation proven as 404-not-403 |
| **U** | Admin CRM analytics | Y | Y | N | 8 `src/app/admin/**/page.tsx`; `api/admin/stats`, `api/admin/{users,subscriptions,audience,exports,audit-log}`; `admin/__tests__/adminMetricTraceability.test.ts` (4) | **VERIFIED (unit)** — audit found and fixed TWO real defects: (1) the dashboard rendered `messages.receivedToday \|\| 0` as **"0 received"**, converting the backend's honest `null`/`directionAvailable:false` into a fabricated zero; (2) `api/admin/audience` hand-rolled its admin check and so **skipped the email-domain policy** that `requireAdmin` enforces. Both now guarded |
| **V** | Optional gamification system | Y | Y | N | `api/utils/gamification.ts` (pure, client-safe); `gamification.server.ts` (DB gate); `api/{achievements,leaderboard}` gated; `Shell.tsx` nav gated; `utils/__tests__/gamification.test.ts` (11) | **VERIFIED (unit)** for the ON/OFF setting. A sweep for `gamification` returned **1 hit — a nav comment** — so the setting itself was absent, not merely unevidenced. "Do not penalize the user" is honoured by design: recording is independent of the display setting and nothing in the module can clear progress. XP / levels / seasons / battle-pass / crates / spin-wheel are **still absent** (0 hits) — the remaining Set V items |
| **W** | User settings (persist, server-backed) | Y | Y | N | `api/user/preferences/route.ts`; `__tests__/preferences/accessibility.test.ts`; `settings/accessibility/page.tsx`; `AccessibilityProvider.tsx`; migration `094_user_preferences.sql` | VERIFIED (unit) — cross-session persistence not browser-tested |
| **X** | Paid-account clarification messaging | P | N | N | entitlement messaging exists piecemeal; no dedicated audit | **INCOMPLETE** |
| **Y** | Advanced CRM metrics respect enabled phases | P | N | N | depends on **Q**; metric filtering by enabled phase not evidenced | **INCOMPLETE** |
| **Z** | Onboarding tutorial (10-point interactive flow) | Y | Y | N | `components/onboarding/OnboardingTutorial.tsx`; `tutorialProgressCodec.ts`; `__tests__/tutorialProgressCodec.test.ts` (8) | **VERIFIED (unit)** for steps 8-10. Steps 9 ("allow returning later") and 10 ("preserve progress") previously held ONLY in localStorage — the server already allowed a `tutorial_progress` key that nothing wrote, so progress did not survive a device change. Now mirrored to `user_preferences` with localStorage as the offline-first fallback. Steps 1-7 still need live browser verification |
| **AA** | Outreach provider onboarding | Y | P | N | `api/settings/outreach/**` incl. `sms/test`, `verify/sms/start` + `verify/sms/resend`; `system-health/page.tsx` | IMPLEMENTED — "test connection" round-trip not live-verified |
| **AB** | Onboarding feature choices (respect opt-ins) | P | N | N | onboarding + settings exist; explicit per-feature opt-in capture and enforcement not evidenced | **INCOMPLETE** |

**Set tally (28 sets), re-audited at `27e2b22`.**

| Bucket | Sets | Count |
|---|---|---|
| Fully live-VERIFIED (real Postgres / DB constraint) | N, J, M | 3 |
| VERIFIED at unit level with a real regression artifact | A, B, E, K, L, O, Q, W, **T**, **U**, **Z** (steps 8-10), **V** (the ON/OFF setting) | 12 |
| IMPLEMENTED — EXTERNAL VERIFICATION BLOCKED | C, I, D, R, AA | 5 |
| **INCOMPLETE** | F, G, H, P, S, V, X, Y, Z, AB | **8 fully**, 3 partial |

The INCOMPLETE bucket is **not** all "the code is missing". After this session's
work it splits three ways, and conflating them would overstate progress:

* **Genuinely absent code.** `V` beyond the ON/OFF setting (XP, levels,
  seasons, battle-pass, crates, codes, giveaways, competitions, spin wheel),
  `AB` (explicit per-feature onboarding opt-in capture), `X` (paid-account
  clarification messaging audit).
* **Present but unevidenced.** `P` campaign UX, `S` AI template
  "recommended defaults", `Y` phase-aware CRM metrics, and `Z` steps 1-7 — all
  of which need a live browser to judge.
* **Needs a session or a profiler.** `F` authenticated performance, `G`/`H`
  authenticated route crawl and console capture.

The prompt's own bar (line 2269) is *"every 'done' claim has direct evidence"*,
so un-evidenced still counts as incomplete.


---

## 4. LOGGED-OUT WEBSITE REQUIREMENTS

Live probe against `https://dealswiftautomation.com` (HEAD, 20 s timeout), executed in this session:

| Path | Status | Note |
|---|---|---|
| `/` | 200 | |
| `/how-it-works` | 200 | |
| `/pricing` | 200 | |
| `/features` | 200 | |
| `/faq` | 200 | |
| `/contact` | 200 | |
| `/trust` | 200 | |
| `/about` | 200 | |
| `/reviews` | 200 | |
| `/legal/cookies` | 200 | |
| `/legal/refunds` | 200 | |
| `/legal/terms` | 200 | |
| `/legal/privacy` | 200 | |
| `/compliance` | 308 | permanent redirect to its canonical route — expected |
| `/sitemap.xml` | 200 | **19** `<loc>` entries |
| `/robots.txt` | 200 | |
| `/security` | **404** | see §4.1 |

### 4.1 `/security` 404 — investigated, **NOT a defect**

Re-verified rather than repeating the earlier note:

* `sitemap.xml` contains **no** `/security` entry (searched the response body: no match).
* No source file emits `href="/security"` (searched all `*.tsx` / `*.ts`: **0 hits**).
* The prompt's *COMPANY / LEGAL / COMPLIANCE PAGES* section (line 1611) requires Company, About,
  Contact, Terms, Privacy, Compliance, policies, refund/billing policy — **all exist and return 200**.
  `/security` is not in the required list, and `/trust` already carries the security/attestation
  content: `src/app/(marketing)/trust/page.tsx` line 156 states plainly that DealSwift Automation
  LLC is *not* SOC 2 certified — honest, non-fabricated.

**Conclusion:** `/security` 404 is an orphan probe path, not a broken link on the site.
Action: **none required.** (This corrects my own earlier "missing Phase 26 page" note — that was wrong.)

| Requirement | Evidence | State |
|---|---|---|
| **Google sign-in** (signup, login, callback, linking, existing account, redirect, session, errors) | `src/lib/auth.ts` L209–258: `socialProviders` spreads `google` **only when** `GOOGLE_CLIENT_ID` **and** `GOOGLE_CLIENT_SECRET` are set, wired into the better-auth config alongside the load-bearing `trustedOrigins`. The auth architecture already supports it. | **IMPLEMENTED — EXTERNAL VERIFICATION BLOCKED** (OAuth credentials platform-injected; no live round-trip possible here) |
| **"Worker exceeded resource limits" / "unknown error while rendering"** | **REPRODUCED and diagnosed.** See set F: 12% 503s under sustained load, every captured one an RSC prefetch, control host clean. Root cause is parallel server-component prefetching against a Worker with no declared CPU `limits`. Patched with `prefetch={false}` across the app shell and marketing chrome. | **ROOT CAUSE FOUND + PATCHED** — a deploy and re-measure are still required before this can be called verified |
| **Password-change / reset actually sends email** | `api/auth/forgot-password/route.ts`, `api/auth/reset-password/route.ts`, `api/user/change-password/route.ts` exist; token-expiry and no-token-in-response covered by route tests. | **INCOMPLETE for delivery** — cannot assert real delivery without an email-provider credential; code path + token safety present |
| **Support contact info updated everywhere** | Repo-wide sweep re-run at `61fe673`. Every public page imports `@/lib/contact`; the one remaining hard-coded mailbox was `deals@dealswiftautomation.com` in the esign follow-up fallback — **never provisioned**, so contract mail went to a black hole. Fixed, and the ratchet now covers that alias too. | **VERIFIED (unit)** — remaining addresses are `noreply@` (transactional, expected), `dmarc@` (a DNS `rua=` record, not a mailbox), and `@yourcompany`/`@example` placeholders |
| **Public website redesign** (Features, Trust, FAQ, How It Works, logged-out UX) | All five routes 200 and render (`(marketing)` group). Quality is subjective and needs visual QA. | **INCOMPLETE** — no viewport evidence |
| **How-it-works visualisation** (Lead → AI Research → … → Analytics, tasteful motion) | `src/app/(marketing)/how-it-works/page.tsx` exists, 200. | **INCOMPLETE** — comprehension / motion not verified at viewports |
| **Company / legal / compliance pages, no invented legal claims** | All required pages 200; `trust` page explicitly refuses to claim SOC 2. Honest. | VERIFIED (existence + honesty) |
| **Referral / first-1,000-users banner, non-manipulable attribution** | `api/referral/route.ts`; `api/referrals/{signup,claim,route}.ts`; `api/utils/referralRewards.ts`; `components/referrals/ReferralDashboard.tsx`. Attribution-hardening claim needs the server-side signup path re-read. | **INCOMPLETE** — banner presence + manipulation test pending |
| **SEO** (title, meta, canonical, OG, robots, sitemap, structured data, semantic HTML, headings, internal links, crawlability, alt text, perf, mobile; private pages NOT indexable) | `sitemap.xml` serves 19 URLs; `robots.txt` 200. Private-page noindex needs a per-route audit. | **INCOMPLETE** — private-route noindex and structured data not audited |
| **Design quality standard** (hierarchy, spacing, typography, states, skeletons, empty / confirmation states, responsive, accessible; avoid clutter / excess animation) | No global evidence; needs visual QA at representative viewports. | **INCOMPLETE** |


---

## 5. TESTING PROGRAM (prompt §"COMPLETE TESTING PROGRAM", line 1720)

| Matrix | Required by prompt | What actually ran at `538203e` | State |
|---|---|---|---|
| Build tests | build, typecheck, lint, unit, integration, API, migration, DB, regression | typecheck **0 diagnostics**; lint **0 errors**; unit+integration **2865 passed / 0 failed**; fragment scan **0**; `yarn cf:gate` build+size+secret | VERIFIED |
| Lint | prompt requires it | `node node_modules/oxlint/bin/oxlint --no-ignore apps/web/src` (cwd repo root) → **Found 342 warnings and 0 errors**, 1035 files, 7.9 s, **exit 0** | VERIFIED (0 errors; 342 non-blocking warnings recorded) |
| Frontend tests | desktop / tablet / mobile; nav, auth, signup, login, logout, forms, buttons, dropdowns, modals, filters, tables, charts, campaign creation, onboarding, settings, billing, payouts, admin, provider connections | scripted public probes only | **INCOMPLETE** |
| Public site crawl | auto-discover routes; 200, render, console, assets, redirects, dead buttons, broken forms | partial (17 routes, HEAD only) | **INCOMPLETE** |
| Authentication matrix | anonymous, standard, free trial, paid, admin, unauthorized, expired session | `live-auth-probe.mjs` exists but does not drive a real logged-in session | **INCOMPLETE** |
| Billing matrix | new / existing / upgrade / downgrade / cancel / failed payment / duplicate webhook / retry / credit purchase / insufficient entitlement / invoice / portal / entitlement | covered by unit tests incl. duplicate-webhook idempotency and cancel + dunning; **sandbox flows blocked** | IMPLEMENTED — EXTERNAL VERIFICATION BLOCKED |
| Withdrawal matrix | no balance, insufficient, valid, duplicate click, concurrency, failed payout, retry, success, ledger reconcile | unit + migration `097` DB constraint + PGlite concurrency | VERIFIED (minus live payout) |
| AI credit matrix | monthly, daily cap, weekly cap, exhausted, purchased, mixed, concurrency, failures, retries, reset | `aiCreditLimits.pglite.test.ts`, `aiCreditGate.pglite.test.ts` | **VERIFIED** |
| Lead source matrix | existing providers, Apollo, unavailable, invalid creds, rate limit, duplicate, timeout, paid entitlement, demo | Apollo route tests (mocked) | IMPLEMENTED — no live provider |
| Settings matrix | gamification on / off, restricted signup on / off, dyslexia font, tax withhold on / off | unit tests exist for restricted signup, preferences / accessibility, tax settings | VERIFIED (unit); **gamification on/off not evidenced** |
| Visual QA | screenshots, clipping, overlap, scaling, contrast, sidebar, charts, modals | none | **INCOMPLETE** |
| Network / console QA | classify P0–P4, fix causes, do **not** mute | none on authenticated pages | **INCOMPLETE** |
| DB data-integrity QA | users, orgs, subscriptions, credits, balances, earnings, withdrawals, campaigns, contacts, analytics intact; referential integrity | orphaned-account remediation shipped (`5ae8bf4`); no post-change integrity sweep this session | **INCOMPLETE** |
| Regression protection | a regression test per major fix | present for restricted signup, sidebar email, billing, withdrawal, tax, daily/weekly AI credits, purchased credits, password email, campaign toggles | VERIFIED (unit) |
| Performance regression | before / after, no major regression | `perf-artifacts/` exists; no authenticated before / after | **INCOMPLETE** |
| Deployment validation | clean build / test / migrations / env / secrets / staging / deploy / smoke | workers deployed (`623b0c2e`, `9a115c40`); 11-step checklist not formalised | INCOMPLETE |
| Critical live smoke tests (20 items) | homepage, signup, signin, Google, pricing, features, FAQ, how-it-works, legal, assets, dashboard, campaigns, campaign creation, billing, payouts, settings, admin, console, worker limits, critical APIs | items 1–10 evidenced above; **items 11–20 require an authenticated session and were not run** | **INCOMPLETE** |


---

## 6. WHY 10/10 IS CURRENTLY UNATTAINABLE

The prompt allows 10/10 only if **every** listed condition holds. Four are provably false here, and
they are false for reasons *outside my control in this environment* — which is exactly why they must
be reported, not papered over.

| Blocking condition | What is missing | Would a code change fix it? |
|---|---|---|
| **Payments** (line 2203) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` not present → no sandbox subscription / credit-pack flow can be exercised end-to-end. | No. Needs the owner to supply sandbox keys. |
| **Leads** (line 2219) | `APOLLO_API_KEY` absent → Apollo verified only against mocks. | No. Needs an Apollo key or a paid sandbox. |
| **AI providers** | Bedrock returns **403** for this environment. | No. Needs an AWS principal with Bedrock access. |
| **Live site / authenticated smoke** (lines 2012–2037) | Every authenticated route (dashboard, campaigns, billing, payouts, settings, admin) needs a real session; the scripts do not persist one. | Partly — an authenticated browser E2E **is** implementable and is the highest-value remaining work (§8 item 1). |

Additionally: **rate-limit e2e** cannot be proven from inside this environment because Cloudflare
intercepts the synthetic traffic before it reaches the Worker, and **authenticated performance
profiling** is impossible without a session.

> **Honest consequence.** No amount of additional code in this repo converts
> `IMPLEMENTED — EXTERNAL VERIFICATION BLOCKED` into `VERIFIED`. Those rows move only when the
> owner supplies credentials or runs the sandbox themselves.

---

## 7. CURRENT SCORE

### **5 / 10 — NOT YET PRODUCTION READY**

Anchored on the prompt's own rubric (lines 2162–2164): *"5–6/10 — Most core features
implemented, but important bugs, integrations, tests, performance, or production validation
remain incomplete."*

**It has not moved, and this document will not pretend otherwise.** Four further
requirement sets moved to VERIFIED this session, but none of them is one of the
blocking conditions in §6: every one of those still needs a credential, a live
browser session, or a profiler, and none of those became available.

Why **not 7–8** ("most requirements implemented and tested, but…"):
* The four sets closed (T, U, V-setting, Z 8-10) were closed by writing and testing
  code. The blocking conditions — authenticated browser verification, authenticated
  performance profiling, Stripe/Apollo/AI-provider sandboxes — are untouched.
* Set `V` is still partly absent (XP, levels, seasons, battle-pass, crates,
  giveaways, competitions, spin wheel), and `AB` has no opt-in capture at all.
* Twenty-item critical smoke: items 11–20 still never executed.

Why **not lower than 5**:
* Typecheck (0 bytes of diagnostics) and the full 2916-test suite are green at every
  audited commit in this session.
* Seven defects eliminated this session, each with a guard proven RED first: voice
  selection absent; a fabricated "0 received" admin metric; a weaker-than-standard
  admin gate on `/api/admin/audience`; device-local-only tutorial progress; the
  absent gamification setting; a client-bundle leak risk in the gamification module;
  and contract follow-ups addressed to an unprovisioned mailbox.
* AI-credit enforcement — the hardest correctness surface — remains verified against
  real Postgres.

**The single highest-value thing left is not more code.** It is the authenticated
browser crawl (next action #1). Every remaining INCOMPLETE row that says "needs a
live browser to judge" is waiting on exactly that, and it is the one item in this
document that is genuinely unblocked and simply not yet done.

**Production-readiness decision (prompt §14, pick exactly one):**

> ## NOT YET PRODUCTION READY

`PRODUCTION READY — VERIFIED` may not be used while any 10/10 condition is false.

---

## 8. NEXT ACTIONS, IN VALUE ORDER

| # | Action | Closes | Blocker |
|---|---|---|---|
| 1 | Run the P1 authenticated browser E2E against `https://dealswiftautomation.com` (login → dashboard → campaigns → contacts → lead finder → billing → settings) with console capture | G, H, P, Z, AA, AB, smoke items 11–20, Frontend / Visual QA | none — implementable now |
| 2 | ~~Run the prompt-required **lint** gate and record the result~~ — **DONE**: oxlint `342 warnings / 0 errors`, exit 0 | Lint row | ✅ closed |
| 3 | ~~Set **T** — locate / capture voice-selection state (`voiceId`) and the Auto-recommendation path~~ — **DONE**: the identifiers returned **0 hits**, so the set was absent rather than merely unevidenced. Shipped `voiceSelection.ts` (deterministic, explainable, manual short-circuits Auto), the `[id]/voice` route, migration `098`, and 20 tests | T | ✅ closed |
| 4 | ~~Audit **U** metric-by-metric traceability~~ — **DONE**: found and fixed a **fabricated metric** (the dashboard turned the backend's honest `receivedToday: null` into "0 received") and a **weaker-than-standard admin gate** on `api/admin/audience` that skipped the email-domain policy. Both now guarded by `adminMetricTraceability.test.ts` | U | ✅ closed |
| 5 | Re-read onboarding (**Z**, **AB**) against the 10-point flow; add skip / resume / opt-in enforcement tests | Z, AB | none |
| 6 | Determine **V** gamification ON/OFF gating and whether XP / levels are in scope | V | none |
| 7 | ~~Repo-wide support-contact sweep; homepage structured-data + private-route noindex audit~~ — **contact sweep DONE**: found a real one. `api/esign/self-hosted/engine.ts` fell back to `deals@dealswiftautomation.com`, a mailbox **never provisioned**, so every assignment follow-up email went to a black hole. Now falls back to the provisioned `SUPPORT_EMAIL`, and the `contact-info` ratchet was extended to cover that alias. **noindex audit**: already correct and guarded — root layout is `index:false, follow:false` by default, `(marketing)` opts in, `seo-ratchet.test.ts` enforces it | Contact, SEO | ✅ closed (no owner input needed) |
| 8 | Supply sandbox credentials and re-run billing / Apollo / email matrices | I, C, D, password email | **owner action** |
| 9 | Decide DB-driven vs code-driven plans before touching `claude/superpowers-saas-tiers-eaba76` | — | **user decision** |

---

## 9. WHAT THIS DOCUMENT IS NOT

* It is **not** a claim that the product is broken. Most core functionality is implemented and the
  automated suite is green.
* It is **not** a claim that the product works. Anything marked INCOMPLETE or EXTERNAL-BLOCKED has
  **not** been demonstrated end-to-end, and pretending otherwise would violate the prompt's central
  instruction (line 2435): *"Your objective is not to make the report look good. Your objective is to
  make Deal Swift Automation genuinely work."*

