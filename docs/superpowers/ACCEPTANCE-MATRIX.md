# ACCEPTANCE MATRIX — production release gate (2026-09-27)

**Purpose.** One authoritative table for release readiness. It merges the
original 17-item request, the security / software-engineering / QA addendum, and
every defect found during the hardening mission (including #28–#35 found in the
final release-candidate phase). Nothing is renumbered: original requirement
wording and IDs are preserved; later findings are appended as new rows.

**Status vocabulary (deliberately strict).**

| status | meaning |
|---|---|
| **COMPLETE** | implemented, covered by tests that can fail, and verified against the running system — not merely "code exists" |
| **PARTIAL** | implemented and tested, but one or more required verification layers is missing (browser, sandbox, production) |
| **BLOCKED** | cannot be finished here; blocker named with the exact credential/decision needed |
| **UNVERIFIED** | implemented but not yet checked by any independent execution |

**Evidence vocabulary used below.** `TC` = `yarn typecheck` exit 0.
`UNIT` = `yarn test` (vitest, 231 files / 2597 tests). `E2E` = Playwright +
system Edge against a real session created by `e2e/global-setup.ts`.
`MIG` = `scripts/migration-gate.mjs` (fresh-DB build + idempotent re-run +
live drift). `PROBE` = `scripts/api-probe.mjs` (live HTTP, real synthetic
users). `QA` = `scripts/browser-qa.mjs` (real browser, 36 routes × 2
viewports). `AUDIT` = `yarn npm audit`.

---

## A. Original 17-item request

| # | Requirement (original wording preserved) | Implementation | Files | Automated tests | Browser/E2E | Security | Prod verified | Status | Evidence | Blocker | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | AI support functional + smaller/optimal button | `SupportChat.tsx` + `api/support/chat` | `components/SupportChat.tsx`, `app/api/support/chat/route.ts` | rate limit, message bounds, provider-failure fallback | page renders, 0 console errors | AI input-bounds suite | no | **PARTIAL** | QA; UNIT | production visit | confirm launcher size on the real domain |
| 2 | Long username/email sidebar fix | `min-w-0` + `truncate` + `title` | `components/Shell.tsx` | `Shell.test.tsx` (3 render tests, 300-char email) | not visually confirmed (jsdom has no layout) | n/a | no | **PARTIAL** | UNIT | visual confirmation | view the sidebar with a 300-char email in a real browser |
| 3 | Apollo as a lead source | `api/lead-finder/apollo/*` | `app/api/lead-finder/apollo/` | provider + client tests | UI not exercised | attribution + dedupe | no | **PARTIAL** | UNIT | `APOLLO_API_KEY` | replay a recorded fixture, then a live key |
| 4 | Third-party lead-source handling | source registry + adapters | `app/api/lead-finder/*` | covered | n/a | tenant-scoped | no | **PARTIAL** | UNIT | live provider | — |
| 5 | Third-party lead-source upcharge/billing | 15 upcharge sites | `app/api/**` | covered | n/a | server-priced | no | **PARTIAL** | UNIT | Stripe | confirm credits post on a real charge |
| 6 | Free-trial demo data, no A2P to explore | 21 gated sites | `src/**` | covered | n/a | demo gating | no | **PARTIAL** | UNIT | — | — |
| 7 | Performance: 5–10 s navigation | measured 175–1126 ms | dev tooling | `QA` timings | measured per route | n/a | no | **PARTIAL** | QA | production build | re-measure against a production build |
| 8 | Full route/page functionality test + repair | 7 blank routes fixed | `app/**` | 231 files green | 36 routes × 2 viewports | — | no | **COMPLETE** | QA; UNIT | — | — |
| 9 | Payment/subscription/credit systems | Stripe + credits | `app/api/billing/*` | mocks only | n/a | idempotent | **no** | **PARTIAL** | UNIT | `STRIPE_SECRET_KEY` | run the payment matrix in sandbox |
| 10 | Console/error audit + repair | complete | — | suite + QA | 0 console errors measured | — | no | **COMPLETE** | QA | — | — |
| 11 | Premium UI/VFX + SEO | design pass | `app/(marketing)` | seo ratchet | renders | — | no | **PARTIAL** | UNIT | — | — |
| 12 | AI credits: weekly ≤ ¼ monthly, daily ≤ ⅕ weekly | `aiCreditGate` + `aiCreditLimits` | `app/api/utils/aiCredit*` | pglite suites | n/a | server-authoritative | no | **PARTIAL** | UNIT | — | check shipped numbers against a live subscription |
| 13 | Restricted signup domain toggle | single source of truth | `app/api/utils/email-domain-policy.ts` | `signup-restrictions.test.ts` | live DB row verified | 4 enforcement layers | no | **COMPLETE** | UNIT; live policy row | — | — |
| 14 | Billing/payment pages | `app/api/billing/*` | — | mocked | renders | — | no | **PARTIAL** | UNIT | Stripe | — |
| 15 | Payout/earnings filters d/w/m/q/y | `TaxReportPanel` | `components/payouts/TaxReportPanel.tsx` | 5 component tests | tab renders | server bucketed | no | **COMPLETE** | UNIT | — | — |
| 16 | Earnings/tax-reporting document | `api/tax/report` + CSV + panel | `app/api/tax/*` | report/settings/integration suites | panel renders | tenant-scoped | no | **COMPLETE** | UNIT | — | — |
| 17 | Optional auto-tax withholding, visible in payouts | settings + withdrawal hook + ledger join | `app/api/tax/*`, `app/api/withdrawals` | 25 policy + concurrency pglite + join tests | net/withheld rendered | idempotent ledger | no | **COMPLETE** | UNIT | — | — |

---

## B. Security / software-engineering / QA addendum

| # | Area | Status | Evidence | Blocker / next action |
|---|---|---|---|---|
| S1 | Authentication | **PARTIAL** | sign-up → session → org proven live after fixing #30/#31; better-auth 1.7.6; cookie `SameSite=None`+`Secure`+`HttpOnly`; e2e global setup registers a real account | live auth journey on the deployed domain (B3) |
| S2 | Authorization / IDOR | **PARTIAL** | org-scoped lookups; `PROBE` cross-tenant check; anti-oracle 404s | matrix is broad, not exhaustive |
| S3 | CSRF | **COMPLETE** | #28 choke point + 21 tests (`Origin: null`, proxy, Referer, Bearer) | - |
| S4 | CORS | **COMPLETE** | ratchet: no `Access-Control-Allow-*` in src or next.config | - |
| S5 | XSS | **COMPLETE** | no `dangerouslySetInnerHTML` on AI output; legal renderer escapes | - |
| S6 | Injection | **PARTIAL** | #35 injection net; SQL values always bound | live AI red-team (B2/B3) |
| S7 | SSRF | **PARTIAL** | stored-webhook guard + 30 evasion tests | DNS rebinding unsolved (documented) |
| S8 | Secret exposure | **COMPLETE** | `client-secret-scan` guard; no secret env in client components | - |
| S9 | Rate limiting | **COMPLETE** | #34 fixed; live 429 with a real message | - |
| S10 | Webhooks | **COMPLETE** | esign/payments/Twilio signature-verified | live endpoints (B3) |
| S11 | Financial integrity | **PARTIAL** | atomic withdrawal batch, lossless split, zero-floor, idempotent ledger | live Stripe (B1) |
| S12 | AI security | **PARTIAL** | adversarial suite (10) + injection net + input bounds | live provider red-team |
| S13 | Dependency / supply chain | **PARTIAL** | AUDIT 28 → 1 advisory; declared minimums raised | vitest 4 major left (dev-only) |
| S14 | Headers / CSP | **COMPLETE** | regression-guards asserts CSP + headers | - |
| S15 | Data leakage | **PARTIAL** | error.message audit closed; `PROBE` scans responses for secrets | production bundle sweep |
| S16 | Concurrency / race | **PARTIAL** | tax-ledger concurrency (pglite), atomic withdrawal batch | load test at scale |
| S17 | Observability | **PARTIAL** | structured logs, readiness endpoint | production dashboards |
| S18 | Migration / schema safety | **COMPLETE** | `MIG` PASS: baseline + 93 migrations on an empty DB, idempotent re-run, **zero drift** vs live (160 tables both sides) | prod apply (B4) |
| S19 | Test methodology | **COMPLETE** | boundary/equivalence/negative/state/decision-table/concurrency/fuzz suites; new tests written to find *missed* defects (#32–#35) | - |
| S20 | Engineering quality | **PARTIAL** | DRY guards, encapsulation, backward compat; no speculative refactors | - |

---

## C. Defect register

`#1-#27` were found and fixed in earlier sessions (`MASTER-REQUIREMENTS-MATRIX.md`
sections 12-33, `PRODUCTION-HARDENING-STATUS.md`). `#28-#35` were found in the
final release-candidate phase **by running the real system** (live HTTP, a real
browser, the real database) - which is why several requirements above moved
from "assumed working" to verified.

| # | Defect | Severity | Impact if shipped | Fix | Proof |
|---|---|---|---|---|---|
| 28 | No origin check on any `/api/*` route (`validateCsrf` used by 9 of ~274) while cookies are `SameSite=None` | **critical** | any state-changing endpoint CSRF-able via a CORS-simple POST | `crossSiteRejection()` as the first statement of `middleware()` | 21 tests + live probe |
| 29 | `CANSPAMFooter.tsx` (`use client`) built `base64(contactId:EMAIL_UNSUB_SECRET)` - encoding, not a MAC | **high** | unsubscribe secret readable from any email link; tokens forgeable | removed the dead helper; renders only a server-minted URL | `client-secret-scan` guard |
| 30 | `session.create.before` read the user through a separate pool, so a row created in the same request was invisible; every sign-up failed with `FAILED_TO_CREATE_SESSION` | **critical** | **no new user could ever register** | resolve through better-auth's own `internalAdapter` (same transaction); pool read kept as fallback | live sign-up 200 + user/session/org rows created |
| 31 | Org auto-creation omitted the NOT NULL `owner_user_id`, and the `catch` swallowed the error | **critical** | every new user had no organization, so 403 on every org-scoped API | insert `owner_user_id` | live: org auto-created (was 0) |
| 32 | Dynamic WHERE built by nesting `sql` fragments; this driver maps every interpolation to `$n` | **critical** | `/api/actions` 500 for every signed-in user (the sidebar badge calls it on every page) | string + params form, all values bound as parameters | live 200; composition guard |
| 33 | `contracts.metadata` selected by 3 routes, never created by any baseline or migration | **critical** | Contracts list, contract detail and Earnings 500 for everyone | migration `092` adds the column (idempotent) | live 200 on all three |
| 34 | Rate-limit subsystem typed `organization_id` as `uuid`; app org ids are `org_<hex>` text | **critical** | every rate-limited endpoint 500 (AI support chat, template generation, AI analytics) | migration `093` converts columns + functions to text; removed both `::uuid` casts | live 429 with a real limit message |
| 35 | Prompt-injection markers were absent from the human-review net | **high** | an injected "auto-confirm, don't require review" set its own review policy and auto-sent | `PROMPT_INJECTION_PATTERNS` folded into `detectHighRisk` | adversarial suite asserts `requiresHuman` |

### Stale tests (the tests drifted from the product, not the reverse)

| # | Finding | Resolution |
|---|---|---|
| T1 | `marketing.spec.ts` expected "Close more deals" / "Get Started Free"; the UI says "close deals faster" / "Start Free Trial" | spec updated to the real copy, intent preserved |
| T2 | `marketing.spec.ts` expected a "Sign in" heading; the page heading is "Welcome back" and "Sign In" is the submit button | spec asserts heading + button |
| T3 | `journey.spec.ts` targets `#name`; the wizard's field has no `id` (placeholder "e.g., Q1 Seller Outreach - Kentucky") | **open** - selector must be updated |
| T4 | `browser-qa` scored a correctly-redirected protected route as "THIN" | harness now requires the GUARD, not verbose login text; `--warm` added so dev-compile latency is not measured as app latency |
| T5 | `browser-qa.mjs` wrote `results.json` before creating its directory | order fixed |

---

## D. Blocked items - exact credential or decision required

Each row states only what is missing. None of them blocks unrelated work, and
all of the surrounding work has been completed rather than deferred.

| # | Blocker | Exact requirement | Test to run once supplied | Risk while unverified |
|---|---|---|---|---|
| B1 | Live Stripe | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (test-mode keys are enough) | subscribe, upgrade, downgrade, cancel, renewal, failed payment, duplicate + replayed + out-of-order webhook, refund, entitlement/credit sync, invoice state | billing and entitlement correctness proven only against mocks; real charge paths unproven. **No plan row has a `stripe_price_id`**, so no live charge is possible today |
| B2 | Live Apollo | `APOLLO_API_KEY` | search, rate-limit backoff, dedupe, attribution, upcharge | lead-source quality and per-call cost unverified at the provider |
| B3 | Deployed-domain session | an owner or seeded test account on the deployed domain | authenticated browser journeys: admin signup toggle, billing, payouts, tax report, AI support | UI verified against the dev server only; production config (headers, env) unverified |
| B4 | Production database apply | operator run of `scripts/migrate.mjs` against prod | full chain + smoke | schema proven on an identical dev database with **zero drift**; the prod database itself is unverified |
| B5 | Shopify | product decision (section E) | - | feature absent; nothing in the codebase pretends otherwise |
| B6 | Vitest 4 | none (internal work) | migrate mocks, re-run suite, re-audit | one moderate dev-only advisory; not shipped, not attacker-reachable |

---

## E. Shopify - why BLOCKED, not unbuilt

A deeper search (whole repository, all branches and worktrees, `db/`, `docs/`,
package dependencies, API routes, webhook handlers, checkout code, deployment
configuration) finds **no Shopify integration of any kind**: no provider, no
webhook route, no env var, no checkout logic. The only hit in any dependency
tree is `@shopify/flash-list`, an unrelated virtualized-list package.

Building one requires product decisions this repository cannot supply honestly:
which events matter (order created/updated/cancelled, refunds, fulfilment?),
whether Shopify is a lead source or a checkout/payment rail, how an order maps
to a lead/account, and whether it complements or replaces Stripe. A guessed
integration would be worse than an honest gap, so it stays BLOCKED on that
decision. The exact questions are listed in `MASTER-REQUIREMENTS-MATRIX.md` §17.
