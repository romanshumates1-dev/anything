# PRODUCTION HARDENING - MASTER STATUS MANIFEST

**This is the persistent source of truth for the mission.** Read this first,
then `PRODUCTION-HARDENING-CHECKPOINT.md`, then `ACCEPTANCE-MATRIX.md`.

Status values: NOT_STARTED | IN_PROGRESS | PARTIAL | BLOCKED | UNVERIFIED | COMPLETE
COMPLETE requires evidence. Code existing is NOT completion.

Last updated: 2026-09-27 (session 4). Branch `feat/cloudflare-workers`.`nHeadline: **Browser QA is 70/70. Tenant isolation probe: 15 checks, 0 leaks.**

## A. ORIGINAL 17 REQUESTED ITEMS

| # | Item | Status | Evidence / Remaining work |
|---|---|---|---|
| 1 | AI support + smaller optimized control | UNVERIFIED | Implemented (session 6) + adversarial suite green. Not re-verified in browser this session. |
| 2 | Long username/email sidebar scaling | UNVERIFIED | Implemented. Needs browser check with a long email. |
| 3 | Apollo lead source | BLOCKED | Needs `APOLLO_API_KEY`. Config gating/normalisation/dedup/attribution/credits implemented + tested. Only live credential check remains. |
| 4 | Third-party lead sources + pricing/upcharge | PARTIAL | Buyer discovery + upcharge implemented. Billing path not re-verified. |
| 5 | Free-trial demo/mock data | PARTIAL | 14-day trial created on signup (verified). Demo-data safety not re-audited. |
| 6 | Performance | UNVERIFIED | Original 5-10s complaint. No measurement this session. MUST measure. |
| 7 | Complete site functionality | IN_PROGRESS | Browser QA 68/70 before the pricing fix; 70/70 not yet confirmed. |
| 8 | Shopify / purchases / withdrawals | PARTIAL | Architecture not decided (lead source vs checkout rail). Withdrawals exist. |
| 9 | Subscriptions / billing | UNVERIFIED | Stripe keys absent -> BLOCKED for live; plan gate passed (7 plans). |
| 10 | AI weekly/daily credit limits | PARTIAL | Rate limiter fixed (defect #34). Purchased vs included credit separation not re-audited. |
| 11 | Restricted signup setting | COMPLETE | `app_settings.signup_restrictions` = {restricted:true, domains:[dealswiftautomation.com]}. Verified: non-allowlisted domain -> 403. |
| 12 | Billing/payment UI + backend | PARTIAL | Tax/payout UI shipped (c068aed). Not re-verified. |
| 13 | Payout/earnings date filters | UNVERIFIED | Not checked this session. |
| 14 | Earnings/tax reporting | UNVERIFIED | `/api/tax/report` returns 200 authenticated. Document generation not re-verified. |
| 15 | Optional auto tax withholding | UNVERIFIED | Not checked this session. |
| 16 | Premium UI/VFX/UX polish | IN_PROGRESS | Pricing React-key fix in progress. Full visual audit not done. |
| 17 | SEO | UNVERIFIED | robots/sitemap presence not re-checked this session. |

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

## D. EXTERNAL BLOCKERS (do not stop other work for these)

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
