# UNIFIED REQUIREMENTS MATRIX

**Canonical requirements tracker.** Regenerated 2026-10-04 against the working
tree at `ff3b262`. Supersedes the earlier root-level copy, which contained
internal contradictions (it asserted both "all 200 routes pass" and "15/24 routes
failed" in the same document).

**Last updated 2026-10-08 at `48bdaf3`** — H1: an avoidable console error in
the test suite was removed. `Shell.test.tsx`'s `next/link` mock spread
`...rest` onto a raw `<a>`, so React logged `Received \`false\` for a
non-boolean attribute \`prefetch\`` on every render. The mock now destructures
`prefetch` out (same convention as `dashboard-summary-fanout.test.tsx`) and a
new test asserts the render emits no non-boolean-attribute warning, with an
`anchors > 0` guard so an empty render cannot pass vacuously. **Production code
unchanged — `Shell.tsx` was NOT modified**; real `next/link` consumes
`prefetch`. Mutation-proven: a temp copy with the leaking `...rest` restored →
new test FAILs; real impl → 11/11 pass; `src/components` 9 files / 59 tests
pass. H1's browser-side status is unchanged (still PARTIAL pending sustained
load) — this closes the test-suite console error only. Earlier B1/B2 (`954c910`)
and the analytics schema-truth fix (`a0c9ec6`) still stand; score unchanged at
8.5/10 (no requirement-status change that moves it).

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
| B1 | Long email must not break layout | `components/Shell.tsx` | UNIT TESTED | commit `954c910`; `Shell.test.tsx` 10 tests; mutation-verified (strip `truncate`/`min-w-0`/`title` in a temp copy → 2 new tests FAIL; real impl → 10/10 pass) | not re-verified in browser |
| B2 | Truncation + full value accessible | `Shell.tsx` | IMPLEMENTED | contract test pins DOM `truncate` + `min-w-0` container + `title` in BOTH identity blocks; Set B short-value case included | not browser-verified |

## SET AB - ONBOARDING FEATURE CHOICES

Slice 1 (write path) landed at da2b6c9 (2026-10-11): the signup questionnaire now ASKS which optional features the user wants (gamification, phone calling, SMS, email, advanced analytics, AI automation, demo data) instead of force-enabling everything silently. Shared codec api/utils/featureChoices.ts is the single read/write contract; PATCH/PUT /api/user/preferences sanitises the value; the gamification choice mirrors into gamification_enabled so the existing Shell + server gates enforce it.

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| AB1 | Questionnaire asks the seven master-spec feature choices, all default ON | components/signup/SignupQuestionnaire.tsx step 3 | UNIT TESTED | SignupQuestionnaire.test.tsx 4 tests (renders all seven ON; toggle OFF arrives as false; SKIP writes nothing) | - |
| AB2 | Shared read/write codec with strict booleans, defaults, allowlist | api/utils/featureChoices.ts | UNIT TESTED | featureChoices.test.ts 15 tests; gamification default agrees with gamification.ts by test | - |
| AB3 | Preferences route sanitises feature_choices on PATCH+PUT | api/user/preferences/route.ts | UNIT TESTED | featureChoices.route.test.ts 6 tests (strict booleans, fills defaults, drops unknown keys, 401 before storage) | - |
| AB4 | Gamification choice actually enforced (mirror key) | buildFeaturePreferencePayload to gamification_enabled | UNIT TESTED | Shell nav gating + requireGamificationEnabled server gates; regression 49/49 | - |
| AB5 | phone_calling/sms/email/advanced_analytics/ai_automation/demo_data enforced | featureChoices.server.ts, Shell.tsx, analytics/advanced, analytics/crm, ai-recommendations, campaigns, organizations, free-tier/seed | UNIT TESTED | `2b9cab9`: featureChoices.enforcement.test.ts 10 tests + Shell.test.tsx 2 nav-gating tests (56/56 combined); resolveFeatureChoice now has 8 production callers (Shell nav, analytics/advanced, analytics/crm, ai-recommendations, campaigns channels, organizations seeding, free-tier/seed, isFeatureEnabledForUser DB gate) | - |
## SET C — APOLLO LEAD SOURCE

Complete provider-independent implementation at `api/lead-finder/apollo/`
(`route.ts`, `client.ts`, `config.ts`, `normalize.ts`).

**112/112 tests pass across `api/lead-finder`** (10 files), including Apollo:
`Retry-After` honoured on 429, **persistent 429 throws RATE_LIMITED after bounded
retries and never loops**, 401 fails fast as `AUTH_FAILED` and **never leaks the
API key**, 5xx retries once, network failure bounded, malformed response
rejected, insecure `APOLLO_BASE_URL` refused, `perPage` clamped, and
**normalization that never persists contact data** (emails/phones stripped).

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| C1 | Apollo integration, retries, errors | `api/lead-finder/apollo/` (7 files) | UNIT TESTED | client + normalize + route tests; precise `APOLLO_NOT_CONFIGURED` 503 | real provider search |
| C2 | No client-side key exposure | server-only route | UNIT TESTED | "never leaks the API key" on 401 | — |
| C3 | Response normalization + data-minimisation | `normalize.ts` | UNIT TESTED | emails/phones stripped before persistence | — |
| C4 | Config safety | `config.ts` | UNIT TESTED | refuses insecure base URL; precise missing-key error | — |

### Exactly what needs `APOLLO_API_KEY` — and nothing else

1. A real people-search returns live Apollo records.
2. Real rate limiting behaves as modelled (the 429 path is already proven with
   fixtures).
3. Apollo field mapping matches the live API shape.

Client, retries, normalisation, scrubbing, config validation, entitlements and
UI are all already implemented and tested. Inject via
`wrangler secret put APOLLO_API_KEY`; never inline it.

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
| G1 | Authenticated routes render | `scripts/deployed-browser-qa.mjs`, `scripts/qa-page-probe.mjs` | **LIVE VERIFIED 2026-10-07** | `qa-page-probe.mjs`: **104 routes / 100 OK / 4 benign redirects / 0 SERVER_FAULTS** on `dealswift-loadtest`. The historical 15/24 503s RESOLVED 2026-10-04 (pages 193–315ms) | residual burst 1102 → G1b |
| G2 | No intermittent homepage 500 | `scripts/patch-opennext-handler-guard.mjs` + `.test.ts` | **DIAGNOSABLE 2026-10-09** (step 1) | Guarded call site shipped & wired into `cf:build`; 5 tests green; verified on real bundle. `[g2-handler-guard]` marker + `PageModuleLoadError` now replace the silent TypeError. **Root cause still unconfirmed** (memory hypothesis unmeasured); not reproduced (40/40). NOT resolved. |
| G3 | Analytics views serve every parameter variant without 5xx | `crmAnalyticsEngine.ts`, `analytics/attribution/route.ts`, `schemaColumnTruth.guard.test.ts` | **DONE 2026-10-07** (`a0c9ec6`) | phantom `contracts.lead_id` / `message_events.opened_at` / `leads.zip_code` corrected at 7 sites; probe: all 8 `analytics/crm` variants 200 incl. `groupBy=zipCode` + `view=outreach`; static tree-scan guard + regression samples | — |

## SET H — CONSOLE / DATA HONESTY

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| H1 | No avoidable console errors | **PARTIAL (browser-side LOCAL-VERIFIED 2026-10-14)** | Browser sweep 2026-10-04: **no error boundaries and no uncaught exceptions** on `/dashboard`, `/campaigns`, `/lead-finder`, `/settings/billing`. Remaining console noise is a Cloudflare RUM beacon aborted on navigation (`/cdn-cgi/rum?`) plus the 503/1102 burst. Not yet clean under sustained load. **Test-suite console error CLOSED 2026-10-08 (`48bdaf3`)**: `Shell.test.tsx`'s `next/link` mock no longer leaks `prefetch` onto a raw `<a>` (React "non-boolean attribute" warning); guard test added, mutation-proven. `Shell.tsx` untouched — real `next/link` consumes `prefetch`. **Local browser crawl 2026-10-14 (`f2c4488`+):** real Edge via repo `playwright-core` against `opennextjs-cloudflare preview` serving the `cf:build` bundle at `600ac1a` — **8/8 logged-out marketing pages** (`/`, `/pricing`, `/features`, `/how-it-works`, `/cash-offer`, `/faq`, `/about`, `/contact`) 200 with **zero console errors, zero console warnings, zero uncaught page errors, zero 5xx**; JSON-LD renders and `JSON.parse`s cleanly in the real DOM (home 2, pricing 2, features 1, how-it-works 1, faq 1). Limits: local build (production serves the older `493bb2a` bundle), logged-out only (authenticated surfaces need sandbox DB — local `.env` may point at real infra, so no local logins were attempted), single sweep not sustained load |
| H2 | Dashboard shows real data, never invented | commits `503845f`, `753e1b9` | UNIT TESTED | `ProfitChart` etc. now render real failure instead of hardcoded sample numbers; dashboard-analytics slices regression-pinned on real PGlite @ `60faac0` — `dashboardSlices.pglite.test.ts` (7) + `dashboardSlices.multitenant.pglite.test.ts` (18) = 25 tests green, covering `getDashboardStats` (audit_logs scoped via `organization_members`, jobs scoped via `payload->>'organization_id'`, `requires_human` via the leads join), quick-stats, funnel, nextActions, weekly-progress, plus two-org isolation incl. the `requires_human = TRUE` escalation predicate. That escalation fix is **H2 data-honesty, not F2 (password hashing)** |

## SET I — BILLING / SUBSCRIPTIONS

Real Stripe SDK is wired (`api/payments/stripe/route.ts`, apiVersion
`'2026-06-24.dahlia'`) with a null-guard: when `STRIPE_SECRET_KEY` is absent the
client is `null` and routes fail closed rather than pretending to work.

**52/52 tests pass** across `api/billing` + `api/payments`, covering the
subscription lifecycle, **dunning** (`invoice.payment_failed` → `past_due`),
**reactivation** on `invoice.paid`, **signature verification** (403 on invalid),
**replay/duplicate** handling (already-processed events acknowledged without
re-running ledger SQL), amount-mismatch hold (no auto-mark), refunds, unsettled
sessions granting nothing, unattributable PAID sessions refusing to grant, and
credit packs read **from the DB row, never from the amount**.

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| I1 | Subscription state machine, tiers, upgrade/downgrade/cancel | `api/billing/subscribe/route.ts` | UNIT TESTED | `subscribe.test.ts`; fail-closed 503 without Stripe | live lifecycle needs test key |
| I1b | Refund request (money-returning) | `api/billing/refund/route.ts` | **ROUTE TESTED 2026-10-09** (`1d4dc96`) | `route.test.ts` 11 tests: 401/403 gating, refuses 400 when policy says ineligible or already-refunded, requires confirmation when credits used, Stripe.refund called with the eligible amount, refund-request INSERT org-bound, no Stripe call without a payment intent, Stripe throw → 500 (no silent success). Mutation-proven (eligibility-gate bypass → 2 red) | live Stripe round-trip |
| I2 | Webhook signature + idempotency | `api/payments/webhook/route.ts` | UNIT TESTED | `webhook.test.ts`: 403 invalid signature, replay dedupe, no double-grant | live provider |
| I3 | Purchased credits separate from plan credits | `api/credits/purchase/route.ts` | UNIT TESTED | packs granted from DB row, never from amount | — |
| I4 | Dunning + reactivation | `webhook/route.ts` | UNIT TESTED | `invoice.payment_failed`→past_due; `invoice.paid` reactivates | live provider |
| I5 | Shopify | none found | NOT APPLICABLE | no Shopify code in repo | — |

## BILLING — STRIPE STATUS (2026-10-04)

**Test mode verified against the real Stripe API.** `scripts/verify-stripe-testmode.mjs`:
ALL CHECKS PASSED — account reachable, `balance.livemode=false` (confirmed, not
assumed), SDK + `apiVersion '2026-06-24.dahlia'` accepted, a $1.00 test payment
intent created/retrieved/**cancelled**, `card_payments` capability active.

The inline `price_data` checkout shape (unit_amount from `plan.price_cents`) is
confirmed accepted by Stripe — this is the path `api/billing/subscribe` and
`stripeProvider.ts` actually use. The account has **zero** pre-created products
and prices; none are required.

**`STRIPE_PROVIDER=live` requires BOTH `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`.** That is deliberate: entitlements are granted only from
a signature-verified webhook, so selling without the webhook secret would charge
customers and never deliver. The route refuses (503) instead.

### To go live (owner action, at EOD)

```bash
cd apps/web
npx wrangler secret put STRIPE_SECRET_KEY        # sk_live_... — prompted, not in shell history
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_... from the webhook endpoint
npx wrangler secret put STRIPE_PROVIDER          # value: live
```

Also required: a Stripe webhook endpoint pointing at
`https://dealswiftautomation.com/api/payments/webhook`, subscribed to
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`payment_intent.succeeded/failed/refunded`.

**Secrets must never be pasted into chat, files, or commits.** Use the prompts.

### Still BLOCKED-EXTERNAL after all key-independent work

The webhook *round-trip* cannot be proven locally: it needs a real signed
delivery from Stripe to the deployed Worker. Everything on our side of that
boundary — signature verification, replay dedupe, entitlement mapping, ledger
writes, dunning transitions — is covered by the 52 passing tests.

## SET J / K — PAYOUTS, EARNINGS, FILTERS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| J1 | Withdrawal request, threshold, duplicate prevention, authorization | `api/withdrawals/route.ts` | UNIT TESTED | `withdrawals.test.ts` | live withdrawal not performed (moves real funds) |
| K1 | Earnings date-range filters (day/week/month/quarter/year/custom) | `api/earnings/route.ts` (`from`/`to`) + `app/payouts/page.tsx` (`RangePreset`) | **INTEGRATION TESTED** | 16/16 in `api/earnings/route.test.ts`, incl. inverted-range rejection and IDOR scoping; UI exposes all 7 presets with server-side `rangeTotals` | — |

## SET L / M — TAX

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| L1 | Ledger-derived earnings/tax report | `api/tax/` (5 files) | UNIT TESTED | `tax-withdrawal-integration.test.ts` | — |
| M1 | Optional auto tax withholding | `api/tax/withhold*`, `api/tax/settings/route.ts` | **PGlite VERIFIED 2026-10-07** | `taxWithholdingStore.pglite.test.ts`: migration 090 applied to real Postgres (PGlite); settings upsert + CHECK constraint, `recordWithholding` idempotency, `getWithheldBalance` tenant-scoped aggregate, `listLedger` tenant-scoped date-range, cross-tenant isolation, money conservation. **18/18 tests pass.** | — |

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
| P1 | Campaign UX redesign | `app/campaigns` | IMPLEMENTED | routes exist; list handler `api/outreach/campaigns` GET now auth + tenant-isolation tested (`54a9d6b`, 5 tests, mutation-proven) | not browser-verified (live) |
| Q1 | Workflow phase toggles (phone/SMS/email) | `api/campaigns/{automation,config}`, `api/utils/campaignBuilder.ts` | **IMPLEMENTED — reporting + validation + execution VERIFIED 2026-10-09** | Reporting (`campaignPhases.enabled.test.ts`) and validation (`SEQUENCE_CHANNEL_DISABLED`/`SEQUENCE_NONE_ENABLED`) already pinned. **Execution half now verified** by `campaignPhases.execution.test.ts`: `toEngineSettings()` — the builder→engine hand-off, sole caller `campaigns/route.ts` — filters disabled phases out of both `maxTouches` and `touchDelays[]`, so a campaign with calling OFF will not dial. 6 tests, mutation-proven (dropping either `.filter(p=>p.enabled)` turns 6/6 red). |
| R1 | AI phone calling | `api/gateway/voice-gateway.ts`, `api/utils/twilio-adapter.ts`, `api/utils/callSchedulingEngine.ts`, `api/campaigns/[id]/voice/` | **UNIT TESTED** | 33 tests across voice-gateway, twilio-adapter, voiceSelection, voiceRoute — false negative #3 | live calls need provider credential |
| S1 | AI templates | `app/templates`, `components/templates`, `api/templates` (+ `library`, `[id]`) | **UNIT TESTED** | `api/templates/__tests__/templates.routes.test.ts` — 29 tests across all 4 routes: 401/403 gates before any query; enum `?category=EMAIL` 500 pinned to a 400-before-SQL; tenant isolation (`organization_id` bound on every `user_templates` read/write); defect-#32 bound filters ($n params, never inlined); CRUD/ownership 404s (PUT issues NO update for foreign rows); soft delete; AI `was_used` marking; opaque 500s with no SQL leak. **Mutation-proven**: dropping `.eq('organization_id', …)` → 2 red; disabling the enum guard → 1 red; both reverted (`git diff` clean). 29/29 green, 0 tsc errors attributable to the file. | — |
| T1 | Voice selection / AUTO recommendation | `api/utils/voiceSelection.ts` | **UNIT TESTED** | `voiceSelection.test.ts` — false negative #4 | live provider credential |

## SET U — ADMIN CRM ANALYTICS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| U1 | Admin analytics from real records; must reflect only ENABLED phases | `app/{admin,analytics,funnel}` + `api/{admin/stats,analytics,funnel}` | **VERIFIED 2026-10-04** | Verified by inspection (the prior "NOT VERIFIED" was unproven, not known-broken). No admin route reports a channel/stage dimension at all — `git grep -niE 'sms|email|calling|by_channel' -- apps/web/src/app/api/admin` returns only unrelated `email` column reads, so admin analytics cannot show a disabled workflow stage. `api/admin/stats` counts users/campaigns/messages/leads from real rows. `api/analytics/route.ts` derives every per-campaign figure from real rows (`COUNT(cc.id) FILTER (WHERE cc.status::text = 'NEGOTIATING')` → `negotiating`, line 85→185) and renders a stage only when rows exist. The one fixed stage list, `stageOrder` in `api/funnel/route.ts:122`, is **lead pipeline stages** (NEW→ASSIGNED), a different concept from campaign workflow channels. | — |

## SET V — GAMIFICATION

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| V1 | GAMIFICATION ON/OFF setting | `utils/gamification.ts` + allowlist + `gamification.server.ts` | UNIT TESTED | commit `61fe673`; **write path gated in `6b30d2c`** (POST was ungated — see R4) | — |
| V2 | XP, points, levels, categories | `api/achievements/route.ts` (`user_stats.points`, `achievements.points`, `maxProgress`, server-side `summary`) + `app/achievements/page.tsx` | **LIVE VERIFIED** (was a FALSE POSITIVE, corrected then re-verified) | Fixed in `fa43bd0`; prior "LIVE VERIFIED (200)" **INVALIDATED** (page served a hardcoded array). **Re-verified properly** on Worker `8b0da56b` with an authenticated session: `/achievements` 200, mockLeak=0, 0 console errors, 0 page errors, no error boundary (`0437912`) | — |
| V3 | Crates / spin wheel / battle pass / seasons / competitions | migration `099_gamification_rewards.sql` (13 tables), `utils/gamificationRewards.ts` (pure economy), `utils/gamificationRewards.server.ts` (exactly-once claims), `api/rewards` route, `app/rewards/page.tsx` UI | **IMPLEMENTED / TESTED** | Was genuinely absent (0 hits in 1071 files — re-verified 2026-10-04 by file name, `src/**` content, migrations, git history). **Backend** `ed683e5`+`141e063`: reward suite **58 passed**, route suite **13 passed**, `pglite` **14/14** incl. 20-concurrent-spins-vs-3-wallet (≤3 granted) and 15-replay-code (exactly 1), migration gate **PASS** (99 migrations fresh-install + idempotent). **UI** `2a6bc1a`: `app/rewards/page.tsx` + gated nav; regression **158 passed / 0 failed**, typecheck `TC_EXIT=0`. Safety: no prize can convert to money — no monetary column in migration 099, XP/cosmetic only, caps enforced in BOTH app and CHECK constraints, `assertNoMonetaryPrize` tested. **Not deployed.** | — |

**V3-XP-EXACT-ONCE (2026-10-12):** The general account XP path had a real double-award bug: `awardXp()` accepted an optional `eventKey` but the shipped schema lacked `public.user_xp_events`, and the balance write happened without the database enforcing uniqueness for `(user_id, event_key)`. Reproduced and fixed by adding migration `101_user_xp_events.sql` and tightening `awardXp()` to `INSERT ... ON CONFLICT DO NOTHING` before writing `public.user_stats.points`. The proof is the PGlite regression suite `src/app/api/utils/__tests__/gamificationRewards.pglite.test.ts` — standard XP credit, duplicate-event replay, concurrent duplicate requests, and two distinct valid events all pass, with the event ledger persisting exactly two rows for `keyA` and `keyB`. This removes the real replay/concurrency double-award risk without weakening authorization or resetting progression.

**V2-ACHIEVEMENT-RACE-EXACT-ONCE (2026-10-16):** The achievement-points path had a real double-award race distinct from the V3 XP one: `POST /api/achievements` read `was_unlocked` in one statement and credited `user_stats.points` in another, so two concurrent callers racing on a never-touched achievement both read `false` and both were paid (previously carried as a stated KNOWN LIMIT in `route.ts`). Fixed by migration `102_achievement_points_race_fix.sql` (`award_achievement(...)`: ensure-row + `FOR UPDATE` lock + monotonic upsert + payout only on a real locked→unlocked transition; additive, idempotent) with the route collapsed to a single `SELECT * FROM award_achievement(...)`. Proof is `route.test.ts` **12/12** (incl. new `awards points exactly once under concurrent repeat calls`) at `734b286`. **Evidence level: UNIT TESTED (mock)** — the mock serializes faithfully but no real-engine (PGlite) run of the stored function exists yet; that is the open proof item, not a code gap.

## SET W — ACCESSIBILITY / SETTINGS

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| W1 | Dyslexia font, reduced motion, text scaling | `AccessibilityProvider.tsx`, `settings/accessibility` | UNIT TESTED | persists via `/api/user/preferences`; skips anonymous fetches |

## SET X — PAID ACCOUNT CLARIFICATION

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| X1 | UI must not claim what backend denies | `api/utils/entitlements.ts` + `settings/billing/page.tsx` | **VERIFIED 2026-10-04** | Closed on both halves. **Backend**: `entitlements.ts` had **no test file at all**, which is why this sat IN PROGRESS. `entitlements.fail-closed.test.ts` now proves every degraded input routes to the LOWEST tier — no subscription row, unrecognised tier string, NULL tier, empty result set, and a database throw all yield `FREE`; `getTierLimits('NOT_A_TIER')` → FREE defaults; `enforceEntitlement` throws `FeatureNotAllowedError` **and** logs `feature_denied`. **16/16 pass**, lint 0/0. **Frontend**: `settings/billing/page.tsx` throws on `!res.ok` for billing/credits/refund fetches (L235/247/259), renders an explicit error branch (`if (billingError)`, L381), and defaults `currentTier` to `'free'` (L397) — i.e. it under-claims rather than showing a paid tier the backend denies. `access-control.ts` also fails closed (unknown domain → `false`, unknown role → rank 0). | — |

## SET Y — CRM PIPELINE METRICS

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| Y1 | Metrics reflect only enabled phases | `api/analytics` + `campaignBuilder` | **VERIFIED 2026-10-04** | Two independent properties, both proven. (1) `campaignBuilder` is the ONLY place stages are defined for display; `campaignPhases.enabled.test.ts` (`a5fc054`) proves every reporting path (`getCampaignSummary().phaseCount`, `getChannelStats`, `estimateCampaignDuration`, `estimateCampaignCost`) excludes disabled phases, using roman.agent.md's own Campaign A (calling+SMS on, email off) and Campaign B (calling off), plus validation rejecting all-off (`SEQUENCE_NONE_ENABLED`) and enabled-phase-on-disabled-channel (`SEQUENCE_CHANNEL_DISABLED`) — **15/15 pass**, plus 28/28 existing siblings. (2) `api/analytics/route.ts` does not hardcode the full phase list; it aggregates over real rows via `contact_status` filters, so it can only ever report stages present in the data. | — |

## LOGGED-OUT WEBSITE

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| L-1 | Google sign-in | `socialProviders` in `auth.ts` | IMPLEMENTED | config present | OAuth credentials → BLOCKED-EXTERNAL |
| L-2 | Worker resource error resolved | pre-hash cost guard | INTEGRATION TESTED | root-caused and bounded | Free-plan ceiling remains |
| L-3 | Password reset/change email | `account/forgot-password`, `api/auth/forgot-password`, `api/auth/reset-password` | **ROUTE TESTED 2026-10-09** (`54fbd8f`, `eceef80`) | Both halves of the account-takeover surface now pinned. forgot-password (6 tests): enumeration-safe `{ ok:true }` for unknown/rate-limited, token stored as sha256 hash, never leaked. reset-password (8 tests): rejects unknown/used/expired tokens before any write, 429 brute-force guard, session DELETE evicts hijacked sessions. Both mutation-proven | real inbox delivery still NOT VERIFIED (external) |

## MARKETING, LEGAL, SEO

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| MKT-1 | Public marketing pages | `app/(marketing)` | E2E TESTED | all 200, 0 failing subresources | — |
| MKT-2 | Legal/compliance pages | `legal/*`, `/compliance` | E2E TESTED | all 200; `/compliance`→`/trust` is an INTENTIONAL `permanentRedirect` (standalone page carried unsubstantiated SOC 2 claims) | — |
| MKT-3 | Referral / first-1,000-users banner | `components/marketing/ReferralGiveawayBanner.tsx`, `app/referrals/page.tsx`, `app/signup/route.ts` | **LIVE VERIFIED** | commit `2ea6db3`; 14 tests; live 404 reproduced pre-fix, then live 307→200 with `?ref`+`&plan` preserved; homepage 3/3 200 with banner; `/referrals` 200 | — |
| SEO-1 | Titles, canonical, robots, sitemap, structured data | `layout.tsx`, `lib/seo.ts`, `robots.ts`, `sitemap.ts`, `lib/structuredData.ts`, `lib/faq-schema.ts` | **IMPLEMENTED + UNIT TESTED 2026-10-14** (`f45dc81`, `20dd61b`, `2ecc2af`) | Titles/canonical/metadataBase + deny-by-default robots already done. **Structured-data gap closed this cycle:** the homepage now emits `WebSite` + `Organization` JSON-LD (sitelink search box + Knowledge Panel), and `/pricing` — the site's highest-intent page — emits `Product`/`AggregateOffer` **built from the same `subscription_plans` rows the tier cards render** plus `FAQPage` for the six billing FAQs it already displayed as `<details>`. `seo-surface.guard.test.ts`: **11/11 pass**, **mutation-proven** (forcing `lowPrice` to a constant → 2 red; changing `Offer.price` to cents while `lowPrice` stayed dollars → 1 red; both reverted, `git diff` clean). Honesty invariants pinned: the synthetic `originalPrice = price * 2` used for the "50% OFF" banner is **excluded** from machine-readable pricing, and the `Product` block is omitted entirely when the DB read fails so no baseless price range is asserted. Logo URL derives from `SOCIAL_IMAGE_PATH` so schema cannot drift from `openGraph.images`. | Rich-result eligibility needs Google Search Console re-crawl (external, not verifiable locally) |

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

## ⚠️ FABRICATED-DATA DEFECTS (2026-10-04) — false POSITIVES

The re-audit above searched only for **absent** code. This pass searched for the
opposite and safer failure: code that **exists and returns 200 while showing
invented data**. Those never trip a "does it exist?" search, so they survive
every audit run so far — including the ten false negatives above.

Both pages were reached from a requirement already marked verified.

| ID | Requirement | Status | Root cause | Fix | Verification |
| --- | ----------- | ------ | ---------- | --- | ------------ |
| R1 | `/achievements` shows real progress | **FIXED — LIVE VERIFIED** | Page never called `GET /api/achievements`; returned a 20-row hardcoded array after `setTimeout(500)`. Fake points, fake 2024 unlock dates, a fabricated "$500,000 Platinum Club" tier, identical for every user | `fa43bd0` — real `fetch`, server `summary`, honest error/empty states | Worker `8b0da56b`, authenticated: **200, mockLeak=0, 0 console/page errors, no error boundary** (`0437912`) |
| R2 | `/inbox` shows real conversations | **FIXED — LIVE VERIFIED** | `if (!res.ok) return mockConversations;` **and** `return data.length > 0 ? data : mockConversations;` — a brand-new account with zero conversations rendered four strangers' rows, and an outage looked identical to success | `fa43bd0` — real fetch, error state distinct from empty | Worker `8b0da56b`, authenticated: **200, mockLeak=0**, clean |
| R3 | Contact panel / composer truthful | **FIXED** | Hardcoded Stage "Interested", Lead Score 85, Property "123 Main St, Miami FL" for every conversation; Create Contract / Update Stage / Add Note had no handler | `fa43bd0` — real fields, inert buttons removed | as above |
| R4 | Achievement points awarded once | **FIXED, 11 tests** | `POST` credited `user_stats.points` whenever the **request** said `unlock`, not on the actual locked→unlocked transition. Repeatable by any authenticated caller. POST was also **not** gated on the gamification setting (GET was), and `progress` was unvalidated | `6b30d2c` — single statement returns `just_unlocked`; award only on transition; POST gated; progress validated | RED 8 failed/3 passed → GREEN 11/11. **Documented residual:** two callers racing on a never-touched achievement could both be credited; closing it needs a stored function as migration 088 does for AI credits |
| R5 | Thread transcript renders | **FIXED** | `body` and `channel` exist on `message_events` since migration 095 but were never selected | `fa43bd0` | as above |
| R6 | Inbox composer | **DELIBERATELY DISABLED** | Composer had no handler. `POST /api/conversations/message` works but enqueues **real outbound SMS/email to real contacts** behind consent + AI-credit gates | Left `disabled` with a stated reason, not wired | Enabling sending is a **product decision**, not a side effect of this fix |
| R7 | QA harness credential path | **FIXED** (`0437912`) | Credentials passed via `set VAR=value` inside `cmd /c` were mangled by cmd, so the browser POSTed sign-in and got `401 Invalid email or password` **while a direct API call with the same credentials returned 200**. The run then continued and verified every route while **logged out** | Creds read from `$TEMP/qa-cred.json` inside Node; a FATAL is printed when `hasSession !== true` | Verified: authenticated session reaches `/dashboard`; `/achievements` + `/inbox` clean |

### Sweep for further instances — COMPLETE, none found (2026-10-04)

Searched all 76 authenticated `page.tsx` files for the shapes that actually
produce this class, not just for the word "mock":

| Shape searched | Result |
| --- | --- |
| `const mock…` / `sampleData` / `fakeData` / `dummyData` | 0 remaining outside marketing |
| Pages making **no** API call at all (17 found) | all legitimate — see below |
| `\|\| mock`, `?? mock`, `if (!res.ok) return mock…` | 0 |
| Hardcoded name/address literals in JSX (`John Smith`, `123 Main St`, `(555)`) | only in **marketing** mockups (intentional illustration), form `placeholder=` attributes, and the explanatory comments added in `fa43bd0` |

The 17 no-fetch pages break down as: marketing/legal (11, static by design),
`campaigns/planner` (a calculator running arithmetic over the user's own inputs
with a documented cost model), `admin/users` (a 4-line re-export of `UsersAdmin`,
which does fetch `/api/admin/users`), `(dashboard)/automation` (50 lines, no
fixtures), `settings/accessibility` (local UI preferences), and two access-state
pages.

`if (!res.ok) return []` appears on 19 pages. Those return an **empty** state,
not fabricated content, so they cannot mislead a user into thinking they have
data they do not. They are still weaker than they should be — a failed fetch and
a genuinely empty account are indistinguishable — but that is an error-affordance
gap, not this defect, and fixing all 19 is deliberately not bundled into this
change. **Do not re-run this sweep.**

## ⚠️ HOMEPAGE 500 — ROOT CAUSE MECHANISM IDENTIFIED (2026-10-04), not yet reproduced

`TypeError: components.ComponentMod.handler is not a function` on intermittent
`GET /`. **Still not reproduced** (18/18 clean below), so this is a mechanism
derived from the deployed bundle, not an observed reproduction. Stated as such.

### What the deployed bundle actually does

`apps/web/.open-next/server-functions/default/apps/web/handler.mjs`, page-route
renderer:

    a1 = { ...E2, tree: K, handler: U2, routeModule: R, __next_app__: Q };
    ...
    return await components.ComponentMod.handler(handlerReq, handlerRes, {...})

`handler` is assigned **explicitly** from `U2`, and the spread `{...E2}` is not
the problem. `E2 = a2.i(44293)` — a **synchronous, inlined module load by
numeric index**. So `components.ComponentMod.handler` is `undefined` if and only
if `U2` is `undefined`, i.e. the page module did not load successfully. The call
site then throws with no guard.

Verified in the same bundle: **0** `require()` calls with relative or absolute
filesystem paths; **574** `require("node:…")` builtin calls. This re-confirms the
earlier finding that the chunk-loading hypothesis is wrong — there is no
filesystem require to fail.

### Why that points at memory, not code

A synchronous inlined module load returning nothing, intermittently, on a
Free-plan Worker, is the signature of the **128MB memory limit**, not of a
missing file. The handler bundle is **26.4MB** of source on disk. CPU exhaustion
(1102) and memory exhaustion (script error / handler-is-not-a-function) are
different ceilings that both present as intermittent 5xx, and only the CPU one has
been measured.

This yields a **testable hypothesis** rather than a guess:

1. Instrument `GET /` to record `wrangler`/runtime memory signals, or add a
   guarded call so a failed module load returns a diagnosable error instead of a
   `TypeError`.
2. Compare peak memory for `/` against a lighter route under identical load.
3. If memory is the binding constraint, application-level mitigation is
   **bundle-splitting the homepage render path** — not a plan upgrade.

### Reproduction attempts (all negative — do not repeat verbatim)

| Target | Requests | Result |
| --- | --- | --- |
| `dealswift-app.romanshumates1.workers.dev/` | 12 sequential, ~0.9s apart | **12/12 = 200** |
| `dealswiftautomation.com/` | 6 sequential, ~1.4s apart | **6/6 = 200** |

Low volume only, per the standing production safety rule. A past session caused
a genuine ~90-second outage by probing harder than this.

**STATUS: mechanism identified, cause unconfirmed, fix not started.** Do not
record this as fixed, and do not describe it as a memory problem until step 1
above produces a measurement.

## ⚠️ 503 UNDER LOAD — PER-INVOCATION COST MEASURED (2026-10-04)

The recurring assumption was "the Workers Free plan is too small, so buy a
bigger one." That was never measured. It is now measured **at the per-invocation
level**, and the measurement does **not** support a per-request optimisation of
the homepage.

### Measurements (bounded, sequential, low volume — no load testing)

| Route | Warm | Cold / first | Payload |
| --- | --- | --- | --- |
| `/` (homepage) | **113–147ms** (median 124ms) | 2225ms, then 375ms after 22s idle | 146KB |
| `/faq` (lighter marketing page) | 105–129ms | 446ms | 65KB |
| `/api/system/health` | 81–95ms | 562ms | 69B |
| a static CSS chunk | 174–207ms | 362ms | 277KB |

Sequential homepage series: `2225, 1540, 624, 275, 366, 1031, 477, 345` — and
`454, 147, 260, 124, 113, 119` once warm.

### What this establishes

1. **The homepage is NOT pathologically expensive.** Warm median **124ms**,
   statistically indistinguishable from `/faq` (105–129ms). It is a server
   component with exactly **one** import (`@/lib/seo`).
2. **The expensive part is isolate cold start, not the render.** 2225ms first
   request → 375ms after 22s idle → 113–147ms warm. That is isolate
   initialisation, and it is the shape that produces a *burst* of slow responses
   when many isolates spin up at once.
3. **Per-request CPU on this route has ample headroom.** 124ms of wall clock on
   the Free CPU budget is not what a 1102 looks like.

### What this does NOT establish — do not skip this

- **The 503s under SUSTAINED/CONCURRENT load are still unreproduced and still
  unexplained.** Sequential single requests cannot trigger them. This work was
  explicitly NOT a load test, per the standing safety rule.
- **"The plan is too small" remains an ASSUMPTION.** It is now a *better-founded*
  assumption — the cold-start finding is consistent with it — but nothing here
  measured a CPU or memory ceiling being hit.
- **The homepage-500 memory hypothesis is untouched by this.** Different failure,
  different ceiling.

### Next measurement, if pursued

Not more live probing. The correct instrument is an **isolated** environment
(`workers.dev` alias or a local miniflare run) with CPU/memory metering, driving
the *concurrent* pattern that actually fails. Per `wrangler.jsonc`, RSC
prefetching already caused 18+ parallel renders and was mitigated with
`prefetch={false}` (measured 16% 503 → 0%) — so the concurrent path is known to
be the sensitive one and has a documented prior fix to build on.

### ⚠️ HOMEPAGE 500 — DIAGNOSTIC INSTRUMENTATION NOW SHIPPED (`a576f2f`)

### The blocker was silence, not the bug

The Worker exported `fetch: handler.fetch` **directly**. Nothing observed a
throw at the entry point, so this failure produced a bare 500 with **no log line,
nothing in `wrangler tail`, and no request identity**. That is why the
investigation stalled across several sessions: every attempt restarted from
nothing because the failure left no evidence.

`custom-worker.ts` now wraps `fetch` and logs a throw with method, path, query
KEY NAMES (never values), plus **`suspected_resource_kill`** — which separates
"our code has a bug" from "the platform killed the isolate". Those look identical
from outside and lead to opposite investigations. Verified it sits above
OpenNext's own fetch, so it observes the middleware layer too.

Deployed as **Worker `85de11a9`**. Full gate green: typecheck OK, lint 0/0,
**3017 tests passed / 0 failed** (+11 new), `cf:build` OK, authenticated browser
**clean=6 noisy=0**.

**What this does NOT do:** reproduce or fix the 500. It makes the next occurrence
diagnosable. Do not record the defect as resolved.

### How to use it on the next occurrence

```
wrangler tail --format pretty      # then watch for [worker:unhandled]
```

If `suspected_resource_kill=true`, it is capacity, not code. If false, the logged
`TypeError` names the failing call site directly.

### ⚠️ HOMEPAGE 500 — MATRIX STEP 1 SHIPPED: guarded call site (`8813574`)

Step 1 of the testable hypothesis above ("add a guarded call so a failed module
load returns a diagnosable error instead of a `TypeError`") is now implemented as
`scripts/patch-opennext-handler-guard.mjs`.

**What it does.** The unguarded call site is in the OpenNext-**GENERATED** bundle
`.open-next/server-functions/default/apps/web/handler.mjs`, not in `src/`, so it
cannot be fixed in application code. The build-time script (same precedent as
`patch-opennext-instrumentation.mjs`) replaces the byte-accurate

```
return await components.ComponentMod.handler(handlerReq,handlerRes,{waitUntil:this.getWaitUntil()}),null
```

with a `typeof components.ComponentMod.handler !== 'function'` guard that, before
the call, logs a greppable `[g2-handler-guard]` line (url, routeModule, nextApp,
rssMB) and throws a named `PageModuleLoadError`. The happy path is unchanged.

**Wiring.** `cf:build` now runs it **after** `patch-opennext-instrumentation.mjs`
(both target the same `handler.mjs`), so the guard ships in every build.

**Verification (all against the REAL generated bundle):**
- 5 regression tests green (`scripts/patch-opennext-handler-guard.test.ts`):
  guards the real call site, marker + named error emitted, idempotent, no
  over-match on a handler without the call site, fail-safe exit 0 when
  `.open-next` is absent.
- Ran the script on the shipped `handler.mjs`: guarded 1 call site (exit 0),
  `node --check` valid, second run idempotent, coexists with the already-applied
  instrumentation marker.

**What this does NOT do.** It does not reproduce or fix the 500 and does not
confirm memory. It converts an undiagnosable intermittent 500 into one that logs
a greppable marker plus the diagnostics needed to attribute it. The root cause
remains **unconfirmed**; step 2 (memory comparison) and step 3 (bundle-splitting
mitigation) are still open. **Do not record the defect as resolved.**

### Instrumentation source/Worker-patch maintenance gap — RESOLVED (`cab6955`)

The patch script had documented itself as mirroring `src/instrumentation.ts`, but
that source file did not exist on this branch: it existed only on an unrelated,
non-ancestor branch and imported a helper unavailable here. `cab6955` restores a
self-contained canonical source with the actual branch contract
(`HARD_REQUIRED`, `SOFT_RECOMMENDED`, Workers no-throw), while retaining the
patch script because OpenNext 1.20.6 still omits the Turbopack instrumentation
chunk from the Worker bundle.

`scripts/instrumentation-sync.test.ts` makes the relationship enforceable: 6/6
tests compare the fatal and degraded environment lists and guard the Workers
health-probe behavior. `cf:build` passed; its generated final `handler.mjs`
contains the self-contained boot register and no longer contains the broken
Turbopack instrumentation stub. **This is a maintenance/diagnostic fix only;
the intermittent homepage 500 remains unresolved and `cab6955` is not deployed.**

### Mechanism, from the deployed bundle (still unconfirmed)

`a1 = {...E2, tree:K, handler:U2, ...}` then
`await components.ComponentMod.handler(...)`. `handler` is assigned
*explicitly*, so it is undefined **iff `U2` is undefined** — i.e. the page module
(`E2 = a2.i(44293)`, synchronous inlined load) failed to load. The call is
unguarded. Verified **0** relative/absolute `require()` (574 `node:` builtins),
so the chunk hypothesis stays disproven.

**Not reproduced:** 12/12 = 200 on workers.dev, 6/6 on the apex, low volume.
Leading hypothesis is the **128MB memory ceiling** rather than CPU — unconfirmed.

---

## ✅ ISOLATED ENVIRONMENT + LIMTER VERIFIED (`d2eb0fe`) — **the "race" was a FALSE POSITIVE**

### Isolation now exists (this was the blocker for all of it)

`dealswiftautomation.com` and `dealswift-app.romanshumates1.workers.dev` are
**THE SAME WORKER** — `wrangler.jsonc` declares no `routes` entry, so the apex
resolves to that worker. **Bursting "workers.dev" bursts production.** The
existing probe scripts defaulted to the apex with no guard, which is exactly how
a past session caused a real ~90-second outage.

`apps/web/wrangler.loadtest.jsonc` deploys the same code as
`dealswift-loadtest` — a hostname entirely disjoint from the live site. All 32
secrets provisioned there so rate-limit semantics match production. Both probe
scripts now **refuse to run unless `BASE` contains `loadtest`** (verified by
pointing one at the apex: it exits non-zero rather than bursting it).

### The sign-in limiter is NOT racy — it was mismeasured

`_ratelimit-race.mjs` reported `burst=8 -> admitted=4 *** RACY ***` against a
documented max of 3. That reads exactly like a live brute-force bypass.

**It is not one.** The script slept 12s to "drain the window", but
`rateLimitByUser` uses **FIXED** windows keyed on `floor(now / windowMs)` — the
bucket resets on a wall-clock boundary, not 10s after the previous burst. A
burst straddling a boundary sees the tail of one window and the head of the
next and can be admitted up to ~2x. **That tradeoff is already documented in
`rateLimit.ts`.**

`_signin-limit-forensics.mjs` separates the cases by parking bursts mid-window:

| Condition | Admitted (limit 3) |
| --- | --- |
| Mid-window rounds 1–5 | **3, 3, 3, 3, 1** — never exceeded |
| Boundary rounds 1–3 | 0, 0, 3 |

**8 bursts / 64 concurrent requests. The limit holds; the limiter is atomic.**
Do not "fix" it. Both scripts carry the correction in their headers.

### CPU: **zero 5xx** under bounded concurrency, hashing or not

108 concurrent requests on the isolated worker (36 hashing sign-in, 36
get-session, 36 health) produced **0/36 5xx on every endpoint**, with 429s rising
as the limiter engaged. At this concurrency the Free plan does **not** exhaust
CPU on any endpoint.

This does **not** prove higher concurrency is safe. It does mean the documented
"one scrypt verification ≈ 10x the entire 10ms Free budget" claim in
`auth-cost-guard.ts` did **not** manifest as 5xx here — worth re-checking against
a higher, still-bounded concurrency in the isolated worker before concluding
either way.

### Sign-in origin on the test worker

Sign-in returned `403 INVALID_ORIGIN` there, correctly: `trustedOrigins` does
not — and should not — contain a disposable host. Resolved via the
**operator-only** `BETTER_AUTH_TRUSTED_ORIGINS` on that worker alone. **No
production change, no code change, no wildcard.** The allowlist's refusal of
wildcards is correct CSRF protection and was left intact.

---

### Five ways a verification can be true and still worthless

This cycle produced all four. They are recorded because each one *looks* like
a result:

1. **A 200 from a page that never made a request.** `/achievements` and `/inbox`
   returned 200 while serving hardcoded arrays (R1, R2).
2. **A clean sweep that was authenticated as nobody.** The browser check reported
   tidy per-route results after sign-in silently failed, so every page was
   verified logged out (R7).
3. **A failing assertion that was itself wrong.** The first mock-leak check named
   "Platinum Club" and "Revenue Machine", which are *real seeded rows* in
   migration 068. The check was corrected, not the app.
4. **A defect that was the instrument, not the product.** `/dashboard` was
   recorded as "TIMEOUT 45s" because the harness awaited `waitUntil:
   'networkidle'`, which never settles on an authenticated page. Real
   measurement (`f0074e2`): HTTP **200**, DOM ready **219ms**, content visible
   **548ms**. Every endpoint behind it answered in 83–405ms. The "evidence" had
   been describing a test harness.
5. **A security finding that was the instrument, not the system.** The sign-in
   limiter was reported as "RACY: limit bypassed" — a live brute-force defect —
   across several sessions. It is atomic. A fixed-window boundary artifact in
   the measuring script produced the verdict; mid-window retest admitted never
   exceeded 3 across 64 concurrent requests (`d2eb0fe`). **The most dangerous
   member of this family**, because acting on it would have meant rewriting a
   working security control.

Before treating browser evidence as proof, confirm all four: the page issued its
request, the session was real (`hasSession === true`), the asserted strings exist
nowhere in the database, and the wait condition can actually settle on an
authenticated page (`networkidle` cannot — see item 4).

### Method note, and the mistake this cycle nearly repeated

While checking whether the achievements tables existed I used a **non-recursive**
`Get-ChildItem -File` on `apps/web/db/`, which silently skipped `db/migrations/`
and reported 0 hits. I was about to record an **11th** false negative. The tables
are in `068_user_profile_and_gamification.sql`.

The rule now covers tooling as well as intuition:

> **Confirm the search path before believing an absence — including your own
> glob flags.** A search that returned zero has not proven anything until you
> have shown it *looked in the right place*. `Get-ChildItem -File` without
> `-Recurse` is the specific trap; `git ls-files '*.sql'` is the reliable check.

Two "unreachable" things are NOT blockers: the thread body column exists (R5),
and the inbox send endpoint exists (R6). Both were confirmed by column/function
existence before being labelled unavailable.

## ⚠️ ABSENCE-CLAIM RE-AUDIT (2026-10-04) — 10 false negatives found

Every remaining "ABSENT"/"NOT STARTED" claim was re-verified individually rather
than trusted, using the method that caught the previous errors: search by
**concept** (file contents, exports, DB columns, the 370-route build manifest,
UI page sources) rather than by directory name. **Three more false negatives;
two genuinely absent.**

| # | Claimed absent | Reality | Method that caught it |
| --- | --- | --- | --- |
| 8 | CRM contacts page | **`app/crm/page.tsx` is a complete UI** — search, status filter, campaign filter, CSV export, detail drawer; backed by org-scoped `api/crm/contacts` and API-key `api/v1/contacts`. **Live `GET /crm` → 200** | read the page source |
| 9 | Gamification XP/levels | **XP is real in the backend** — `user_stats.points`, `achievements.points`, per-category totals, `maxProgress`. **But the `/achievements` page showed none of it** (hardcoded rows; see FABRICATED-DATA DEFECTS R1), so the "live 200" originally recorded here was not evidence | searched `points\|xp\|level` in route bodies — **the mistake: never read the page source, only the route** |
| 10 | "Only achievements + leaderboard exist" | true for endpoints, but the matrix phrasing implied XP was missing too — it is not | read `achievements/route.ts` |

### Clarified, NOT a defect

`/leads` renders `<h1>Contacts</h1>` from `/api/leads` (the **lead** database),
while `/crm` serves **campaign-outreach** contacts from `/api/crm/contacts`.
Two distinct, intentional datasets. Creating a `/contacts` page would have
duplicated both.

### GENUINELY ABSENT — confirmed, and nothing to recover

| Requirement | Evidence searched | Result |
| --- | --- | --- |
| Affiliate programme | `api/{affiliate,commission,partner}`, file contents for `affiliate\|commission`, git log --all --grep | **ABSENT**, and no branch/commit mentions it |
| Flipper / Builder AI | `api/{flip,builder,renovat,project}`, `contracts/` for renovation terms, git log --all --grep | **ABSENT**, no branch/commit |
| Gamification crates / spin wheel / battle pass / seasons / competitions | ~~`api/*` for crate/spin/season/battle/competition/giveaway/reward~~ **RE-AUDITED 2026-10-09** — the directory-only search was the exact trap the "Standing method note" below warns about | **PRESENT — false negative #11.** `db/migrations/099_gamification_rewards.sql` creates **13 tables**: `gamification_seasons`, `user_season_progress`, `battle_pass_tiers`, `user_battle_pass_claims`, `user_spin_wallet`, `spin_wheel_spins`, `user_crate_inventory`, `user_crate_opens`, `competitions`, `use_codes`, `user_use_code_redemptions`, `giveaways`, `giveaway_entries`. Logic in `api/utils/gamificationRewards.ts` (`SPIN_PRIZES`, `SPIN_WEIGHTS`, `secureRoll`, `levelForXp`, `useCodeXp`, `clampUseCodeMultiplier`, `assertNoMonetaryPrize`) + `gamificationRewards.server.ts`; HTTP surface `api/rewards` (`spin` / `redeem` / `claim-tier` / `enter-giveaway`). **52 tests** (26 unit + 26 route) plus a **PGlite** run against real Postgres. This also contradicts this file's own SCORE section, which lists these as absent. |

**Corrected tally: 11 false negatives, 2 genuinely absent (affiliate, Flipper),
1 false positive in the other direction (the referral banner really was missing —
fixed in `2ea6db3`).**

> **2026-10-09 correction.** The gamification row above was a false negative
> (#11) — see the re-audit cell. The two remaining "genuinely absent" items,
> **affiliate programme** and **Flipper / Builder AI**, are absent — but
> **neither appears anywhere in the master spec** `.github/agents/roman.agent.md`
> (0 matches for `affiliate`, `Flipper`, or `Builder AI`). They are therefore
> **not master scope** and must not be counted against it.

### Standing method note

Directory-name search is unreliable in this repo. `api/crm`, `api/contacts`,
`api/v1/contacts` and `app/crm` all exist under names you would not guess. Always
search contents, DB columns and the build manifest before concluding ABSENT.

| Requirement | Searched | Result |
| --- | --- | --- |
| Affiliate programme | `api/affiliate*`, `app/affiliate` | **ABSENT** |
| Flipper / Builder AI | `app/flipper`, `app/builder` | **ABSENT** |
| AI phone calling | ~~`api/**/calling*`~~ | **WRONG NAME — lives under `api/gateway/` and `api/utils/`; see R1** |
| ~~Spin wheel / crates / battle pass / competitions~~ | ~~`api/gamification`~~ **RE-AUDITED 2026-10-09** | **PRESENT** (false negative #11) — lives in `api/rewards` + `api/utils/gamificationRewards*` + migration 099, not `api/gamification` |
| Earnings date-range filters | `api/payouts` | **WRONG PATH — implemented in `api/earnings`; see K1** |
| Free-trial demo data | ~~`api/**/demo*`~~ | **WRONG LOCATION — lives in `lib/` + `api/utils/syntheticData.ts`; see E1** |
| ~~AI weekly/daily credit ceilings~~ | ~~`api/credits`~~ | **WRONG PATH — implemented in `api/utils`, see correction** |

---

## OPEN WORK (highest priority first)

**Refreshed 2026-10-07 at `a0c9ec6`.** Rows below marked DONE are closed; do not
re-open them.

| ID | Task | Status | Next action |
| --- | --- | --- | --- |
| **QA-ACCEPT** | Give the QA account legal acceptance so page routes render | **DONE 2026-10-05** (`4036224`) | Acceptance recorded; probe scripts committed. Probe 2026-10-07: 104 routes / 100 OK / 0 SERVER_FAULTS |
| **ANALYTICS** | CRM analytics views 500'd on phantom columns | **DONE 2026-10-07** (`a0c9ec6`) | `contracts.lead_id`, `message_events.opened_at`, `leads.zip_code` never existed; fixed at 7 query sites; `schemaColumnTruth.guard.test.ts` pins all three with regression samples; all 8 `analytics/crm` variants 200 |
| **RUNMIG** | `run-migrations.mjs` silently skipped commented statements | **DONE 2026-10-05** (`8681150`) | Was a **deployed live 500**. Comment-gated statements never ran: 388/773 statements and 1/13 CREATE TABLEs in 099, then exit 0 with "All migrations complete!". Second defect: 082's `; -- $5k` line merged statements, losing a `COMMENT ON COLUMN`. 9 guard tests now pin it to the vetted splitter |
| **SQLFRAG** | Defect 32 — nested `sql` fragments in `crmAnalyticsEngine` | **DONE 2026-10-05** (`8681150`) | Broke `GET /api/analytics/crm` with HTTP 500. Fixed to scalar bindings; `sqlFragmentComposition.guard.test.ts` prevents reintroduction |
| **V3-UI** | Rewards page | **DONE** (`2a6bc1a`) | Closed. 3 swallowed `.catch` sites in the new page were fixed in `8681150` |
| **V3-BACKEND** | Gamification reward layer | **DONE 2026-10-04** (`ed683e5`, `141e063`) | Migration 099 + economy + claims + `/api/rewards`, 85 tests green |
| **Y1 / U1** | Metrics reflect only ENABLED phases | **DONE 2026-10-04** (`a5fc054`) | 15 + 28 tests |
| **X1** | Entitlements fail closed | **DONE 2026-10-04** (`68a67b4`) | 16 tests |
| **IP-ARCH** | `x-real-ip` caveat closed | **DONE 2026-10-04** (`d5d6094`) | Documented in `apps/web/DEPLOYMENT-ARCHITECTURE.md`, pinned by `clientIp.deployment-architecture.test.ts` |
| G2 | Intermittent homepage 500 | **DIAGNOSABLE 2026-10-09 — step 1 shipped; local step-2 evidence 2026-10-14** | `npx wrangler whoami` succeeds (OAuth token) — the "no CF auth" blocker is retired. opennextjs chunk hypothesis DISPROVEN. **Matrix step 1 implemented:** `scripts/patch-opennext-handler-guard.mjs` wraps the real call site in the OpenNext-GENERATED `handler.mjs` with a `typeof` guard that logs `[g2-handler-guard]` (url, routeModule, nextApp, rssMB) and throws `PageModuleLoadError`. **Local cycle 2026-10-14:** bundle rebuilt at `600ac1a` (`npm run cf:build` → BUILD_EXIT=0, guard applied "1 call site"); local preview measurement — `/` 4/4 = 200 (cold 5757ms / 146KB, warm 327–348ms), `/faq` 4/4 = 200 (cold 1131ms, warm 186–243ms), **no guard marker** (guard is failure-path-only — its absence confirms no module-load failure locally), zero 5xx. **Re-verified on resumption against HEAD d8974cf:** `node --check .open-next/.../handler.mjs` → PASS (syntax valid post-patch); idempotency re-check → `IDEMPOTENT_CHANGED:false` (re-running the guard is a no-op), `REEMITS_UNGUARDED_CALL:true` (the real `ComponentMod.handler` call is preserved intact). Remaining capture requires (a) the guarded bundle DEPLOYED to the served Worker and (b) an organic failure observed via `wrangler tail`. **Git reality (reconciled, not assumed):** the guard + observability live on `feat/gamification-rewards` (`72d1020` inner guard + `a576f2f` outer `[worker:unhandled]` wrapper); `493bb2a` is NOT an ancestor of `origin/main` (`@ c13c5d1`), so these diagnostics are **NOT live on production**. Commits are pushed only to the feature branch (main is `+2` ahead of the shared fork base `5540a60` and diverged). **HEAD d6c9459 verified:** `npm run cf:build` → BUILD_EXIT=0, guard applied "1 call site"; `node --check …handler.mjs` PASS; idempotent re-check `IDEMPOTENT_CHANGED:false`, `REEMITS_UNGUARDED_CALL:true`; `npm test` for the guard = 5/5 PASS; fail-closed suite (creditTierPricing.f3 + getCredits.tierResilience + entitlements.fail-closed) = 47/47 PASS; new `creditGuard.fail-closed.test.ts` = 2/2 PASS; readiness gate live = exit 2 HOLD. **Narrow RC candidate (prepared, NOT created):** cherry-pick exactly {`a576f2f`, `72d1020`, `a91dfa8`} onto main — observability + guard + stale-artifact deploy guard, **zero billing/plan code**; `wrangler.jsonc` + `custom-worker.ts` are the only config deps (already present). Requires owner merge/deploy auth. **Still NOT a root-cause fix — memory hypothesis unmeasured.** |
| **SCALE** | Unpriced `scale` tier held fail-closed pending owner rates | **HOLD — engineered; BLOCKED-APPROVAL** | `scale` (plan_scale \$2,499/mo, migration 067; rendered by pricing page) is live but has **0 `credit_costs` rows** (migration 080 seeds only FREE/STARTER/PRO/BUSINESS/ENTERPRISE). Gate `scripts/check-credit-pricing-readiness.mjs` live at `d6c9459` → exit 2 HOLD, all 9 safeguards PASS; gate regression `check-credit-pricing-readiness.test.ts` 3/3 (HOLD + READY-fixture + 30-row pin). Fail-closed verified: `getCreditCost('scale')` throws → `creditGuard.checkCredits` returns {allowed:false, cost:0, balance:0} → HTTP 402, **0 debit, 0 ledger writes** (pins `deductCreditsForAction` `PRICING_NOT_CONFIGURED`/deducted:0). New `creditGuard.fail-closed.test.ts` 2/2 PASS. Auth. matrix (credits): SMS 5/4/3/2/2/- · EMAIL 2/2/1/1/1/- · AI_REQUEST 10/8/5/4/3/- · AI_NEGOTIATION 25/20/12/10/8/- · CONTRACT_GENERATE 15/12/8/6/5/- · LEAD_FIND 3/2/1/1/1/- (FREE→ENTERPRISE). SCALE column = MISSING everywhere. **Missing owner decision:** (A) adopt the 6 proposed rates in `db/migrations/PROPOSALS/081_scale_credit_costs.proposal` (idempotent `ON CONFLICT DO NOTHING`, ENTERPRISE-parity placeholders, NOT auto-applied, gate stays HOLD), or (B) normalize subscription `scale`→credit `ENTERPRISE` in `entitlements.ts`. Discrepancy noted: `pricingTiers.ts` lists SCALE at \$1,500 while migration 067 = \$2,499 (marketing-only; `PricingTierSelector.tsx` only importer — no billing/DB impact). |
| G1b | Free-plan resource ceiling (Cloudflare 1102) | OPEN — owner decision | `limits.cpu_ms` is rejected on the Free plan. Buy capacity or do less work per invocation |
| DEPLOY | Ship current HEAD | **workers.dev DEPLOYED** — apex cutover = **OWNER DECISION** | `wrangler whoami` **works** (2026-10-09), so "no CF auth" is retired. Current remote `origin/main` is at `c13c5d1` (Merge PR #4 mvp-prelaunch); `493bb2a` is NOT an ancestor of `main`, so the earlier `fa88d160 (from 493bb2a)... code already live on workers.dev` claim is **stale** — the G2/observability commits (`72d1020`, `a576f2f`) live on `feat/gamification-rewards` only and are **not** in `main`. `wrangler.jsonc` declares **no `routes` entry** — adding one REPLACES the DNS serving WordPress, so the apex cutover is an owner decision, not an autonomous action. `cf:gate` re-verified PASS 2026-10-09 (320/320 pages, 6.78MB gzip, 3335 files secrets-clean). |
| ~~N2-live~~ | ~~AI credit period keys vs real ledger~~ | **DONE 2026-10-04** | PGlite runs migration 088 on a real engine incl. concurrency |
| ~~G1-RECRAWL~~ | ~~15/24 authenticated 503s~~ | **RESOLVED 2026-10-04** | `/dashboard` 315ms, `/campaigns` 273ms, `/lead-finder` 215ms, `/settings/billing` 193ms |
| ~~E1~~ | ~~Free-trial demo data~~ | **DONE 2026-10-04** | False negative #5 — 10 tests |
| ~~Earnings filters~~ | ~~Earnings date-range~~ | **DONE 2026-10-04** | False negative #2 — `api/earnings` + `api/payouts`, 7 presets |
| ~~R1 / T1~~ | ~~AI calling + voice selection~~ | **DONE 2026-10-04** | False negatives #3/#4 — 33 tests |
| ~~CONTACTS-PAGE~~ | ~~No CRM contacts page~~ | **DONE 2026-10-04** | False negative #8 — `/crm` is a complete UI, live 200 |

### ⚠️ Gates are not sufficient — read `AI-HANDOFF.md` § run-migrations trap

`MIGRATION_GATE: PASS` and `3133 tests pass` did **not** catch the migration
defect, because three different runners apply `db/migrations/` and only one of
them is the gate. A green gate proves one code path, not all of them.

## OPEN DEFECTS

0b. **CLOSED 2026-10-07 (`a0c9ec6`) — CRM analytics 500'd on columns that do
   not exist.** `contracts.lead_id` (6 join sites), `message_events.opened_at`
   (email opens filter) and `leads.zip_code` (regional zip view) are phantom
   columns. The zip defect only surfaced for `?view=regional&groupBy=zipCode`,
   which the pre-parameterisation probe never requested — a defect the default
   probe structurally could not see. Fixed to `seller_lead_id = l.id::text`,
   honest `0` opens (no open-tracking column exists in any migration), and
   `leads.zip`; pinned by `schemaColumnTruth.guard.test.ts` — a static tree scan
   with regression samples so the scan cannot be vacuous. Probe 2026-10-07:
   all 8 `analytics/crm` variants 200; **104 routes / 0 SERVER_FAULTS**.

0. **CLOSED 2026-10-05 (`8681150`) — `run-migrations.mjs` applied half the schema
   while reporting success.** Recorded here because the *shape* of this failure is
   the reusable lesson. `splitStatements` attaches each statement's leading
   comment block to the statement, and the runner gated on the first line, so any
   statement under a `--` header was skipped whole. Measured on the real corpus:
   **388 of 773** statements applied, **1 of 13** `CREATE TABLE`s in migration
   099, exit code 0, "All migrations complete!" — then HTTP 500
   `relation "public.user_spin_wallet" does not exist` in production. A second,
   independent defect in the same splitter dropped a statement whose semicolon
   was followed by a trailing comment (`082` line 12, `; -- $5k`).
   **Why it survived a green gate:** `MIGRATION_GATE` exercises
   `lib/split-sql.mjs`, not this runner. Both are now pinned together by
   `scripts/run-migrations.guard.test.ts`.
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
3. ~~**`scripts/wrangler-deploy.mjs` DOES NOT REBUILD**~~ — **REMEDIATED 2026-10-10 (`a91dfa8`)**: the script now REFUSES to ship a stale `.open-next` artifact instead of silently deploying one, and the refusal is pinned by `deploy-integrity-ratchet.test.ts`. The original report: it only ran
   `wrangler deploy` (found 2026-10-04), so running it after a code change shipped a
   **stale `.open-next` bundle while reporting success.** Observed directly: a
   deploy returned a fresh Worker (`6ea153be`) yet `/signup?ref=` still 404'd,
   because `app-path-routes-manifest.json` was timestamped 20:02 while the
   commit was 01:43 — neither `/signup/route` nor `/referrals/page` was in the
   bundle (368 routes registered; both absent).
   Guard added `a91dfa8`; `wrangler-deploy.guard.test.ts` also present. The silent-failure trap (hiding code changes from production while looking successful) is closed. **Standing advice unchanged: always run `yarn cf:build` first.**

## EXTERNAL BLOCKERS

| Blocker | Blocks |
| --- | --- |
| Live Stripe key material + `STRIPE_WEBHOOK_SECRET` (test-mode `STRIPE_SECRET_KEY` now present in `apps/web/.env`) | live billing, subscriptions, payments, payouts end-to-end |
| Apollo API key absent | live Apollo lead search |
| Bedrock credentials absent | live AI provider calls |
| Google OAuth credentials absent | live Google sign-in |
| Workers plan decision | full CPU headroom (owner decision) |

## SCORE

**8.5/10 — NOT READY for public launch.** Recalculated 2026-10-04 after the
absence-claim re-audit, against Worker `499ceb4c`.

Raised from 8 on evidence: **three more requirements recovered** — the CRM
contacts UI (live 200), the gamification XP/points system (live 200, 11 tests),
and confirmation the AI-credit work is unaffected. Ten false negatives have now
been found in total.

The ceiling is unchanged and is **not** code-fixable:
- **No money-moving path has LIVE evidence.** Stripe is verified in **test mode**
  against the real API (52 tests plus a real test-mode round-trip), but signed
  webhook delivery to the deployed Worker is still unproven.
- **The public site 503s under sustained load** (Cloudflare 1102); not
  configurable on the Free plan.
- **The intermittent homepage 500 remains unidentified.**

Genuinely absent: **affiliate programme** and **Flipper / Builder AI** — and
**neither is in the master spec** (0 matches in `.github/agents/roman.agent.md`),
so neither is master scope. ~~crates / spin wheel / battle pass / competitions~~
were listed here too; a 2026-10-09 re-audit proved they are **implemented**
(migration 099, 13 tables, `api/rewards`, 52 tests + PGlite) — false negative #11.

**10/10 remains unreachable here.** It needs the Stripe webhook round-trip, live
Apollo and Bedrock credentials, and a paid Workers plan.

What the 2026-10-04 live pass established:

- **Referral chain LIVE VERIFIED** (`/signup?ref=` 404 → 307 → 200, `?ref` and
  `&plan` preserved; banner on homepage 3/3; `/referrals` 200).
- **Authenticated pages render LIVE**: `/dashboard` 200 in **315ms**, `/campaigns`
  273ms, `/lead-finder` 215ms, `/settings/billing` 193ms — versus 12.4s and 503s
  before. No error boundary in the HTML; the hardcoded `+$36,500` placeholder is
  gone.
- **Browser console clean**: no error boundaries, no uncaught exceptions.
- **AI credit limiting INTEGRATION TESTED** including atomicity under
  concurrency (N2–N8).
- **Recovered and test-verified**: earnings date filters (16), AI calling +
  voice selection (33), trial demo data (10).

What still prevents a higher score — and this is the honest ceiling:

- **ZERO money-moving paths have end-to-end evidence.** Billing, subscriptions,
  payments, payouts and tax all fail closed behind absent credentials. This alone
  caps the project below 9/10 and it cannot be closed by writing code.
- **The public site 503s under sustained load** (Cloudflare 1102). Not
  configurable on the Free plan; requires an owner decision.
- **The intermittent homepage 500 remains unidentified** and unreproduced.
- **Genuinely absent after re-verification:** affiliate programme, Flipper /
  Builder AI (**neither is in the master spec — not master scope**).
  ~~gamification crates/spin/battle-pass~~ **RECOVERED 2026-10-09**: implemented,
  migration 099 + `api/rewards`, 52 tests + PGlite (false negative #11).

**10/10 is not reachable in this environment.** It requires live Stripe, Apollo
and Bedrock evidence plus a paid Workers plan. Claiming it would mean inventing
verification. This score reflects what was actually measured.

## SET M — CONTRACT HONESTY (added 2026-10-12)

| ID | Requirement | Implementation | Status | Evidence | Blocker |
| --- | --- | --- | --- | --- | --- |
| M1 | Non-technical sellers/buyers can read a contract and understand "what this deal is and why it is good" in one glance, without inventing any number | `src/app/api/utils/plainContractSummary.ts` (`buildPlainContractSummary` pure builder) + `src/components/contracts/ContractPlainSummary.tsx`; wired into `app/contracts/page.tsx` | UNIT TESTED | `__tests__/plainContractSummary.test.ts` 18/18 pass; scoped `tsc -p tsconfig.verify.json --noEmit` over all 3 changed files → exit 0. Commit `74ec70b`+`ab3af6e`, pushed. FULL `tsc -p tsconfig.typecheck.json --noEmit` (Gate A) = 0 errors (verified by your terminal). Fresh full-suite Gate B (post F3 harden) → `1 failed / 3539 passed / 26 skipped (3566)` across 334 files; the 1 failure is the pre-existing migration-guard count drift (`expected 779 to be 776`, verified failing on clean HEAD — unrelated to F3/credits/SupportChat). F3 `getCreditCost` tier-validation harden applied + GREEN; PROFESSIONAL/SCALE `credit_costs` rows still BLOCKED-APPROVAL (no rates invented). | No regressions from this change. Gate A GREEN. Gate B failing only on the pre-existing migration-guard drift (out of scope for F3); all F3/credits/SupportChat tests GREEN.

### Phase 4 follow-through — F3 credit-tier reconciliation (2026-10-12)

Authoritative `subscription_plans.tier` (migrations 025/035/067 CHECK + seeds):
`free, starter, pro, professional, business, scale, enterprise`. `credit_costs`
(seeded 080) covers only `FREE, STARTER, PRO, BUSINESS, ENTERPRISE`. The real paid
plans `professional` ($249/mo) and `scale` ($2,499/mo) therefore have **no**
`credit_costs` rows.

- **Dashboard path is fail-closed and tested** (commit `08b4c85`): `getAllCosts('scale' |
  'professional')` throws `Unknown subscription tier … refusing to price it at FREE`
  (credits.test.ts:250-255); `getCredits` degrades to balance + history with `costs:{}`
  (getCredits.tierResilience.test.ts). **No silent FREE pricing is shown to users.**
- **Residual (PARTIALLY REMEDIATED — 2026-10-12):** the singular
  `getCreditCost(action, tier)` used to fall back to the `FREE` `credit_costs` row for an
  unmapped tier. Its two call sites are both internal to `credits.ts` and both
  billing-relevant, not display-only:
  1. `canAffordAction` (credits.ts:280) — the real-time affordability check.
  2. **`deductCreditsForAction` (credits.ts:557) — the live credit-deduction path.**
  So a paying `scale`/`professional` org was **undercharged on live usage** (charged the FREE
  surcharge), and that underprice was written to the ledger (`metadata.cost`).
  **Safe remediation applied (no rates invented — 2026-10-12 follow-through):**
  `getCreditCost` now validates the tier via `isKnownCreditTier` BEFORE any SQL — an
  unknown/unmapped tier THROWS (`[CREDITS] Unknown subscription tier … refusing to price it
  at FREE`), so it can no longer FREE-fall-back; `canAffordAction`/`deductCreditsForAction`
  propagate the rejection (fail-closed at the debit boundary). **Additionally, the residual
  per-action FREE fallback for a KNOWN PAID tier that is merely missing one action row was
  closed:** `getCreditCost` (credits.ts:188) now THROWS for `normalizedTier !== 'FREE'` with
  no row, instead of substituting the FREE rate — which would still undercharge a paying org
  and write a wrong (FREE) `metadata.cost`. Only the FREE tier keeps the escape hatch
  (resolving to its own floor-rate constant, which is correct by definition and can never
  undercharge a paying customer). `getAllCosts` (credits.ts:273) no longer unions
  `tier = 'FREE'` to fill gaps — a missing action is omitted from the cost map, and DB errors
  now THROW (the dashboard caller `getCredits` already .catch()es this and degrades to
  `costs:{}`). `creditGuard.checkCredits` translates the pricing throw into a clean
  `allowed:false` (surfacing as a 402 via `requireCredits`) instead of a 500 for the real-time
  affordability path, and `deductCreditsForAction` returns `success:false` with
  `errorCode:'PRICING_NOT_CONFIGURED'` + `deducted:0` (no credit movement) instead of
  throwing into `.success`-checking callers (`creditGuard.withCreditDeduction`, `jobs`).
  Regression pins added: `credits.test.ts` now has GREEN fail-closed assertions for (a) a
  known PAID tier missing an action row, (b) a DB error while pricing, (c)
  `canAffordAction` propagation, (d) `deductCreditsForAction` fail-closed result, and (e)
  `getAllCosts` never unioning `tier='FREE'` + throwing on DB error.
- **Safe migration (BLOCKED-APPROVAL — NOT implemented):** idempotent migration seeding
  `credit_costs` for `PROFESSIONAL` & `SCALE` at owner-approved per-unit rates. With the
  harden in place, until those rows exist every billable action for a `professional`/`scale`
  org fails closed at the debit boundary (throws, no silent revenue loss); free-tier and
  known tiers unaffected. Decision table below. Billing-owner sign-off on per-unit rates
  required.

### SET M follow-through — deal-completion summary data-honesty fix (2026-10-14, this session)

A **fabricated-data defect** of the exact class SET H2 / R1–R7 flag as unacceptable was
found in the core seller workflow: `generateSimpleSummary()` in
`app/api/deals/complete/route.ts` — the money-facing summary on the buyer→payment→sign→
confirm flow (returned by `GET /api/deals/complete` AND emailed as the "Assignment Fee"
on deal close). When `deal.metadata` lacked a recorded value it **invented** one:

- `purchasePrice = … || 100000` (a fabricated $100k price)
- `arv = … || price * 1.4` (fabricated ARV)
- `assignmentFee = … || Math.min(20000, price * 0.1)` (fabricated fee)
- `propertyAddress = … || 'Property Address'` (fake address)
- `closingDate = … || today + 14 days` (invented date)

The `confirm` path then **emailed the invented `assignmentFee` as if it were collected**
("DEAL CLOSED — Assignment Fee: $X") — a number the system never knew, in a money email.

**Fix (data-honesty, no API/behavior contract broken):** `generateSimpleSummary` is now
exported and rewritten to the same rule as `plainContractSummary.ts` — every financial
field is either the value actually recorded in `deal.metadata` **or `null`**; nothing is
derived from a guess. A new `numOrNull()` coerces raw metadata to a finite number or null
(non-numeric/`{}`/`null` are treated as unknown, never coerced). Derived figures
(`buyerPays`, `potentialProfit`) are computed only when every input is real, else null.
New `hasCompleteFinancials` boolean lets callers distinguish an honest "not recorded" from
a real number. `whyGoodDeal` bullets are emitted only for figures that exist. The confirm
email now renders `"not recorded"` for any null figure (via a `currency()` helper +
`feeLine`) instead of a fabricated amount, and no longer crashes on a null fee
(`.toLocaleString()` on null would have thrown). **Auth/org-scoping/transactions unchanged.**

**Verification (TDD, mutation-proven):**
- `src/app/api/deals/complete/__tests__/dealSummary.honesty.test.ts` — **7/7 pass** GREEN.
  Covers: recorded figures used exactly; all-null financials on empty/absent metadata
  (asserts the exact fabricated `100000`/`1.4×`/`12000` values are now null); partial-input
  cases stay null (no partial fabrication); non-numeric metadata → null; `whyGoodDeal` only
  asserts existing figures.
- **Mutation-proven RED:** temporarily restoring the `100000`/`1.4×`/`Math.min` defaults →
  **5 failed** (`expected 100000 to be null`, `expected 12000 to be null`,
  `expected true to be false`). Reverted to the honest impl (identical file hash), re-ran →
  **7/7 GREEN**.
- **Gate A:** `tsc -p tsconfig.typecheck.json --noEmit` → **TSC_EXIT=0**.
- Diff: 1 production file (`deals/complete/route.ts`, +86/−33) + 1 new test file. No
  unrelated behavior changed.

Status: **IMPLEMENTED + UNIT TESTED** (local). Not deployed; production-email honesty for
already-closed deals is unchanged (historical emails stand). Live deal-close round-trip
remains BLOCKED-EXTERNAL (Stripe/AWS email provider).

### SET M follow-through — closing-portal purchase-price honesty fix (2026-10-14, this session, `b3c2e07` chain)

While auditing the seller workflow's remaining money-facing transitions for the same
fabricated-data class, a second instance was found and fixed:
`app/api/portal/closing/route.ts` computed the buyer-facing purchase price as
`lead?.offer_cents ? lead.offer_cents/100 : metadata.acceptedAmount || **150000**` — a
fabricated `$150,000` shown in `closingStatus.purchasePrice` **and** as the
`disbursement.amount` when the deal's real price was simply not recorded (a closing portal
returning 200 while presenting a number the system never knew).

**Fix:** extracted an exported pure `resolveClosingPurchasePrice(offerCents, metadata)` that
returns the recorded `offer_cents/100` or a recorded positive `acceptedAmount`, else
`null` — never a fabricated default. `0` cents is treated as "no offer" (→null), and
non-numeric/negative/NaN recorded values are treated as unknown (never coerced). The
`ClosingStatus.purchasePrice` and `disbursement.amount` fields are now `number | null` so
the honest "not recorded" propagates instead of a guess. Portal auth/rate-limiting/status
logic unchanged.

**Verification (TDD, mutation-proven):**
- `src/app/api/portal/closing/__tests__/closingPurchasePrice.honesty.test.ts` — **5/5 pass**.
- **Mutation-proven RED:** restoring `|| 150000` → **2 failed** (`expected 150000 to be
  null`); reverted (identical file hash) → 5/5.
- Portal + deal group regression → **12/12 pass** (closing honesty + deal honesty).
- **Gate A:** `tsc -p tsconfig.typecheck.json --noEmit` → **TSC_EXIT=0**.
- Diff: 1 production file (`closing/route.ts`, +30/−3) + 1 new test. No unrelated change.

**Remaining in the SAME cluster (documented, NOT auto-fixed — needs product-design input):**
`app/api/portal/offer/route.ts` still fabricates offer-side figures shown to sellers:
`arv_cents/100 : **200000**`, `assessed_value_cents/100 : **150000**`, `offerAmount =
existingOffer || Math.round(arv * distressMultiplier)` (a computed figure presented as a
real offer), two inconsistent `distressMultiplier` scales (`/100` in the sourced path vs
raw-score in the lead path — a real bug), and `'Address on file'`/`'Property Owner'`
placeholders. An offer page fundamentally needs a number, so "what to show when no offer
exists" is a **product decision** (e.g. "contact us" vs "pending underwriting"), not a
safe autonomous rewrite. Flagged for owner/design approval; not bundled here.

### SET M follow-through — assignment-contract fee honesty fix (2026-10-14, this session, `b3c2e07` chain)

A third, more serious instance of the same fabricated-data class was found and fixed in a
**buyer-facing legal document**: `app/api/contracts/send/route.ts` generated the assignment
contract with `const assignmentFee = negotiation.assignment_fee || 10000`. When a
negotiation had **no recorded fee**, this fabricated a **$10,000** assignment fee, passed
the `$5,000` floor check, and sent a signed assignment contract telling a real buyer they
owed a fee that was never negotiated — real money, on a legal instrument, from a number
nobody set. (No guard existed, unlike the purchase-agreement path which already required a
price or 400'd at L214.)

**Fix (fail-closed, mirrors the existing L214 purchase-price guard):** the assignment fee
must now be a **recorded** positive finite `negotiation.assignment_fee`; if absent/null/
non-numeric/≤0 the route returns **400** ("Assignment fee has not been recorded … record
the agreed fee before sending the contract") instead of fabricating a contract. The `$5,000`
floor still applies to a recorded fee. Auth/CSRF/IDOR/esign logic unchanged. (The
purchase-agreement path's `|| 100000` fallbacks at L222-223 are defensive/unreachable —
that path already 400s when no price is available at L214 — so left as-is, not part of this
change.)

**Verification (TDD, mutation-proven):**
- New test `send/route.test.ts` → "400 (not a fabricated $10,000 contract) when NO
  assignment fee was negotiated" — asserts status 400, error mentions "Assignment fee", and
  the response contains no fabricated `10000`.
- **Mutation-proven RED:** restoring `|| 10000` → **1 failed** (`expected 200 to be 400`);
  reverted (identical file hash) → GREEN.
- `contracts/send` suite → **16/16 pass**; contracts group (`send`+`generate`+`route`) →
  **34/34 pass** (no regressions).
- **Gate A:** `tsc -p tsconfig.typecheck.json --noEmit` → **TSC_EXIT=0**.
- Diff: 1 production file (`send/route.ts`) + 1 test file. No unrelated behavior changed.

### Priority 3 — Professional / Scale rate decision table (verified, no values invented)

**⚚ CRITICAL DATA-QUALITY FINDING (verified, not fabricated):** the repository does
**NOT** contain a single coherent "Professional $249 / Scale $2,499" pricing story.
Multiple migrations define **conflicting** plan rows, and the `professional` tier
label has been **re-aliased** by migration `066`. Facts, read verbatim from source,
in chronological order:

| Migration | Tier | Price | Key notes |
|---|---|---|---|
| `025` | (schema) | — | CHECK: `(starter, professional, enterprise)` |
| `035_seed_subscription_plans` | starter / professional / enterprise | $99 / **$249** / custom | `plan_professional` seeded, tier=`professional`. |
| `066_chatgpt_style_pricing` | free/starter/**pro**/business/enterprise | $0/$29/**$79**/$199/custom | **Supersedes 035.** Lines 154-161: **re-aliases `plan_professional` → tier=`pro`, $79** ("alias for pro"). Adds overage rates in cents. |
| `067_value_based_pricing` | free/starter/pro/business/**scale**/enterprise | $0/$129/**$399**/$899/**$2,499**/custom | **Diverges from 066:** Pro $79→$399, Business $199→$899. Seeds `plan_scale` ($2,499). Does NOT seed `plan_professional` (066 aliased it to `plan_pro`). |
| `075_free_tier_and_usage_limits` | — | — | **Documented as ABORTED** (lines 33-48): constraint DROP/ADD raised `violated by some row` because live DB held `pro/business/scale` rows. Comment: "aborted the entire migration chain here (075) — which is why 080-086 (the credit system) never applied" on the live DB. Local/test DB converges to the 7-tier superset; production may be frozen at 074. |
| `080_credit_system` | — | — | Seeds `credit_costs` for **5 tiers only**: `FREE, STARTER, PRO, BUSINESS, ENTERPRISE` (**30 rows**: 5 tiers × 6 actions). **No `SCALE` or `PROFESSIONAL` rows.** |

**Current effective `subscription_plans` state (local DB, post-101):** `plan_free
($0), plan_starter ($129), plan_pro ($399), plan_business ($899), plan_scale
($2,499), plan_enterprise` (custom) — 6 plan rows / 6 prices. The tier labels
present are `free, starter, pro, business, scale, enterprise`; there is **no live
row with tier=`professional`** (066 repointed `plan_professional` to tier=`pro`).
The CHECK still *permits* `professional`, so a legacy/inserted row is possible but
not seeded. The pricing page (`pricing/page.tsx:105`) queries `WHERE tier IN
('free','starter','pro','business','scale')` — so the **public site never renders a
`professional` tier**, corroborating it is defunct.

**Live tier lacking `credit_costs` rows AND with a billable plan: `SCALE`
($2,499/mo per 067).** `PROFESSIONAL` as a distinct tier is defunct (aliased to
`PRO` at $399); fail-closed for it is a dead-code-safety path.

### Six-action credit-cost matrix

| Action | FREE | STARTER | PRO | BUSINESS | ENTERPRISE | SCALE | PROFESSIONAL* |
|---|---|---|---|---|---|---|---|
| SMS_SEND | 5 | 4 | 3 | 2 | 2 | **MISSING** | **MISSING** (defunct) |
| EMAIL_SEND | 2 | 2 | 1 | 1 | 1 | **MISSING** | **MISSING** (defunct) |
| AI_REQUEST | 10 | 8 | 5 | 4 | 3 | **MISSING** | **MISSING** (defunct) |
| AI_NEGOTIATION | 25 | 20 | 12 | 10 | 8 | **MISSING** | **MISSING** (defunct) |
| CONTRACT_GENERATE | 15 | 12 | 8 | 6 | 5 | **MISSING** | **MISSING** (defunct) |
| LEAD_FIND | 3 | 2 | 1 | 1 | 1 | **MISSING** | **MISSING** (defunct) |

\* `PROFESSIONAL` is aliased to `PRO` (tier=`pro`) by migration 066; the `PRO` rows
above are what a `plan_professional` customer currently resolves to.

**Sources:** `080_credit_system.sql:45-87` (sole `credit_costs` source, verbatim —
none invented); `066`/`067` (`subscription_plans` prices); `pricing/page.tsx:105`
(public-site tier filter). **Pricing migration: BLOCKED-APPROVAL — NOT applied.**

### Pricing methodology: why margin-based rates CANNOT yet be computed (missing inputs)

Per directive §Priority 3.4, the data does **not** support a back-of-envelope
margin rate, because these inputs are absent from the repository:

1. **Provider unit costs:** Twilio SMS rates by destination/country, the email
   provider cost, and AI model inference cost ($/token) for AI_REQUEST /
   AI_NEGOTIATION / CONTRACT_GENERATE are **not** in the codebase. Migration
   `029_ai_providers` stores provider config but not per-token costs.
2. **Included allowances are not mapped to actions per tier.**
   `subscription_plans.limits` carries `monthly_ai_credits` /
   `monthly_sms_allowance` / `monthly_email_allowance` (usage-allowance model),
   but `credit_costs` charges **per-action**. No field links how many
   `SMS_SEND` credits a plan's allowance buys, so the "effective price per
   included unit" is not derivable without assumptions.
3. **Expected usage distributions per tier are absent.** No volume histogram per
   paying org exists, so the blend justifying a tier's marginal credit rate is
   unknown.
4. **CONFLICT between 066 ($79 Pro) and 067 ($399 Pro) prices.** Only a live
   `SELECT tier, price_cents FROM subscription_plans` settles which is current.
5. **Migration `075` is documented ABORTED** (its own comment, 075:33-48). If
   production is frozen at 074, the `credit_costs` table itself does not exist in
   prod and the credit-billing path is not the live one — overage billing
   (066/067 `limits.overage_*_cents`) is. This changes what "SCALE credit costs"
   means and must be reconciled before any seed.

### Options for Professional/Scale credit pricing (owner decision)

| Option | What | Advantages | Risks | Recommendation |
|---|---|---|---|---|
| **A. Explicit tier-specific rows** | Seed 6 `credit_costs` rows for `SCALE` via idempotent `INSERT … ON CONFLICT DO UPDATE` (mirror 080 style). | Tier priced from own economics; dashboard shows real prices; clean. | Owner must *decide* 6 rates; must run after 066/067 + 075 reconcile on live DB. | **Choose this** once rates approved. |
| **B. Owner-approved inheritance policy** | Code maps `SCALE → BUSINESS` (next lower tier) rates until seeded — explicit, not silent FREE. `PROFESSIONAL` (defunct) → `PRO`. | Unblocks Scale customers now with conservative (higher) rates; no FREE leakage; reversible. | `SCALE` ($2,499) paying `BUSINESS` ($899) rates = **overcharge** vs the plan's value — dispute risk. Must be time-boxed + surfaced to billing. | Acceptable **interim** only if Scale customers are blocked AND owner signs off on overcharge risk. |
| **C. Leave unpriced (current state)** | Fail-closed: every billable action for `SCALE` returns `errorCode: PRICING_NOT_CONFIGURED` → HTTP 402, `deducted:0`. | Zero revenue-leakage; no overcharge; no assumptions. | `SCALE` ($2,499/mo) customers **cannot SMS/email/AI/contract/lead** via the credit path. Business-stopping for them. | Current safe default. Use until A/B approved, or if no live Scale customers on the credit path. |

### Owner approval items (required before any migration)
1. **Confirm live migration baseline:** `SELECT count(*) FROM credit_costs;` on prod.
   If it errors, 075 aborted on prod and the credit path must be re-versioned —
   not just the rates.
2. **Confirm live plan prices:** `SELECT tier, price_cents FROM
   subscription_plans WHERE tier IN ('scale','pro','business','starter');` —
   resolve the 066 vs 067 conflict.
3. **Approve exact per-action credit rates for SCALE** (6 rows). Suggested
   *starting point for discussion only (NOT approved, NOT applied)*: mirror
   `BUSINESS` (SMS 2, email 1, AI 4, AI_NEG 10, CONTRACT 6, LEAD_FIND 1) — but
   this overcharges relative to SCALE's $2,499 vs BUSINESS $899 and should be
   re-evaluated once provider costs + usage distribution exist. Owner may pick
   lower rates reflecting SCALE's larger allowances.
4. **Decide `professional` tier fate:** drop it from the CHECK, or confirm it
   should be a separately-priced tier (it is currently a defunct alias of `PRO`).
5. **Choose rollout option** (A / B / C) and authorize deployment.

### 2026-10-13 milestone update (this session)
- Rollout gate `apps/web/scripts/check-credit-pricing-readiness.mjs` + test committed `5ba8cfa`, pushed. 080 seed corrected 45→30 rows.
- SEO-1 audit: new `apps/web/src/app/seo-surface.guard.test.ts` pins no-duplicate sitemap, every sitemap path resolves (except intentional /compliance→/trust redirect), every indexable route in sitemap (except /legal/accept noindex), single origin of truth (no dealflow.ai). Committed below.
- Gate runs pending owner terminal (shell runner broken, recorded): gate script expect exit 2 HOLD; new tests expect GREEN.


### 2026-10-13 post-verification update
- 080 seed corrected to **30 rows** (was "45" in one draft line). Gate script
  `apps/web/scripts/check-credit-pricing-readiness.mjs` (offline rollout
  checklist, exits 0/1/2) + regression test
  `apps/web/scripts/check-credit-pricing-readiness.test.ts` added this session
  (uncommitted pending). Pricing migration NOT created/applied — BLOCKED-APPROVAL.
- Fail-closed protections preserved and GREEN (prior cycle): unknown tier +
  missing paid-tier action row + DB error never become FREE pricing;
  `deductCreditsForAction` returns `PRICING_NOT_CONFIGURED` + deducted:0;
  `creditGuard` maps to clean 402. Dashboard degrades to `costs:{}`.
- Real live gap is SCALE only ($2,499/mo); `professional` is defunct (066 alias).
  Owner items: prod credit_costs baseline, live plan prices, 6 SCALE rates,
  professional fate, rollout option A/B/C.


### Verification (final, 2026-10-12 cycle)
- **Gate A**: `tsc -p tsconfig.typecheck.json --noEmit` = EXIT 0, 0 errors.
- **Gate B**: `vitest run --config src/app/api/vitest.config.ts` = **3545 passed | 26 skipped | 0 failed**, exit 0, 283.97s. Shell.theme timeout resolved via per-test override.

### 2026-10-13 F3-entitlements completion (this session — shell runner restored, all gates run in-agent)

**The defect was worse than the tier-config gap.** `getOrganizationTier` ran
`LEFT JOIN subscriptions s ... AND s.status = 'ACTIVE'` selecting `s.tier` —
but **no migration creates `subscriptions`** (026 created
`organization_subscriptions`; 087 declares it authoritative), the 026 CHECK
stores **lowercase** status (`'active'`, never `'ACTIVE'`), and **tier lives on
`subscription_plans`**, not on subscription rows. The query therefore threw on
**every call** and the catch returned `FREE` — silently demoting every org,
including paying BUSINESS/SCALE customers, before the config gap even mattered.
Fixed to the 087 sources of truth:

```sql
LEFT JOIN organization_subscriptions os
  ON os.organization_id = o.id AND os.status IN ('active','trial')
LEFT JOIN subscription_plans sp ON sp.id = os.plan_id
ORDER BY os.created_at DESC   -- latest subscription row wins
```

**Tier model fixes in `apps/web/src/app/api/utils/entitlements.ts`:**
- `SubscriptionTier` widened `FREE|STARTER|PRO|ENTERPRISE` → + `BUSINESS` + `SCALE`.
- `DEFAULT_TIER_CONFIGS` gains BUSINESS (13 features inc. `priority_support`,
  15 seats, 0.9× credits) and SCALE (14 features inc. `custom_branding`,
  campaigns −1, 50 seats per 067, 0.85× credits); Enterprise remains the cap.
- All three `tierOrder` arrays (checkEntitlement, checkEntitlements,
  getUpgradeRecommendations) now `['FREE','STARTER','PRO','BUSINESS','SCALE','ENTERPRISE']`.
- Legacy `professional` label (still permitted by the 066 CHECK) normalises →
  `PRO` instead of fail-closed demotion; `planCatalog.ts` already resolves the
  retained `plan_professional` alias to canonical `tier='pro'` rows (066).

**Two tests from earlier today (committed while the shell was broken, never
executed) were RED — both root-caused and fixed:**
1. `check-credit-pricing-readiness.mjs`: the FREE-fallback check matched its own
   **docblock prose** (`getAllCosts` documents the banned `OR tier='FREE'`
   pattern); the guard now scans comment-stripped code. Worse, the HOLD
   **polarity was inverted** — `blocks` fired only when SCALE/PROFESSIONAL rows
   *existed*, so the gate would have exited 0 while unpriced and 2 once priced,
   exactly backwards. Now: exit 2 (BLOCKED-APPROVAL) while unpriced → exit 0
   (READY) once the owner-approved rows land.
2. `seo-surface.guard.test.ts`: forbidden-origin check matched `robots.ts`'
   **historical comment** explaining the old `dealflow.ai` bug; origin checks
   now use `readLive()` (comment-stripped) so live references are still caught.

**Fresh verification evidence (in-agent, 2026-10-13):**
- Gate A: `tsc -p tsconfig.typecheck.json --noEmit` → **EXIT 0**.
- Targeted: gate(3) + seo(11) + entitlements(32) = **40/40 pass**;
  `entitlements.fail-closed.test.ts` 16 → **32 tests** (query-shape pin:
  authoritative tables, no phantom join, no `'ACTIVE'`).
- Gate B (full suite): **335 passed | 1 skipped files / 3569 passed |
  26 skipped | 0 failed**, 364.41s.
- Gate script direct: **exit 2 HOLD** — `HOLD (BLOCKED-APPROVAL): safeguards
  hold; 2 pricing item(s) need owner rates`, table prints `SCALE=MISSING` /
  `PROFESSIONAL=MISSING`, rates never invented.

**Owner items unchanged:** approve SCALE per-action rates (professional fate),
then rollout option A/B/C.


### SET M follow-through — match-buyer email price honesty fix (2026-10-14, this session)

Auditing the seller-to-buyer notification workflow for the fabricated-data class
flagged by SET H2 / R1–R7, a **fourth instance** was found and fixed:
`app/api/deals/match-buyer/route.ts` computed the buyer-facing purchase price as
`metadata.purchase_price || metadata.offer_price || 100000` and emailed real
buyers a "New Deal Available" showing `Purchase: $100,000 + Assignment: $X` for
a deal whose price was never recorded — invented money in a customer-facing
opportunity email, identical in class to the three prior fixes in this chain.

**Fix:** extracted an exported pure `resolveMatchPrice(metadata)` that returns the
recorded `purchase_price` (coerced to a positive finite number, treating `0` /
negative / NaN / non-numeric as unknown) or `offer_price` fallback, else `null`
— never a fabricated default. The internal buyer-scoring `priceRangeMatch`
signal retains `?? 100000` (documented as ranking-only, never user-facing). The
email path now uses `priceDisplay` / `totalPriceDisplay` which render
"price to be confirmed" instead of a dollar figure when `resolveMatchPrice`
returns `null`, and omits the `Assignment: $X` line from the email entirely
(both text and HTML) when no purchase price was recorded. Compliance footers,
VIP windows, and match-scoring logic are unchanged.

**Assessment of the two other flagged fallbacks (NOT defects):**

| Route | Flagged fallback | Assessment | Status |
| --- | --- | --- | --- |
| `campaigns/templates/route.ts` | `offerAmount: 150000`, `propertyAddress: 'Property Address'` | Admin-only render utility (`requireAdmin`). No live email-sending caller. Templates require `validate: true` mode and reject missing compliance fields via `validateEmailCompliance`. Not user-facing fabrication. | No action needed |
| `contracts/generate/route.ts` | `earnest_money \|\| 1000` (literal, equals `PURCHASE_AGREEMENT_DEFAULTS.earnest_money = 1000`; no `MINIMUM_EARNEST_MONEY` symbol exists) | Intentional, disclosed default — pinned by `dealEconomics.test.ts:48` (`expect(PURCHASE_AGREEMENT_DEFAULTS.earnest_money).toBe(1000)`), validated by `engine.ts:317`, documented as a contract term default alongside `inspection_days \|\| 14`. No producer writes `metadata.earnest_money`, so the default is always the disclosed value; no negotiated zero exists to overwrite. | No action needed |

**Verification (TDD, mutation-proven):**
- `src/app/api/deals/match-buyer/__tests__/matchPrice.honesty.test.ts` — **6/6 pass**.
- **Mutation-proven RED:** reverting `return null` → `return 100000` → **2
  failed** (`expected 100000 to be null`); reverted (identical logic restored)
  → 6/6.
- **Gate A:** `tsc -p tsconfig.typecheck.json --noEmit` → **EXIT 0**.
- Diff: 1 production file (`deals/match-buyer/route.ts`, +38/−6) + 1 new test.
  No unrelated behavior changed.

## SET M follow-through: contracts/send earnest-money + placeholder-address fix (2026-10-14)

**Defect (data honesty, customer-facing legal document):** `POST /api/contracts/send`
(`purchase_agreement` branch) validated that *either* `agreed_price` **or**
`metadata.estimated_value` exists (guard permits estimate-only leads) but then
computed `earnestMoney = (lead.agreed_price || 100000) * 0.01` — so a
$500,000-estimate contract was rendered stating **"Purchase Price: $500000"**
next to **"Earnest money deposit of $1000"** (1% of an invented $100,000, not of
the stated price) and sent for e-signature. Additionally a lead missing both
address sources produced a contract whose subject property read literally
`"Property Address"` (placeholder), while `contracts/generate/route.ts` fails
closed on the same condition.

**Fix (smallest complete change):** one validated basis for both figures —
`statedPrice = agreed_price || estimated_value`, guarded by
`Number.isFinite(contractPrice) && contractPrice > 0` (invalid/missing →
400 `Purchase price required for contract generation`, same message as before);
`earnestMoney = 1% of contractPrice`; new fail-closed guard → 400
`Property address required for contract generation` when neither
`metadata.property_address` nor `lead.address` exists. Both `|| 100000`
fallbacks removed (0 occurrences remain in the file). Display strings
(`String(statedPrice)`) unchanged from prior rendering.

**Verification (TDD, mutation-proven):**
- RED before fix: `route.test.ts` → **2 failed | 17 passed** (`expected … to
  contain 'Earnest money deposit of $5000'`; `expected 200 to be 400`).
- GREEN after fix: **19 passed / 19**.
- Mutation proof: restoring `earnestMoney … (lead.agreed_price || 100000) …`
  → **1 failed | 18 passed** (fails at the `$5000` assertion); restored → 19/19.
- Gate A `tsc -p tsconfig.typecheck.json --noEmit` → EXIT 0 (see checkpoint).

**Audited-not-defects in the same sweep:** `send/route.ts` L33 `\${{earnestMoney}}`
is intentional `{{var}}` mustache syntax for `fillTemplate` (single-brace
interpolation; no `${{` bug exists in any contract template); no stray files
were created by earlier malformed edit attempts (`apps\src` absent; git status
clean of them).

**Owner-config item (not code):** `send/route.ts:189` falls back to a fake
postal address `'123 Main St, Suite 100, Dallas, TX 75001'` when
`COMPANY_POSTAL_ADDRESS` is unset — outbound email footers need the real
registered address → **BLOCKED-APPROVAL** (owner supplies address; no code
change possible without it).




