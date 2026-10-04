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
| N2 | Weekly cap = 25% of monthly included credits | `api/utils/aiCreditLimits.ts` `deriveAiCreditPeriodCaps` → `weekly: Math.floor(n/4)` | INTEGRATION TESTED | 19 tests in `aiCreditLimits.test.ts`; code present in deployed bundle | 2026-10-04 |
| N3 | Daily cap = 20% of weekly included credits | same → `daily: Math.floor(n/20)` | INTEGRATION TESTED | same | 2026-10-04 |
| N4 | Purchased credits excluded from included caps | `aiCreditLimits.ts:181-183`, `aiCreditGate.ts:103-108` | UNIT TESTED | documented + covered | 2026-10-04 |
| N5 | Every AI route passes the gate | `apiCreditGate.ts` `authorizeAiRequest` | UNIT TESTED | `ai-credit-gate.test.ts`, 5 tests | 2026-10-04 |

**Do not rebuild N2/N3/N4.** They satisfy the spec including the
purchased-credit nuance. **Open gap:** the arithmetic is proven, but the caps
have **not** been verified against the live `ai_credit_usage` ledger. See
OPEN WORK `N2-live`.

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
| E1 | Synthetic demo data for trial users | none found at `api/**/demo*` | NOT STARTED | — | — |

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
| H1 | No avoidable console errors | partial | IN PROGRESS | logged-out routes clean; authenticated sweep incomplete |
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
| K1 | Earnings date-range filters | none found at `api/payouts` | NOT STARTED | — | — |

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
| R1 | AI phone calling | none found at `api/**/calling*` | NOT STARTED | — | provider credential |
| S1 | AI templates | `app/templates`, `components/templates` | IMPLEMENTED | routes + components exist | — |
| T1 | Voice selection / AUTO recommendation | none found | NOT STARTED | — | — |

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
| MKT-3 | Referral / first-1,000-users banner | `components/marketing/ReferralGiveawayBanner.tsx`, `app/referrals/page.tsx` | UNIT TESTED | commit `2ea6db3`; 14 tests incl. full attribution chain | **NOT DEPLOYED — live 404 of `/signup` reproduced, fix unverified live** |
| SEO-1 | Titles, canonical, robots, sitemap, structured data | `layout.tsx`, `lib/seo.ts`, `robots.ts`, `sitemap.ts` | IMPLEMENTED | canonical + absolute metadataBase; deny-by-default private routes | not audited this cycle |

## GENUINELY ABSENT (verified absent at the searched paths)

| Requirement | Searched | Result |
| --- | --- | --- |
| Affiliate programme | `api/affiliate*`, `app/affiliate` | **ABSENT** |
| Flipper / Builder AI | `app/flipper`, `app/builder` | **ABSENT** |
| AI phone calling | `api/**/calling*` | **ABSENT** |
| Spin wheel / crates / battle pass / competitions | `api/gamification` | **ABSENT** (only achievements + leaderboard) |
| Earnings date-range filters | `api/payouts` | **ABSENT** |
| Free-trial demo data | `api/**/demo*` | **ABSENT** |
| ~~AI weekly/daily credit ceilings~~ | ~~`api/credits`~~ | **WRONG PATH — implemented in `api/utils`, see correction** |

---

## OPEN WORK (highest priority first)

| ID | Task | Status | Next action |
| --- | --- | --- | --- |
| N2-live | Verify AI credit period keys against the real ledger | NOT STARTED | inspect `aiCreditDb.ts`; query `ai_credit_usage` |
| SCORE | Recalculate score from this corrected matrix | NOT STARTED | after N2-live |
| DEPLOY | Ship `2ea6db3` + `ff3b262` + `503845f` | NOT STARTED | `node scripts/wrangler-deploy.mjs`, then re-verify `/signup?ref=` |
| G2 | Intermittent homepage 500 | BLOCKED (cause unknown) | instrument; chunk hypothesis already DISPROVEN |
| G1 | 15/24 authenticated routes 503 | OPEN | re-crawl after deploying `503845f` |

## OPEN DEFECTS

1. **Intermittent `GET /` 500** — `TypeError: components.ComponentMod.handler is
   not a function`. Cause UNIDENTIFIED. 40/40 controlled requests did not
   reproduce. The opennextjs chunk-loading hypothesis is **DISPROVEN** (deployed
   `handler.mjs` audited: 2038 cases, all `require()` inlined, zero absolute
   paths, `default: throw` present).
2. **Free-plan CPU ceiling** — sign-in FIXED and deployed (`c87d510`). Authenticated
   page renders still 503 (15/24 routes, p95 ~12s). `503845f` addresses dashboard
   fan-out but is undeployed.

## EXTERNAL BLOCKERS

| Blocker | Blocks |
| --- | --- |
| `STRIPE_SECRET_KEY` absent | live billing, subscriptions, payments, payouts end-to-end |
| Apollo API key absent | live Apollo lead search |
| Bedrock credentials absent | live AI provider calls |
| Google OAuth credentials absent | live Google sign-in |
| Workers plan decision | full CPU headroom (owner decision) |

## SCORE

**PROVISIONAL — REQUIRES RECALCULATION.**

The prior "6/10" was derived from a matrix now known to be materially
inaccurate, so it is neither a floor nor a ceiling and must not be inherited as
fact. Recalculate from this document.

Not 10/10: two open production defects, and no money-moving path has end-to-end
evidence.