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
| G2 | No intermittent homepage 500 | — | **NOT VERIFIED** | `ComponentMod.handler is not a function`; 40/40 no repro | cause UNIDENTIFIED |
| G3 | Analytics views serve every parameter variant without 5xx | `crmAnalyticsEngine.ts`, `analytics/attribution/route.ts`, `schemaColumnTruth.guard.test.ts` | **DONE 2026-10-07** (`a0c9ec6`) | phantom `contracts.lead_id` / `message_events.opened_at` / `leads.zip_code` corrected at 7 sites; probe: all 8 `analytics/crm` variants 200 incl. `groupBy=zipCode` + `view=outreach`; static tree-scan guard + regression samples | — |

## SET H — CONSOLE / DATA HONESTY

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| H1 | No avoidable console errors | **PARTIAL** | Browser sweep 2026-10-04: **no error boundaries and no uncaught exceptions** on `/dashboard`, `/campaigns`, `/lead-finder`, `/settings/billing`. Remaining console noise is a Cloudflare RUM beacon aborted on navigation (`/cdn-cgi/rum?`) plus the 503/1102 burst. Not yet clean under sustained load. **Test-suite console error CLOSED 2026-10-08 (`48bdaf3`)**: `Shell.test.tsx`'s `next/link` mock no longer leaks `prefetch` onto a raw `<a>` (React "non-boolean attribute" warning); guard test added, mutation-proven. `Shell.tsx` untouched — real `next/link` consumes `prefetch` |
| H2 | Dashboard shows real data, never invented | commits `503845f`, `753e1b9` | UNIT TESTED | `ProfitChart` etc. now render real failure instead of hardcoded sample numbers |

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
| P1 | Campaign UX redesign | `app/campaigns` | IMPLEMENTED | routes exist | not browser-verified |
| Q1 | Workflow phase toggles (phone/SMS/email) | `api/campaigns/{automation,config}` | IMPLEMENTED | code present | **enabled/disabled execution NOT VERIFIED** |
| R1 | AI phone calling | `api/gateway/voice-gateway.ts`, `api/utils/twilio-adapter.ts`, `api/utils/callSchedulingEngine.ts`, `api/campaigns/[id]/voice/` | **UNIT TESTED** | 33 tests across voice-gateway, twilio-adapter, voiceSelection, voiceRoute — false negative #3 | live calls need provider credential |
| S1 | AI templates | `app/templates`, `components/templates` | IMPLEMENTED | routes + components exist | — |
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
| Gamification crates / spin wheel / battle pass / seasons / competitions | `api/*` for crate/spin/season/battle/competition/giveaway/reward | **ABSENT** |

**Corrected tally: 10 false negatives, 3 genuinely absent (affiliate, Flipper,
crates/spin/battle-pass), 1 false positive in the other direction (the referral
banner really was missing — fixed in `2ea6db3`).**

### Standing method note

Directory-name search is unreliable in this repo. `api/crm`, `api/contacts`,
`api/v1/contacts` and `app/crm` all exist under names you would not guess. Always
search contents, DB columns and the build manifest before concluding ABSENT.

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
| G2 | Intermittent homepage 500 | **BLOCKED-EXTERNAL** (2026-10-07) | No CF_API_TOKEN/CF_ACCOUNT_ID locally; wrangler whoami times out. opennextjs chunk hypothesis DISPROVEN. Controlled concurrency diagnostic requires Cloudflare auth. |
| G1b | Free-plan resource ceiling (Cloudflare 1102) | OPEN — owner decision | `limits.cpu_ms` is rejected on the Free plan. Buy capacity or do less work per invocation |
| DEPLOY | Ship current HEAD (through `a0c9ec6`) | **NOT STARTED** (blocked: no CF auth) | Last live Worker is `85de11a9` from `a576f2f`. `scripts/wrangler-deploy.mjs` has stale-artifact guard (tested by `6ff97f0`). Run `yarn cf:build` first, then deploy. |
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

Genuinely absent, and now *proven* absent by concept search rather than directory
guess: **affiliate programme**, **Flipper/Builder AI**, and **crates / spin wheel
/ battle pass / competitions**.

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
- **Genuinely absent after re-verification:** CRM contacts page, affiliate
  programme, Flipper/Builder AI, gamification crates/spin/battle-pass.

**10/10 is not reachable in this environment.** It requires live Stripe, Apollo
and Bedrock evidence plus a paid Workers plan. Claiming it would mean inventing
verification. This score reflects what was actually measured.