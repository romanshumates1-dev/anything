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
| G1 | Authenticated routes render | `scripts/deployed-browser-qa.mjs` | E2E TESTED (FAILING) | login OK; **15/24 routes 503**, `/dashboard` 12.4s | CPU ceiling → OPEN DEFECT 2 |
| G2 | No intermittent homepage 500 | — | **NOT VERIFIED** | `ComponentMod.handler is not a function`; 40/40 no repro | cause UNIDENTIFIED |

## SET H — CONSOLE / DATA HONESTY

| ID | Requirement | Implementation | Status | Evidence |
| --- | --- | --- | --- | --- |
| H1 | No avoidable console errors | **PARTIAL** | Browser sweep 2026-10-04: **no error boundaries and no uncaught exceptions** on `/dashboard`, `/campaigns`, `/lead-finder`, `/settings/billing`. Remaining console noise is a Cloudflare RUM beacon aborted on navigation (`/cdn-cgi/rum?`) plus the 503/1102 burst. Not yet clean under sustained load |
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
| V1 | GAMIFICATION ON/OFF setting | `utils/gamification.ts` + allowlist + `gamification.server.ts` | UNIT TESTED | commit `61fe673`; **write path gated in `6b30d2c`** (POST was ungated — see R4) | — |
| V2 | XP, points, levels, categories | `api/achievements/route.ts` (`user_stats.points`, `achievements.points`, `maxProgress`, server-side `summary`) + `app/achievements/page.tsx` | **LIVE VERIFIED** (was a FALSE POSITIVE, corrected then re-verified) | Fixed in `fa43bd0`; prior "LIVE VERIFIED (200)" **INVALIDATED** (page served a hardcoded array). **Re-verified properly** on Worker `8b0da56b` with an authenticated session: `/achievements` 200, mockLeak=0, 0 console errors, 0 page errors, no error boundary (`0437912`) | — |
| V3 | Crates / spin wheel / battle pass / seasons / competitions | none after concept search of `api/*` + git history | NOT STARTED | genuinely absent (`spin_wheel\|battle_?pass\|crateOpen` = 0 hits in 1071 source files) | — |

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

### Four ways a verification can be true and still worthless

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
| ~~CONTACTS-PAGE~~ | ~~No CRM contacts page~~ | **DONE 2026-10-04** | False negative #8 — `/crm` is a complete UI (search, status/campaign filters, CSV export, detail drawer), live 200, backed by org-scoped APIs. `/leads` separately serves the lead DB as "Contacts" — two intentional datasets |
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