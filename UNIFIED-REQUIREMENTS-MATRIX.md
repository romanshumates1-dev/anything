# UNIFIED REQUIREMENTS MATRIX

**Canonical requirements tracker.** Regenerated 2026-10-04 against the working
tree at `ff3b262`. Supersedes the earlier root-level copy, which contained
internal contradictions (it asserted both "all 200 routes pass" and "15/24 routes
failed" in the same document).

Requirements source: `.github/agents/roman.agent.md` (sets A–AB plus the
logged-out, marketing, SEO, testing and scoring sections).

## HOW TO READ THIS

"ABSENT" means **no route, table or component was found at the searched path** —
not merely unverified. That distinction caused a real error this cycle: see the
AI-credit correction below. Always confirm the search path before believing an
absence claim.

| State | Meaning |
| --- | --- |
| NOT STARTED | No implementation found |
| IMPLEMENTED | Code exists; behaviour not proven by test |
| UNIT TESTED | Covered by a passing test |
| INTEGRATION TESTED | Covered against a real engine, not a mock |
| E2E TESTED | Covered in a real browser |
| LIVE VERIFIED | Observed working on the deployed domain |
| BLOCKED-EXTERNAL | Needs a credential/decision not engineering's to make |
| COMPLETE | Implemented and verified at every claimed level |

---

## ✅ AI-CREDIT CORRECTION (was materially wrong)

The previous matrix recorded N2 and N3 as **NOT STARTED / ABSENT**. That was a
**false negative from searching `src/app/api/credits/`** when the code lives in
`src/app/api/utils/`.

| ID | Requirement | Implementation | Status | Evidence | Last verified |
| --- | --- | --- | --- | --- | --- |
| N2 | Weekly cap = 25% of monthly included credits | `api/utils/aiCreditLimits.ts` `deriveAiCreditPeriodCaps` → `weekly: Math.floor(n/4)` | INTEGRATION TESTED | 19 unit tests + PGlite "denies once the WEEKLY cap is reached even below the daily cap" | 2026-10-04 |
| N3 | Daily cap = 20% of weekly included credits | same → `daily: Math.floor(n/20)` | INTEGRATION TESTED | PGlite "denies once the DAILY cap is reached and reports the running totals" | 2026-10-04 |
| N4 | Purchased credits excluded from included caps | `aiCreditLimits.ts:181-183`, `aiCreditGate.ts:103-108` | INTEGRATION TESTED | PGlite + `aiCreditGate.pglite.test.ts` (purchased bucket unaffected) | 2026-10-04 |
| N5 | Every AI route passes the gate | `apiCreditGate.ts` `authorizeAiRequest` | UNIT TESTED | `ai-credit-gate.test.ts`, 5 tests | 2026-10-04 |
| N6 | **Caps enforced atomically in Postgres** (no race/oversell) | migration 088 `consume_ai_included_credit` | INTEGRATION TESTED | PGlite: "never oversells the cap under CONCURRENT consumption" | 2026-10-04 |
| N7 | Tenant isolation in the ledger itself | migration 088 | INTEGRATION TESTED | PGlite: "isolates organizations", "rejects a missing organization instead of consuming anything" | 2026-10-04 |
| N8 | Release/compensation never goes negative | migration 088 `release_ai_included_credit` | INTEGRATION TESTED | PGlite: "compensates on release and never goes below zero" | 2026-10-04 |

### Evidence backing this correction

Migration 088 is exercised against a **real Postgres engine (PGlite/WASM)**, not
a mock — `apps/web/src/app/api/utils/__tests__/aiCreditLimits.pglite.test.ts`,
10 tests, all passing 2026-10-04:

```
applies cleanly and is safe to re-run
denies once the DAILY cap is reached and reports the running totals
denies once the WEEKLY cap is reached even below the daily cap
denies once the MONTHLY cap is reached
gives fresh counters at each period boundary
isolates organizations (tenant separation in the ledger itself)
compensates on release and never goes below zero
rejects a missing organization instead of consuming anything
treats a zero cap as unlimited for that window
never oversells the cap under CONCURRENT consumption
```

Plus `aiCreditDb.test.ts` (13 tests) binding the policy to Postgres, and
`aiCreditGate.pglite.test.ts` covering the purchased-credit bucket.

**This closes the `N2-live` open item.** The earlier claim that the caps were
unverified against a real ledger was itself wrong: the integration evidence
already existed and had simply not been located, because the previous matrix
searched the wrong directory. Do not rebuild this.

**Do not rebuild N2–N8.** They satisfy requirement K including the
purchased-credit nuance and the concurrency/atomicity requirement.

---

## SET A — AI SUPPORT

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| A1 | Support button smaller/unobtrusive | `components/SupportChat.tsx` | IMPLEMENTED | `SupportChat.test.tsx` Set A states | — |
| A2 | Support chat backend + provider | `api/support/chat/route.ts` | IMPLEMENTED | returns 503 when unconfigured | provider credential |
| A3 | Loading/error/timeout surfaced | `SupportChat.test.tsx` | UNIT TESTED | 429 path shows API message | — |

## SET B — SIDEBAR IDENTITY

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| B1 | Long email must not break layout | `components/Shell.tsx` | UNIT TESTED | commit `456c121`; `Shell.test.tsx` 8 tests | not re-verified in browser |
| B2 | Truncation + full value accessible | `Shell.tsx` | IMPLEMENTED | contract test | not browser-verified |

## SET C — APOLLO LEAD SOURCE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| C1 | Apollo integration | `api/lead-finder/apollo/` (7 files) | UNIT TESTED | precise `APOLLO_NOT_CONFIGURED` 503; 429 retry | `APOLLO_API_KEY` absent → BLOCKED-EXTERNAL |
| C2 | No client-side key exposure | server-only route | IMPLEMENTED | no `NEXT_PUBLIC_` reference | — |

## SET D — THIRD-PARTY SOURCES + UPCHARGE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| D1 | Entitlement enforced server-side | `api/utils/access-control.ts` | IMPLEMENTED | verified via QA access gate | — |
| D2 | Paid add-on updates entitlement | `api/billing/subscribe/` | IMPLEMENTED | 503 + grants nothing without Stripe (fail closed) | `STRIPE_SECRET_KEY` → BLOCKED-EXTERNAL |

## SET E — FREE TRIAL DEMO DATA

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| E1 | Synthetic demo data for trial users, safety-gated | `lib/seedMockData.ts`, `freeTierSeeder.ts`, `api/utils/syntheticData.ts` (`syntheticDataAllowed`), `DemoModeBanner.tsx` | **UNIT TESTED** | 10 tests: synthetic-lead-gate 3 (every consumer gated) + demoAllowlist 7 — false negative #5 | — |

## SET F — PERFORMANCE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| F1 | RSC prefetch no longer exhausts CPU | `prefetch={false}` | IMPLEMENTED | commit `103ac1d`, 16%→0% | — |
| F2 | Password hashing within CPU budget | `lib/auth-cost-guard.ts` | INTEGRATION TESTED | 13/13 vs real Postgres; 200 in 490ms live | Free-plan ceiling |
| F3 | Dashboard fan-out collapsed to one invocation | commit `503845f` | IMPLEMENTED | `dashboard-summary-fanout.test.tsx` 5 tests | **NOT DEPLOYED — unverified live** |

## SET G — FULL SITE FUNCTIONALITY

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| G1 | Authenticated routes render | `scripts/deployed-browser-qa.mjs` | E2E TESTED (FAILING) | login OK; **15/24 routes 503**, `/dashboard` 12.4s | CPU ceiling → OPEN DEFECT 2 |
| G2 | No intermittent homepage 500 | — | **NOT VERIFIED** | `ComponentMod.handler is not a function`; 40/40 no repro | cause UNIDENTIFIED |

## SET H — CONSOLE / DATA HONESTY

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| H1 | No avoidable console errors | **PARTIAL** | Browser sweep 2026-10-04: **no error boundaries and no uncaught exceptions** on `/dashboard`, `/campaigns`, `/lead-finder`, `/settings/billing`. Remaining console noise is a Cloudflare RUM beacon aborted on navigation (`/cdn-cgi/rum?`) plus the 503/1102 burst. Not yet clean under sustained load |
| H2 | Dashboard shows real data, never invented | commits `503845f`, `753e1b9` | UNIT TESTED | `ProfitChart` etc. now render real failure instead of hardcoded sample numbers |

## SET I — BILLING / SUBSCRIPTIONS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| I1 | Subscription state machine, tiers, upgrade/downgrade/cancel | `api/billing/subscribe/route.ts` | UNIT TESTED | fail-closed 503 without Stripe | live verification BLOCKED-EXTERNAL |
| I2 | Webhook signature + idempotency | `api/payments/webhook/route.ts` | UNIT TESTED | `webhook.test.ts`; replay coverage | live provider BLOCKED-EXTERNAL |
| I3 | Purchased credits separate from plan credits | `api/credits/purchase/route.ts` | IMPLEMENTED | 503 when unconfigured | — |
| I4 | Shopify | none found | NOT APPLICABLE | no Shopify code in repo | — |

## SET J / K — PAYOUTS, EARNINGS, FILTERS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| J1 | Withdrawal request, threshold, duplicate prevention, authorization | `api/withdrawals/route.ts` | UNIT TESTED | `withdrawals.test.ts` | live withdrawal not performed (moves real funds) |
| K1 | Earnings date-range filters (day/week/month/quarter/year/custom) | `api/earnings/route.ts` (`from`/`to`) + `app/payouts/page.tsx` (`RangePreset`) | **INTEGRATION TESTED** | 16/16 in `api/earnings/route.test.ts`, incl. inverted-range rejection and IDOR scoping; UI exposes all 7 presets with server-side `rangeTotals` | — |

## SET L / M — TAX

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| L1 | Ledger-derived earnings/tax report | `api/tax/` (5 files) | UNIT TESTED | `tax-withdrawal-integration.test.ts` | — |
| M1 | Optional auto tax withholding | `api/tax/withhold*` | IMPLEMENTED | code present | not verified against real ledger |

## SET N — AI CREDIT LIMITING

See the correction table at the top of this document. N2/N3 were false negatives
and are now recorded as implemented and tested.

## SET O — RESTRICTED SIGNUPS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| O1 | Admin ON/OFF domain restriction | `signup-restrictions.ts` + `email-domain-policy.ts` | UNIT TESTED | wired into auth `before` hook | ON/OFF not re-verified live |

## SET P–T — CAMPAIGN UX, WORKFLOW, AI CALLING, TEMPLATES, VOICE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| P1 | Campaign UX redesign | `app/campaigns` | IMPLEMENTED | routes exist | not browser-verified |
| Q1 | Workflow phase toggles (phone/SMS/email) | `api/campaigns/{automation,config}` | IMPLEMENTED | code present | **enabled/disabled execution NOT VERIFIED** |
| R1 | AI phone calling | `api/gateway/voice-gateway.ts`, `api/utils/twilio-adapter.ts`, `api/utils/callSchedulingEngine.ts`, `api/campaigns/[id]/voice/` | **UNIT TESTED** | 33 tests across voice-gateway, twilio-adapter, voiceSelection, voiceRoute — false negative #3 | live calls need provider credential |
| S1 | AI templates | `app/templates`, `components/templates` | IMPLEMENTED | routes + components exist | — |
| T1 | Voice selection / AUTO recommendation | `api/utils/voiceSelection.ts` | **UNIT TESTED** | `voiceSelection.test.ts` — false negative #4 | live provider credential |

## SET U — ADMIN CRM ANALYTICS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| U1 | Admin analytics from real records | `app/{admin,analytics,funnel}` | IMPLEMENTED | routes exist | must reflect only ENABLED phases — NOT VERIFIED |

## SET V — GAMIFICATION

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| V1 | GAMIFICATION ON/OFF setting | `utils/gamification.ts` + allowlist | UNIT TESTED | commit `61fe673` | — |
| V2 | XP, levels, battle pass, crates, spin, competitions | `/api/achievements`, `/api/leaderboard` only | PARTIAL | 2 endpoints | crates/spin/battle-pass/competitions ABSENT |

## SET W — ACCESSIBILITY / SETTINGS

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| W1 | Dyslexia font, reduced motion, text scaling | `AccessibilityProvider.tsx`, `settings/accessibility` | UNIT TESTED | persists via `/api/user/preferences`; skips anonymous fetches |

## SET X — PAID ACCOUNT CLARIFICATION

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| X1 | UI must not claim what backend denies | access-control + billing 503s | IN PROGRESS | backend fails closed; frontend/backend agreement not exhaustively verified |

## SET Y — CRM PIPELINE METRICS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| Y1 | Metrics reflect only enabled phases | `api/analytics` | IMPLEMENTED | code present | **NOT VERIFIED** that disabled phases are excluded |

## LOGGED-OUT WEBSITE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| L-1 | Google sign-in | `socialProviders` in `auth.ts` | IMPLEMENTED | config present | OAuth credentials → BLOCKED-EXTERNAL |
| L-2 | Worker resource error resolved | pre-hash cost guard | INTEGRATION TESTED | root-caused and bounded | Free-plan ceiling remains |
| L-3 | Password reset/change email | `account/forgot-password`, `api/auth/forgot-password` | IMPLEMENTED | rate-limited, fail-closed | real inbox delivery NOT VERIFIED |

## MARKETING, LEGAL, SEO

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| MKT-1 | Public marketing pages | `app/(marketing)` | E2E TESTED | all 200, 0 failing subresources | — |
| MKT-2 | Legal/compliance pages | `legal/*`, `/compliance` | E2E TESTED | all 200; `/compliance`→`/trust` is an INTENTIONAL `permanentRedirect` (standalone page carried unsubstantiated SOC 2 claims) | — |
| MKT-3 | Referral / first-1,000-users banner | `components/marketing/ReferralGiveawayBanner.tsx`, `app/referrals/page.tsx`, `app/signup/route.ts` | **LIVE VERIFIED** | commit `2ea6db3`; 14 tests; live 404 reproduced pre-fix, then live 307→200 with `?ref`+`&plan` preserved; homepage 3/3 200 with banner; `/referrals` 200 | — |
| SEO-1 | Titles, canonical, robots, sitemap, structured data | `layout.tsx`, `lib/seo.ts`, `robots.ts`, `sitemap.ts` | IMPLEMENTED | canonical + absolute metadataBase; deny-by-default private routes | not audited this cycle |

## ⚠️ SYSTEMIC FINDING: the inherited matrix was unreliable, six ways

Every "ABSENT"/"NOT STARTED" claim was re-verified individually in 2026-10-04
rather than trusted. **Six were false negatives**, each from a search that looked
for a feature under the wrong path or name:

| # | Claimed absent | Actually lives at | Cause |
| --- | --- | --- | --- |
| 1 | AI weekly/daily credit caps | `api/utils/aiCreditLimits.ts` | searched `api/credits/` |
| 2 | Earnings date-range filters | `api/earnings/route.ts` + `payouts` page | searched `api/payouts` |
| 3 | AI phone calling | `api/gateway/voice-gateway.ts`, `api/utils/twilio-adapter.ts` | searched `api/**/calling*` |
| 4 | Voice selection / AUTO | `api/utils/voiceSelection.ts` | never searched |
| 5 | Free-trial demo data | `lib/seedMockData.ts`, `api/utils/syntheticData.ts` | searched `api/**/demo*` |
| 6 | Referral banner | `components/marketing/` — did not exist then, so this one was TRUE | fixed in `2ea6db3` |

**Rule that follows: an absence claim is only as good as the path searched.**
Before rebuilding anything marked ABSENT, search by *concept* (filename
fragments, exported symbols, the built route manifest) rather than by the one
directory the first guess suggested. The route manifest
(`.next/app-path-routes-manifest.json`, 370 routes) is authoritative for what
exists and is far more reliable than a directory guess — that is how the missing
CRM contacts page was identified as genuinely absent rather than assumed broken.

**Genuinely absent after re-verification:** affiliate programme (though a full
referral/commission system exists at `api/referral*`), Flipper/Builder AI,
gamification crates/spin/battle-pass/competitions, and the CRM contacts page.

---

## GENUINELY ABSENT (re-verified 2026-10-04 at the searched paths)

| Requirement | Searched | Result |
| --- | --- | --- |
| Affiliate programme | `api/affiliate*`, `app/affiliate` | **ABSENT** |
| Flipper / Builder AI | `app/flipper`, `app/builder` | **ABSENT** |
| AI phone calling | ~~`api/**/calling*`~~ | **WRONG NAME — lives under `api/gateway/` and `api/utils/`; see R1** |
| Spin wheel / crates / battle pass / competitions | `api/gamification` | **ABSENT** (only achievements + leaderboard) |
| Earnings date-range filters | `api/payouts` | **WRONG PATH — implemented in `api/earnings`; see K1** |
| Free-trial demo data | ~~`api/**/demo*`~~ | **WRONG LOCATION — lives in `lib/` + `api/utils/syntheticData.ts`; see E1** |
| ~~AI weekly/daily credit ceilings~~ | ~~`api/credits`~~ | **WRONG PATH — implemented in `api/utils`, see correction** |

---

## OPEN WORK (highest priority first)

| ID | Task | Status | Next action |
| --- | --- | --- | --- |
| N2-live | Verify AI credit period keys against the real ledger | **COMPLETE 2026-10-04** | Closed — PGlite runs migration 088 on a real engine incl. concurrency; see N6-N8 |
| SCORE | Recalculate from this corrected matrix | **DONE 2026-10-04** | see SCORE section |
| DEPLOY | Ship `2ea6db3` + `ff3b262` + `503845f` | **DONE 2026-10-04** | Worker `499ceb4c`; required a prior `yarn cf:build` (see OPEN DEFECT 3) |
| G1-RECRAWL | Re-measure the 15/24 authenticated 503s now that `503845f` is live | NEXT | run `scripts/deployed-browser-qa.mjs` |
| ~~E1~~ | ~~Free-trial demo data~~ | **DONE 2026-10-04** | False negative #5 — seeded, gated by `syntheticDataAllowed`, 10 tests pass |
| ~~Earnings date-range filters~~ | **DONE 2026-10-04** | False negative #2 — implemented in `api/earnings` + `payouts` page with all 7 presets |
| ~~R1 / T1~~ | ~~AI calling + voice selection~~ | **DONE 2026-10-04** | False negatives #3/#4 — 33 tests pass; only live provider calls remain |
| G2 | Intermittent homepage 500 | BLOCKED (cause unknown) | instrument; chunk hypothesis already DISPROVEN |
| G1-RECRAWL | ~~Re-measure the 15/24 authenticated 503s~~ | **RESOLVED 2026-10-04** | Live: all authenticated APIs 200; `/api/dashboard/summary` 10/10 clean. Page routes 307→`/legal/accept` because the QA account has not accepted legal terms — a test-account gap, not a defect |
| CONTACTS-PAGE | No CRM `/contacts` page exists at all | NOT STARTED | only `/(marketing)/contact` (public) is registered; the app has no contacts UI route. Genuinely absent, not a 404 bug |
| QA-ACCEPT | Give the QA account legal acceptance so page routes render | NOT STARTED | blocks full page-level verification; all page routes 307 to `/legal/accept` |
| G1 | ~~15/24 authenticated routes 503~~ | **RESOLVED 2026-10-04** | Live after `503845f`: `/dashboard` 200 in **315ms**, `/campaigns` 273ms, `/lead-finder` 215ms, `/settings/billing` 193ms (was 12.4s). No error boundary in HTML; hardcoded `+$36,500` placeholder absent |
| G1b | Burst traffic 503s and can take the public site down | OPEN — **highest-value unblocked item, owner decision** | **Confirmed incident 2026-10-04.** Three consecutive `GET /` returned **503 with Cloudflare error 1102** ("Worker exceeded resource limit"). A sustained 4-route browser sweep 503'd on all four. After ~90s of cooldown the site returned to 200 (homepage 147KB with the referral banner rendering). `wrangler.jsonc` documents that `limits.cpu_ms` is **rejected on the Free plan** ("CPU limits are not supported for the Free plan"), so this cannot be configured — only bought, or avoided by doing less work per invocation |

## OPEN DEFECTS

1. **Intermittent `GET /` 500** — cause UNIDENTIFIED. Homepage checked 3/3 = 200 on
   2026-10-04 with no error; it has not reproduced since capture via `wrangler
   tail`. The opennextjs chunk-loading hypothesis is **DISPROVEN**. Treat as
   latent/unreproduced rather than actively broken.
2. **Free-plan CPU ceiling — LARGELY RESOLVED, with one residual (2026-10-04).**
   The historical "15/24 routes 503, /dashboard 12.4s" no longer reproduces.
   After recording legal acceptance for the QA account (which had been 307-ing
   every page route to `/legal/accept` and masking the real result):

   | Endpoint | Result |
   | --- | --- |
   | `/dashboard` (page) | 200 in **315ms** (was 12.4s) |
   | `/campaigns` (page) | 200 in 273ms |
   | `/lead-finder` (page) | 200 in 215ms |
   | `/settings/billing` (page) | 200 in 193ms |
   | `/api/dashboard/summary` | 200 in 964ms — 10/10 consecutive clean |
   | `/api/usage` / `/api/credits` / `/api/system/health` | 200 in 504 / 365 / 180ms |
   | `POST /api/auth/sign-in/email` | 200 in 598ms |

   Dashboard HTML inspected: **no error boundary**, and the hardcoded
   `+$36,500 net this month` placeholder is **absent** — it renders a real
   failure instead, confirming the honesty fix reached production.

   **Residual (G1b):** three rapid sign-in attempts produced `503` with Cloudflare
   error **1102**, then 429/429 at 66–78ms (the pre-hash throttle correctly
   refusing before the ~98ms hash). A single attempt after ~25s returned 200.
   So the burst ceiling is real but bounded and self-recovering; it is not the
   pre-fix 8/8 failure.

   Caveat: verified over authenticated HTTP, not in a browser. Console errors,
   hydration failures and error boundaries are still unproven absent — that is
   what the browser crawl is for.
3. **`scripts/wrangler-deploy.mjs` DOES NOT REBUILD** — it only runs
   `wrangler deploy`. Found 2026-10-04. Running it after a code change ships a
   **stale `.open-next` bundle while reporting success.** Observed directly: a
   deploy returned a fresh Worker (`6ea153be`) yet `/signup?ref=` still 404'd,
   because `app-path-routes-manifest.json` was timestamped 20:02 while the
   commit was 01:43 — neither `/signup/route` nor `/referrals/page` was in the
   bundle (368 routes registered; both absent).
   **Always run `yarn cf:build` first.** This is a silent-failure trap: it hides
   any code change from production while looking successful.

## EXTERNAL BLOCKERS

| Blocker | Blocks |
| --- | --- |
| `STRIPE_SECRET_KEY` absent | live billing, subscriptions, payments, payouts end-to-end |
| Apollo API key absent | live Apollo lead search |
| Bedrock credentials absent | live AI provider calls |
| Google OAuth credentials absent | live Google sign-in |
| Workers plan decision | full CPU headroom (owner decision) |

## SCORE

**7.5/10 — NOT READY for public launch.** Recalculated 2026-10-04 from this
corrected matrix, after live verification against Worker `499ceb4c`.

Raised from 7 because the largest open production defect is now closed with live
evidence: authenticated pages render in 193–315ms where they previously 503'd or
took 12.4s.

Method: every row counted at the level it actually reaches. `NOT STARTED` scores
0. Implemented-but-unverified scores partial. Only rows with test or live
evidence score full. No money-moving row is live-verified.

What the 2026-10-04 live pass established:

- **Referral chain LIVE VERIFIED** (`/signup?ref=` 404 → 307 → 200, `?ref` and
  `&plan` preserved; banner on homepage 3/3; `/referrals` 200).
- **Authenticated pages render LIVE**: `/dashboard` 200 in **315ms**, `/campaigns`
  273ms, `/lead-finder` 215ms, `/settings/billing` 193ms — versus 12.4s and 503s
  before. No error boundary in the HTML; the hardcoded `+$36,500` placeholder is
  gone. The largest open production defect is closed for normal traffic.
- **AI credit limiting INTEGRATION TESTED** including atomicity under
  concurrency (N2–N8).

What still prevents a higher score:

- **ZERO money-moving paths have end-to-end evidence.** Billing, subscriptions,
  payments, payouts and tax all fail closed behind absent credentials. This alone
  caps the project below 9/10, and it is the single largest remaining risk.
- **Console/hydration errors remain unproven absent** — verification was over
  HTTP, not in a browser. A page can return 200 and still throw client-side.
- **Burst sign-in can still return 1102** (bounded and self-recovering, but real).
- **The intermittent homepage 500 remains unidentified** and unreproduced; latent,
  not proven fixed.
- **Genuinely absent features:** CRM contacts page (no route exists at all),
  trial demo data, earnings date-range filters, AI calling + voice selection,
  affiliate programme, Flipper/Builder AI.

Not 10/10. The direction of travel is upward and every increase is backed by a
live measurement rather than an inherited number.