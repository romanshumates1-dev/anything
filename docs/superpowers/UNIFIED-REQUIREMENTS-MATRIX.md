# UNIFIED REQUIREMENTS MATRIX

**Regenerated 2026-10-03 from the actual repository, not from memory.**
Previous version retained at `UNIFIED-REQUIREMENTS-MATRIX.previous.md`.

Requirements source: `.github/agents/roman.agent.md` (sets A–AB plus the
logged-out, marketing, SEO, testing and scoring sections).
Implementation source: the working tree at commit `c87d510`.

## HOW TO READ THIS

Every row was checked against the filesystem, an API route, a database query or
a test run. "ABSENT" means no route, table or component was found — not merely
unverified.

| State | Meaning |
| --- | --- |
| NOT STARTED | No implementation found |
| IMPLEMENTED | Code exists; behaviour not proven by test |
| UNIT TESTED | Covered by a passing test |
| INTEGRATION TESTED | Covered against a real engine, not a mock |
| E2E TESTED | Covered in a real browser |
| LIVE VERIFIED | Observed working on the deployed domain |
| BLOCKED-EXTERNAL | Needs a credential/decision not mine to make |
| COMPLETE | Implemented and verified at every claimed level |

## STANDING VERIFICATION FACTS

| Check | Command | Result |
| --- | --- | --- |
| Unit/integration suite | `vitest run --config src/app/api/vitest.config.ts` | 267 files, 2946 passed, 26 skipped, 0 failed |
| Typecheck | `tsc -p tsconfig.typecheck.json --noEmit` | exit 0 |
| Lint | `oxlint` on changed files | 0 errors |
| Build gate | `yarn cf:gate` | exit 0 (build + size + secret scan, 3120 files) |
| Deploy | `node scripts/wrangler-deploy.mjs` | Worker `dd557bc1`, 3 cron triggers intact, 26ms startup |
| Production smoke | `GET / /pricing /features /api/system/health` | all 200 |
| Sign-in (deployed) | single legitimate attempt | **200 in 490ms** |
| Sign-in throttle | 3 rapid attempts | 200, 200, **429 in 75ms** (refused pre-hash) |
| Authenticated crawl | `deployed-browser-qa.mjs` | login OK; **15/24 routes 503** |

## SET A — AI SUPPORT

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| A1 | Support button smaller/unobtrusive | `src/components/SupportChat.tsx` | IMPLEMENTED | `SupportChat.test.tsx` Set A states | — |
| A2 | Support chat backend + provider | `src/app/api/support/chat/route.ts` | IMPLEMENTED | returns 503 when unconfigured | provider credential absent |
| A3 | Loading/error/timeout surfaced | SupportChat.test.tsx | UNIT TESTED | 429 path shows API message | — |

## SET B — SIDEBAR USERNAME / EMAIL

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| B1 | Long email must not break layout | `src/components/Shell.tsx` | IMPLEMENTED | commit `456c121` contract | — |
| B2 | Truncation + full value accessible | Shell.tsx | IMPLEMENTED | contract test present | not re-verified in browser this session |

## SET C — APOLLO LEAD SOURCE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| C1 | Apollo integration | `src/app/api/lead-finder/apollo/` (7 files) | UNIT TESTED | `route.test.ts` asserts precise 503 `APOLLO_NOT_CONFIGURED`, never fake success; `client.test.ts` covers 429 retry | `APOLLO_API_KEY` absent → BLOCKED-EXTERNAL |
| C2 | No client-side key exposure | server-only route | IMPLEMENTED | no `NEXT_PUBLIC_` reference | — |

## SET D — THIRD-PARTY LEAD SOURCES + UPCHARGE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| D1 | Entitlement enforced server-side | `src/app/api/utils/access-control.ts` | IMPLEMENTED | verified via the QA access gate | — |
| D2 | Paid add-on updates entitlement | `src/app/api/billing/subscribe/` | IMPLEMENTED | 503 + grants nothing without Stripe — fail closed | `STRIPE_SECRET_KEY` absent → BLOCKED-EXTERNAL |

## SET E — FREE TRIAL DEMO DATA

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| E1 | Synthetic demo data for trial users | none found | NOT STARTED | no demo/seed route under `src/app/api` | — |

## SET F — PERFORMANCE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| F1 | RSC prefetch no longer exhausts CPU | `prefetch={false}` | IMPLEMENTED | commit `103ac1d`, 16%→0% | — |
| F2 | Hashing within CPU budget | `src/lib/auth-cost-guard.ts` | INTEGRATION TESTED | 13/13 vs real Postgres; scrypt ~98ms vs ~10ms budget | underlying Free-plan ceiling |

## SET G — FULL SITE FUNCTIONALITY

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| G1 | Routes load without console/network errors | `scripts/deployed-browser-qa.mjs` | E2E TESTED | post-deploy crawl: login + legal acceptance verified end-to-end (lands on real `/dashboard`); **15 of 24 authenticated routes 503**, `/dashboard` 12.4s | see OPEN DEFECT 2 |
| G2 | No intermittent homepage 500 | — | NOT VERIFIED | `TypeError: components.ComponentMod.handler is not a function` captured via `wrangler tail`; did not reproduce in 40/40 controlled requests. **Chunk-loading hypothesis investigated and DISPROVEN** — see OPEN DEFECT 1 | cause still unidentified |

## MEASURED DASHBOARD FAN-OUT — AND WHAT IT WAS ACTUALLY COSTING (2026-10-03)

The dashboard is a client component, so its cost is the SUM of its client-side
fetches, each of which is a separate Worker invocation with its own CPU budget.

| Group | Count | Endpoints |
| --- | --- | --- |
| Shell (every authenticated page) | 5 | `/api/usage`, `/api/user/preferences`, `/api/system/health`, `/api/approvals/count`, `/api/actions?limit=1` |
| Dashboard page | 2 | `/api/dashboard/stats`, `/api/system/health` (deduped by React Query — same key) |
| Dashboard components | 10 | campaigns, credits, funnel, activity, next-actions, pipeline x2, quick-stats, engagements, weekly-progress |

**17 invocations on one page load.** Sequential per-endpoint timings (low-volume,
authenticated, all 200): min 186ms, max 715ms, mean 328ms, total 4915ms. So no
single endpoint is broken; the page is slow because of breadth, and the 503s
appear only under cumulative load (the 24-route crawl), not per route.

### CPU attribution (`wrangler tail`, production, 15 sequential authenticated requests)

Per-request CPU, in milliseconds, as reported by Cloudflare for the deployed
Worker (`cpuTime`):

| Request | CPU | Wall |
| --- | --- | --- |
| `/api/auth/sign-in/email` (argon2 verify) | **344** | 653 |
| `/api/system/health` | **144** | 210 |
| `/api/usage` | 39 | 587 |
| `/api/actions?limit=1` | 36 | 686 |
| `/api/credits?history=true` | 23 | 238 |
| the 9 remaining dashboard slices | **13–19 each** | 151–352 |

Two things follow, and one of them corrects a standing assumption:

1. **The dashboard's slowness is round-trip count, not query cost.** Nine slices
   cost 13–19ms of CPU each. Nothing there is slow. The 9.4s page was 17 cold
   invocations plus 17 round trips.
2. **The "Free plan = 10ms CPU ceiling" note in `wrangler.jsonc` is not what the
   platform is enforcing here.** A single request using **344ms of CPU returned
   `outcome: "ok"`, status 200.** Cloudflare also *rejected* `limits.cpu_ms` with
   "CPU limits are not supported for the Free plan" [code: 100328]. Those two
   facts cannot both describe a 10ms-per-invocation ceiling, so the enforced
   limit is materially higher than the file claims. The file's own conclusion —
   that argon2 does not fit and a plan upgrade is the only remedy — is therefore
   **not supported by the measurement that prompted it**, and is not repeated
   here as fact. The plan upgrade stays a decision for the owner, but it is not
   justified by this data.

Also observed, unexplained and outside this change: `GET /api/session/properties`
returns **404 from no code in this repository** and costs 232–363ms of CPU per
hit. Something outside the app is calling it.

### Fix: one invocation for all ten cards

`GET /api/dashboard/summary` serves every dashboard payload from one invocation.
The SQL lives in `src/app/api/utils/dashboardSlices.ts` and is imported by BOTH the
individual endpoints and the batch, so the two cannot drift.

- Dashboard card data: **10 invocations -> 1** (page load: 17 -> 8)
- A slice that fails is omitted and named in `errors`; that ONE card falls back to
  its own endpoint. The batch failing outright degrades every card to the
  pre-existing behaviour. The dashboard cannot go blank because of it.
- Regression test `dashboard-summary-fanout.test.tsx`: all ten cards make exactly
  **1** request; they render the batch's values; a partial batch causes exactly
  **one** extra request for the missing slice; a failed batch degrades to
  per-card fetching.

**Still open, deliberately:** the Shell's own 5 requests (plus `beta-flags` from
`DemoModeBanner` and `credits` from the header) are untouched, so an
authenticated page still costs ~7 invocations before its own content. They are
the next consolidation, deferred until this one is measured in production.

### Defect found and fixed: duplicated pipeline fetch

`PipelineFlowVisualization` and `PipelineStatusCard` both requested
`GET /api/pipeline?include_config=false` under DIFFERENT query keys
(`pipeline-flow`, `pipeline-status`). React Query dedupes on the key, so both
requests always fired — two identical Worker invocations for one payload,
repeating every 60s on any open dashboard. Extracted to a shared
`usePipelineStatus()` with one key.

Regression test `pipeline-status-dedupe.test.tsx` renders both components and
asserts exactly one request; verified RED by temporarily restoring the old
behaviour (`expected 1 pipeline request, saw 2`).

## FABRICATED DASHBOARD DATA (2026-10-03)

Found while consolidating, because the fake values would otherwise have been
preserved verbatim as "existing behaviour". Each card substituted hardcoded
sample data whenever its endpoint returned **any** non-2xx, so a failing query
rendered a healthy-looking dashboard:

| Element | Rendered on failure |
| --- | --- |
| `QuickStatsBar` | 847 leads, 623 contacted, 198 responses, 12 deals |
| `LeadFunnelVisualization` | a full 6-stage funnel + $8,500 avg deal + $102,000 projected |
| `RecentEngagementCard` | four invented leads with invented replies |
| `LiveActivityFeed` | a fabricated event log (closed deal, signed contract, hot lead) |
| `NextActionsCard` | four invented tasks ("Call back Sarah Davis", "Agreed on $95,000") |
| `WeeklyProgressSummary` | 156 leads contacted and a 12-day streak |
| `CreditBalanceCard` | a 2,450-credit balance on a "pro" tier |
| `ProfitChart` | **always** — a hardcoded Jan–Aug P&L with "+$36,500 net this month" |
| `CampaignProgressCard` | a 15% response rate (`Math.round(sent * 0.15)`) and an ETA from a hardcoded `dailyRate = 50` |

All of these now render a real failure, or (for figures that do not exist) say
so. `ProfitChart` states that no monthly P&L is available and why; it is not
estimated. `campaign_leads` was checked against `information_schema` — it has no
response column at all, so the 15% response rate was never measured.

While extracting, one further data defect was corrected in place:
`/api/dashboard/engagements` selected `lead_name`, `property_state` and
`campaign_name` but then mapped `first_name`, `last_name`, `property_address`,
`property_city`, `classification` and `content` — **none of which were selected**.
Every card therefore rendered the literals "Unknown" and "Address unavailable",
and every engagement was typed `response`. The endpoint answered 200 with a
payload that could not be right, which is why no test caught it.


| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| H1 | No avoidable console errors | partial | IN PROGRESS | logged-out public routes: 0 failing responses in a controlled pass | authenticated console sweep not completed |

## SET I — BILLING / SUBSCRIPTIONS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| I1 | Subscription state machine, tiers, upgrade/downgrade/cancel | `src/app/api/billing/subscribe/route.ts` | UNIT TESTED | 503 and grants nothing without Stripe — fail closed | live verification BLOCKED-EXTERNAL |
| I2 | Webhook signature + idempotency | `src/app/api/payments/webhook/route.ts` | UNIT TESTED | `webhook.test.ts`; `esign-webhook-security.test.ts` covers replay | live provider BLOCKED-EXTERNAL |
| I3 | Purchased credits separate from plan credits | `src/app/api/credits/purchase/route.ts` | IMPLEMENTED | route exists, 503 when unconfigured | — |
| I4 | Shopify | none found | NOT APPLICABLE | no Shopify code in the repo | — |

## SET J / K — PAYOUTS, EARNINGS, FILTERS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| J1 | Withdrawal request, threshold, duplicate prevention, authorization | `src/app/api/withdrawals/route.ts` | UNIT TESTED | `withdrawals.test.ts` | live withdrawal not performed (moves real funds) |
| K1 | Earnings date-range filters | none found | NOT STARTED | no dated-grouping endpoint under `src/app/api/payouts` | — |

## SET L / M — TAX REPORTING + AUTO WITHHOLDING

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| L1 | Ledger-derived earnings/tax report | `src/app/api/tax/` (5 files) | UNIT TESTED | `tax-withdrawal-integration.test.ts` | — |
| M1 | Optional auto tax withholding | `src/app/api/tax/withhold*` | IMPLEMENTED | code present | not verified against the real ledger |

## SET N — AI CREDIT LIMITING

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| N1 | Monthly AI allowance | `src/app/api/credits/route.ts` | IMPLEMENTED | returns usage + history | — |
| N2 | Weekly limit = 25% of monthly | none found | NOT STARTED | grep in credits/route.ts finds only a `historyLimit` query param | — |
| N3 | Daily limit = 20% of weekly | none found | NOT STARTED | same search | — |

## SET O — RESTRICTED SIGNUPS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| O1 | Admin ON/OFF domain restriction | `signup-restrictions.ts` + `email-domain-policy.ts` | UNIT TESTED | wired into the auth `before` hook for `/sign-up/email` | ON/OFF not re-verified live this session |

## SET P–T — CAMPAIGN UX, WORKFLOW, AI CALLING, TEMPLATES, VOICE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| P1 | Campaign UX redesign | `src/app/campaigns` | IMPLEMENTED | routes exist | not browser-verified this session |
| Q1 | Workflow phase toggles (phone/SMS/email) | `src/app/api/campaigns/{automation,config}` | IMPLEMENTED | code present | enabled/disabled execution NOT VERIFIED |
| R1 | AI phone calling | none found | NOT STARTED | no calling/voice provider route | provider credential |
| S1 | AI templates | `src/app/templates`, `src/components/templates` | IMPLEMENTED | routes + components exist | — |
| T1 | Voice selection / AUTO recommendation | none found | NOT STARTED | no voice route | — |

## SET U — ADMIN CRM ANALYTICS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| U1 | Admin analytics from real records | `src/app/{admin,analytics,funnel}` | IMPLEMENTED | routes exist | must reflect only ENABLED phases — NOT VERIFIED |

## SET V — GAMIFICATION

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| V1 | GAMIFICATION ON/OFF setting | `utils/gamification.ts` + preference allowlist | UNIT TESTED | commit `61fe673`; gamification.test.ts | — |
| V2 | XP, levels, battle pass, crates, competitions, spin | `/api/achievements`, `/api/leaderboard` only | PARTIAL | two endpoints exist | no crates/spin/battle-pass/competitions found |

## SET W — USER SETTINGS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| W1 | Dyslexia font, reduced motion, scaling | `AccessibilityProvider.tsx`, `settings/accessibility` | UNIT TESTED | persists via `/api/user/preferences`; skips anonymous fetches | — |

## SET X — PAID ACCOUNT CLARIFICATION

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| X1 | UI must not claim what backend denies | access-control + billing 503s | IN PROGRESS | backend fails closed | frontend/backend agreement not exhaustively verified |

## SET Y — ADVANCED CRM PIPELINE METRICS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| Y1 | Metrics reflect only enabled phases | `src/app/api/analytics` | IMPLEMENTED | code present | **NOT VERIFIED** that disabled phases are excluded |

## LOGGED-OUT WEBSITE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| L-1 | Google sign-in | `socialProviders` in auth.ts, provider-gated | IMPLEMENTED | config present | OAuth client credentials → BLOCKED-EXTERNAL |
| L-2 | Worker resource error resolved | pre-hash cost guard | INTEGRATION TESTED | root-caused and bounded in code | Free-plan ceiling remains |
| L-3 | Password reset/change email | `/account/forgot-password`, `/api/auth/forgot-password` | IMPLEMENTED | rate-limited, fail-closed | real inbox delivery NOT VERIFIED |

## MARKETING, LEGAL, SEO

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| MKT-1 | Public marketing pages | `src/app/(marketing)` home, pricing, features, trust, faq, how-it-works, contact | E2E TESTED | all 200, 0 failing subresources in a controlled pass | — |
| MKT-2 | Legal/compliance pages | `legal/terms`, `legal/privacy`, `legal/refunds`, `legal/cookies`, `/compliance` | E2E TESTED | all 200. `/compliance` → `/trust` is an INTENTIONAL `permanentRedirect`: the standalone page was superseded by the /trust Compliance Center and carried unsubstantiated SOC 2 / "carrier-grade" claims | — |
| MKT-3 | Referral / first-1,000-users banner | none found | NOT STARTED | no referral banner component found | — |
| SEO-1 | Titles, canonical, robots, sitemap, structured data | `layout.tsx`, `lib/seo.ts`, `robots.ts`, `sitemap.ts` | IMPLEMENTED | canonical + absolute metadataBase; deny-by-default indexing for private routes | not audited this session |

## GENUINELY ABSENT (no code found at the paths searched)

| Requirement | Searched | Result |
| --- | --- | --- |
| Affiliate programme (application, approval, attribution, commission ledger, payout) | `src/app/api/affiliate*`, `src/app/affiliate` | **ABSENT** |
| Flipper / Builder AI (property, renovation, visualisation, project plan) | `src/app/flipper`, `src/app/builder` | **ABSENT** |
| AI phone calling | `src/app/api/**/calling*` | **ABSENT** |
| Spin wheel / crates / battle pass / competitions | `src/app/api/gamification` | **ABSENT** (only achievements + leaderboard) |
| Earnings date-range filters | `src/app/api/payouts` | **ABSENT** |
| Free-trial demo data | `src/app/api/**/demo*` | **ABSENT** |
| AI weekly/daily credit ceilings | `src/app/api/credits` | **ABSENT** |
| Referral banner | `src/components/marketing` | **ABSENT** |

## OPEN DEFECTS (unresolved, honestly recorded)

1. **Intermittent `GET /` 500** — `TypeError: components.ComponentMod.handler is
   not a function`, captured live (cf-ray `a44dae47afab3f27`) via
   `wrangler tail`. Did not reproduce across 40/40 controlled requests (idle,
   tight-sequential, 8-way parallel).

   **Leading hypothesis investigated and DISPROVEN.** The error text matches
   upstream opennextjs/opennextjs-cloudflare#1305 (Windows-only empty
   `requireChunk()` switch) and #1258. We run Windows + opennext 1.20.6 + Next
   16.3.6, so the symptom fits exactly. `scripts/_audit-turbopack-runtime.mjs`
   checks the real artefacts and rules it out:
   - intermediate `[turbopack]_runtime.js`: 2038 cases (NOT the empty switch)
   - deployed `handler.mjs`: 2038 cases, every `require()` rewritten to an
     inlined function, zero absolute paths, `default: throw` fallback present

   So the deployed bundle is sound and chunk loading is not the cause. Note the
   absolute paths in the intermediate file are expected and rewritten by the
   bundler — judging that file alone would have produced a false "confirmed".

   Remaining candidates, none yet evidenced: a race in concurrent RSC render
   state within a reused isolate, or a module-scope cache shared across
   requests. Not yet instrumented. **Cause UNIDENTIFIED.**

2. **Free-plan CPU ceiling — SIGN-IN FIXED, PAGE RENDERS STILL BROKEN.**
   Root cause was scrypt, not argon2: all 152 `account.password` rows are
   `hex32:hex128` (161 chars) = scrypt(N=16384, r=16, p=1, dkLen=64), better-auth's
   default. Zero `$argon2` rows, so that branch was dead code. Measured ~98ms per
   verification (native node:crypto) against a ~10ms Free-plan budget; the bundled
   Worker uses the native path.

   FIXED AND DEPLOYED (`c87d510`, Worker `dd557bc1`). `src/lib/auth-cost-guard.ts`
   gates sign-in on the app's atomic Postgres limiter before hashing. Post-deploy
   evidence on the deployed Worker:
   - legitimate sign-in: **200 in 490ms** (previously 8/8 CPU-abort 503)
   - three rapid attempts: 200, 200, **429 in 75ms** — refused BEFORE hashing
     (a hash costs ~98ms, so a 75ms refusal proves the early exit)
   - recovery after the 10s window: 200

   **STILL BROKEN: authenticated page renders.** A deployed browser crawl after
   the fix returned 15 of 24 authenticated routes as 503, and `/dashboard` took
   12.4s. The guard bounds password verification only; page rendering independently
   exceeds the budget. Closing this requires either a Workers plan upgrade or
   per-route render cost reduction — an owner decision plus further engineering,
   not a one-line fix. Quantified as: 15/24 routes failing, p95 render ~12s.

## EXTERNAL BLOCKERS (cannot be resolved in code)

| Blocker | Blocks | Note |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` absent | live billing, subscriptions, payments, payouts end-to-end | provider-independent architecture and tests remain in scope |
| Apollo API key absent | live Apollo lead search | mock/fixture tests remain in scope |
| Bedrock credentials absent | live AI provider calls | mocks remain in scope |
| Google OAuth client credentials absent | live Google sign-in | — |
| Workers plan decision | full CPU headroom | owner decision |

## SCORE

Strict, evidence-based, at commit `c87d510`:

**6/10 — NOT READY for public launch.**

- Automated regression is strong: 2946 tests pass, typecheck and lint clean.
  Necessary, but explicitly not sufficient.
- Two production defects remain open: the intermittent homepage 500 (cause
  unknown) and the CPU ceiling that makes sign-in fragile under real load.
- Seven requirement areas are genuinely absent, not merely unverified: affiliate,
  Flipper/Builder AI, AI calling, earnings filters, trial demo data, AI
  weekly/daily credit ceilings, referral banner.
- Billing, payouts, Apollo, Bedrock and Google sign-in are unverified against
  live providers, so no money-moving path has end-to-end evidence.

Not 10/10, and not 7: a customer signing in under load can still hit a 503, and
the homepage can still 500 intermittently with no known cause.

## SET Z / AA / AB — ONBOARDING

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| Z1 | Persistent tutorial progress | `OnboardingTutorial.tsx`, `OnboardingChecklist.tsx` | UNIT TESTED | commit `87fcfc3`, survives device change | — |
| AA1 | Outreach provider onboarding | `settings/outreach/{email,sms}` | IMPLEMENTED | routes + verify subroutes exist | — |
| AB1 | Onboarding feature choices | preferences allowlist | PARTIAL | gamification opt-in exists | full choice set NOT VERIFIED |
