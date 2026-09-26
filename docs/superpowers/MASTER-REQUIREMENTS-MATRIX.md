# MASTER REQUIREMENTS MATRIX

Generated: 2026-09-25 · Branch `feat/cloudflare-workers` @ `b15fa9f` (+ uncommitted work)

**Method.** Every row was checked against the actual codebase, not against prior status
documents. Evidence is a command output or a file path, never an assumption.

Legend: `Y` verified · `N` not implemented · `P` partial · `—` not applicable

---

## 0. SCOPE CORRECTION (read first)

Two premises in the mission text do not match the repository:

| Stated | Actual evidence |
|---|---|
| "27-phase production-hardening workflow" | The Master Engineering Spec (commit `7e1df0`, `.claude/agents/claude.agent.md`) defines **21 phases, numbered 0–20**. There is no phase 21–27. |
| "A. Original 17 product tasks", "C. Security / secure-by-design addendum" | **Not present in git history.** No file or commit defines a 17-item task list or a security addendum. The spec's own axes (Security, Observability, Performance, Load Testing, Failure Recovery) are used as the substitute. |

This matrix therefore traces the **21 real phases** plus the security/QA/performance axes
that *are* evidenced. Rows for the "17 tasks" and "addendum" would be fabricated, so they
are not invented. If those documents exist outside the repo, supply them and this matrix
will be extended.

**Measured surface (2026-09-25):** 270 API routes · 86 pages · 141 components ·
88 migrations · 191 test files · 2223 passing tests.

---

## 1. PHASE MATRIX (Master Spec phases 0–20)

| # | Requirement | Impl | Tested | Prod-verified | Sec-reviewed | Regr-tested | Evidence | Blocker | Status |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Repository audit | Y | — | — | — | — | `PHASE0_AUDIT.md`, `docs/AUDIT_2026-07-2*.md` | — | **DONE** |
| 1 | Foundation | Y | Y | N | Y | Y | `auth.ts`, `middleware.ts`, `sql.ts`; `auth-client.test.ts` | live auth provider | **DONE (impl+auto)** |
| 2 | Database | P | P | **Y** | Y | Y | 88 migrations; migration `088` applied to real Postgres (PGlite) | Neon prod not reachable | **PARTIAL** — prod schema unverified |
| 3 | Campaign engine | Y | Y | N | P | Y | `campaignEngine.ts`, 22 routes, 5 test files | no prod load | **DONE (impl+auto)** |
| 4 | Import engine | Y | Y | N | P | Y | `ingestion.test.ts`, `contactImport*.test.ts` | — | **DONE (impl+auto)** |
| 5 | Scheduler | Y | Y | N | Y | Y | `jobs.ts`, `cadenceEngine.ts`, `inspectionClock.ts` | — | **DONE (impl+auto)** |
| 6 | Messaging engine | Y | Y | N | P | Y | `engine.ts`, `sms-gateway.ts`; 4 test files | real SMS send | **DONE (impl+auto)** |
| 7 | Seller AI | Y | Y | N | P | Y | `ai-orchestrator.ts`, `ai-orchestrator.test.ts` | no AI provider key | **DONE (impl+auto)** |
| 8 | Buyer AI | Y | Y | N | P | Y | `buyerPipelineEngine.ts` | no AI provider key | **DONE (impl+auto)** |
| 9 | Negotiation engine | Y | Y | N | P | Y | `negotiationEngine.ts`, `negotiationProcessor.ts`; 2 test files | no AI key | **DONE (impl+auto)** |
| 10 | Human approval | Y | Y | N | Y | Y | `approvals/` routes, human-in-loop flag | — | **DONE (impl+auto)** |
| 11 | Contracts | Y | Y | N | P | Y | `contracts/` (7 routes, 8 test files) | no e-sign provider | **DONE (impl+auto)** — e-sign **vuln fixed** this session |
| 12 | Dashboard | Y | N | N | — | Y | 86 `page.tsx`; no page-level tests | browser E2E blocked | **PARTIAL** — UI untested |
| 13 | Analytics | Y | Y | N | P | Y | `v1/analytics`, `analytics/page.tsx` | — | **DONE (impl+auto)** |
| 14 | Security | P | Y | N | Y | Y | 190 test files incl. `__tests__/security/`, new e-sign + marketing guards | no pentest | **PARTIAL** — see §3 |
| 15 | Observability | Y | Y | N | — | Y | `logEvent`, `observability.test.ts`, audit_logs | — | **DONE (impl+auto)** |
| 16 | Performance | P | N | N | — | N | `perf-probe.out` (untracked artifact) | **no measured build/perf/lighthouse evidence** | **PARTIAL** |
| 17 | Load testing | N | N | N | — | N | none found | no k6/artillery, no staging env | **NOT DONE** |
| 18 | Failure recovery | P | P | N | — | Y | `dbRetry.ts`, `jobSupervisor.ts`, `dispatchGate*` | no chaos test | **PARTIAL** |
| 19 | Production hardening | P | Y | N | Y | Y | this mission; 3 defects found+fixed | — | **IN PROGRESS** |
| 20 | Release candidate | N | N | N | — | — | not attempted | gate items below | **NOT DONE** |

---

## 2. MISSION-SPECIFIC REQUIREMENTS (this hardening mission)

| Requirement | Impl | Tested | Prod-verified | Evidence | Blocker | Status |
|---|---|---|---|---|---|---|
| AI credit daily cap (M/20) | Y | Y | **Y (real PG)** | `aiCreditLimits.pglite.test.ts` | — | **DONE** |
| AI credit weekly cap (M/4) | Y | Y | **Y (real PG)** | same, boundary test | — | **DONE** |
| Purchased credits bypass included caps | Y | Y | **Y (real PG)** | `aiCreditGate.pglite.test.ts` | — | **DONE** |
| Unlimited plan never capped | Y | Y | **Y (real PG)** | same | — | **DONE** |
| No-subscription denial (no free credits) | Y | Y | **Y (real PG)** | same | — | **DONE** |
| Concurrent cap enforcement | Y | Y | **Y (real PG, 40 parallel)** | `aiCreditLimits.pglite.test.ts` | single-conn engine; MVCC row-lock verified | **DONE (caveat noted)** |
| Day/week/month boundary rollover | Y | Y | **Y (real PG)** | same | — | **DONE** |
| Rollback / compensating release | Y | Y | **Y (real PG)** | same; floors at 0 | — | **DONE** |
| AI-provider failure compensation | Y | Y | **N** | mocked-provider tests only | **no real provider key** | **PARTIAL** |
| Migration 088 on real Postgres | Y | Y | **Y** | PGlite applies + re-applies | — | **DONE** |

---

## 3. SECURITY ADDENDUM AXES (derived from the spec's own security/testing axes)

| Requirement | Impl | Tested | Evidence | Status |
|---|---|---|---|---|
| SQL injection defence | Y | Y | all queries parameterised (tagged templates); 88 migrations | **DONE** |
| Webhook signature verification | Y | Y | payments + e-sign both verify; both now have mock-in-prod guards | **DONE (fixed this session)** |
| AuthN / AuthZ | Y | Y | `authz.ts`, `requireSession`, API-key scopes, `access-control.test.ts` | **DONE (impl+auto)** |
| Tenant isolation (IDOR) | Y | P | org filter on reads; ledger isolation proven on real PG | **PARTIAL** — 270 routes not all individually reviewed |
| Secret leakage | Y | P | `.env*` example-only; `__create/check-social-secrets` dev-gated 404 | **PARTIAL** — no automated secret scan in CI |
| Data-leak minimisation | Y | Y | exact customer count removed from public endpoint | **FIXED this session** |
| Rate limiting | P | P | `rateLimiter.ts`, `dispatchGate` | **PARTIAL** — not on all routes |
| CSRF | P | P | `csrfProtection.ts`; step-out link now `no-store` + `no-referrer` | **PARTIAL** |

---

## 4. DEFECTS FOUND BY INDEPENDENT ADVERSARIAL REVIEW (this session)

| # | Severity | Defect | Where | Fixed | Regression test |
|---|---|---|---|---|---|
| 1 | **CRITICAL** | Unauthenticated forged contract-signing. `MockEsignProvider.verifyWebhook()` returns `true` for any signature; `ESIGN_PROVIDER` **defaults to `'mock'`**; `/api/esign/webhook` had no production guard. Anyone could POST a `signed` event for any `contract_id` and drive the contract state machine + fire party notifications. | `esign/webhook/route.ts` | **Y** — 503 guard (`ALLOW_MOCK_ESIGN_WEBHOOKS`) | `esign-webhook-security.test.ts` (5) |
| 2 | **CRITICAL** | Unauthenticated **dev-only** mock-sign helper was mounted in production; it builds and fires forged `signed` webhooks for attacker-chosen contract ids. | `esign/mock-sign/route.ts` | **Y** — 404 in production | same |
| 3 | **HIGH** | `authorizeAiRequest` denied any org whose plan had **zero included AI credits**, locking paying customers out of credits they had **purchased**. Directly contradicted the "purchased bypasses included caps" requirement. | `aiCreditGate.ts` | **Y** | `aiCreditGate.pglite.test.ts`, `aiCreditGate.test.ts` |
| 4 | **MEDIUM** | **Fabricated social proof shipped to users**: `/api/marketing/stats` returned a *randomly chosen city* as `lastSignupLocation`; `LiveSocialProof.tsx` rendered it as a live "someone in <city> just signed up" alert. | `marketing/stats/route.ts` | **Y** — now `null` | `marketing-stats-honesty.test.ts` (3) |
| 5 | **MEDIUM** | Public anonymous endpoint published the **exact total customer count** (`activeUsers`) — business-data leak. | `marketing/stats/route.ts` | **Y** | same |
| 6 | **LOW** | Unauthenticated step-out confirmation returned **internal error text** to the caller and served a **cacheable** response containing a one-time token. | `contracts/step-out/confirm/route.ts` | **Y** | existing suite (8) re-run green |

Systematic follow-up scan (`scan-insecure-defaults.cjs`) confirmed only **4** sites app-wide
where a missing env var falls back to a permissive/mock value. The other 3 are safe:
`payments/webhook` (guarded), `billing/subscribe` (fails closed 503 in production),
`esignProvider` factory (guard is at the call site). **That flaw class is closed.**

---

## 5. EXPLICITLY NOT DONE

These are stated plainly rather than implied complete.

- **Load/concurrency testing at scale** (Phase 17) — no tooling or staging target.
- **Browser E2E / full user-perspective journey** — no installable browser in this
  environment (previously confirmed by `browser-probe-status.md`).
- **Live Stripe / Apollo / AI-provider / e-sign verification** — no credentials supplied.
- **Production Neon schema verification** — no prod DB credentials. Migration `088` was
  verified against PGlite (real Postgres, WASM), **not** against the production Neon
  instance.
- **Independent third-party penetration test.**
- **Performance measurement** (build size, Lighthouse, latency percentiles).
- **The 17 product tasks and the security addendum** — not found in the repository; see §0.

---

## 6. VERIFICATION EVIDENCE (commands run, this session)

| Check | Command | Result |
|---|---|---|
| Typecheck | `tsc -p tsconfig.typecheck.json --noEmit` | **EXIT=0** |
| Full unit suite | `yarn test` | **2223 passed, 23 skipped, 30 todo — 191 files — EXIT=0** |
| AI-credit suites (mocked) | `vitest aiCredit*.test.ts credits.test.ts` | **78 passed** |
| AI-credit vs **real Postgres** | `vitest *pglite.test.ts` | **20 passed** (caps, boundaries, 40-way concurrency, release, tenant isolation) |
| E-sign security | `vitest esign-webhook-security.test.ts` | **5 passed** |
| Marketing honesty | `vitest marketing-stats-honesty.test.ts` | **3 passed** |
| Unauthed-route scan | `node scripts/scan-unauthed-routes.cjs` | 270 routes → 16 public-by-design, each reviewed |
| Insecure-default scan | `node scripts/scan-insecure-defaults.cjs` | 4 sites, 3 already safe, 1 fixed |

Every number above is a real command output captured during this session. No figure is
inferred, rounded up, or carried over from a prior status document.

---

## 6. FINDINGS FROM THE AUTHORIZATION CLASS SWEEP (sessions 3-4)

Method: `scripts/scan-authz-class.cjs` flags handlers that resolve a tenant but never
apply it in any statement - the shape behind finding #8 and the `/api/ratelimit` oracle.
The scanner produces HYPOTHESES; each was confirmed by reading the code.

| # | Severity | Defect | Where | Classification | Status |
|---|---|---|---|---|---|
| 11 | **CRITICAL** | Unauthenticated forged contract signing. `PUT /api/esign` had (a) validation wrapped in `if (webhookSecret)` so an unset secret skipped it entirely, (b) the raw shared secret compared by `!==` as the "signature" - not an HMAC, non-constant-time, and (c) no organization predicate on the envelope or lead updates. Any caller could mark any tenant's contract signed, flip its lead, and fire a real email. The file's own comment claimed the check existed. | `api/esign/route.ts` PUT | REAL | **FIXED** - admin auth + tenant-scoped. No app caller existed. `esign-put-forged-signing.test.ts` (5) |
| 12 | **HIGH** | Cross-tenant lead read + **existence oracle**. `GET /api/negotiation/ai-pricing?leadId=` joined leads->campaign_leads->campaigns but never constrained the campaign to the caller's org, despite a comment reading "Verify lead belongs to organization". Any authenticated member of any tenant could read another tenant's lead metadata and probe for lead existence (404 vs 200). | `api/negotiation/ai-pricing/route.ts` | REAL | **FIXED** - `AND c.organization_id = ${organization.id}` |
| 13 | **HIGH** | Cross-tenant lead resolution by non-unique natural key. `resolveLeadIdByPhone` did `SELECT id FROM leads WHERE phone = $phone ORDER BY updated_at DESC LIMIT 1` with no organization filter. Inbound SMS, opt-out suppression and deal-outcome recording could attach to another tenant's lead. | `api/services/stageTransitionRecorder.ts` | REAL | **FIXED** - two-primitive architecture (strict required-org + global set-based), targeted tests (14), full-cycle green |
| 14 | — | `/api/organizations` POST flagged unscoped | — | **FALSE POSITIVE** - CREATE flow; `orgId` is server-generated via `crypto.randomUUID()`, creator is OWNER, and any client `plan` value is coerced to one of two fixed IDs. No pre-existing tenant to scope to. Also implements free-trial seeding (requirement 5). | Closed |
| 15 | — | `/api/feedback` (22 statements) flagged unscoped | — | **FALSE POSITIVE** - scoped by `user_id`; subqueries correlate to already-owned rows | Closed |
| 16 | — | `payments/webhook`, `esign/webhook` flagged unscoped | — | **INTENTIONAL** - tenant derives from the verified event, not the caller | Closed |
| 17 | — | `/api/user/rate-limits` flagged | — | **FALSE POSITIVE** - derives org from the session via `organization_members` | Closed |

### Finding 13 - remediation plan — RESOLVED 2026-09-26
Implemented the two-primitive architecture:
1. `resolveLeadIdByPhone(phone, organizationId)` — organization REQUIRED, fails closed without
   one. Six strict call sites threaded (`outreach/campaigns`, `[id]/contacts`, `scheduler`,
   `inbound`, `dealOutcomes` + its `DEAL_AGREED`/`DEAL_NO_AGREEMENT` contact UPDATEs scoped).
2. `resolveLeadIdsByPhoneGlobal(phone)` — returns EVERY match, no LIMIT 1. The two webhook
   opt-out paths and the `sns-inbound` human-request path use it. The human request acts
   ONLY on exactly-one match, logging `human_request_ambiguous` otherwise.
Bonus same-file finding while threading: `markDealAgreed`'s
`UPDATE campaign_contacts ... WHERE id = ${contactId}` was also unscoped; scoped the same way.
Tests: `leadPhoneTenantIsolation.test.ts` (14) + repaired caller suites (5 files green).
Residual (now **RESOLVED 2026-09-26**): `sms/inbound:101` simulator-secret `!==` comparison
triggered a class-wide sweep — see §8 SECRET-COMPARE TIMING SWEEP below (12 sites / 9 files,
all converted to `timingSafeSecretEqual`, 2 fail-open sites closed, ratchet guard added).

---

## 7. FINDING 13 - CALLER-BY-CALLER TENANT-SOURCE ANALYSIS

Traced all 8 call sites of `resolveLeadIdByPhone` and established where the tenant is
legitimately available. This is the pre-fix analysis an independent reviewer needs.

| Call site | Tenant source | Class | Correct treatment |
|---|---|---|---|
| `outreach/campaigns/[id]/contacts/route.ts:106` | `organization_id` already inserted on `campaign_contacts` (L88) | **STRICT** | scope to caller org |
| `outreach/campaigns/route.ts:157` | `organizationId` in scope (L140, L146) | **STRICT** | scope to caller org |
| `outreach/scheduler/route.ts:118` | `organizationId` in scope (L101, L112) | **STRICT** | scope to caller org |
| `outreach/inbound/route.ts:49` | `organizationId` in scope (L31, passed to `processInboundSms`) | **STRICT** | scope to caller org |
| `services/dealOutcomes.ts:44` | needs confirmation of caller chain | UNRESOLVED | trace before change |
| `sms/inbound/route.ts:133` | **NONE - Twilio webhook, no caller org** | **GLOBAL BY DESIGN** | see below |
| `sms/sns-inbound/route.ts:165` | **NONE - SNS webhook** | **GLOBAL BY DESIGN** | see below |
| `sms/sns-inbound/route.ts:181` | **NONE - SNS webhook** | **GLOBAL BY DESIGN** | see below |

### Why the webhook paths must NOT simply be scoped
`sms/inbound` L120-128 runs the TCPA opt-out gate BEFORE any lead lookup:
```sql
UPDATE campaign_contacts SET status = 'OPTED_OUT', opted_out_at = now()
WHERE phone = ${from} AND status NOT IN (...)
```
This is intentionally cross-tenant ("best-effort, all orgs") and that is CORRECT: a person
sending STOP must be suppressed platform-wide. Suppression is a person-level right, not a
tenant-level one, and over-suppression is the safe direction - it can only prevent
sending, never expose data or corrupt a balance.

The real defect at L133 is an ASYMMETRY, not the missing filter:
- suppression is global and correct;
- funnel attribution via `resolveLeadIdByPhone(from)` is global and ARBITRARY, so a STOP
  arriving on org A's number can write a closed-lost stage transition onto org B's lead.

### Fix APPLIED 2026-09-26 — independent re-review still pending
Two distinct primitives rather than one ambiguous lookup (both implemented):
1. `resolveLeadIdByPhone(phone, organizationId)` - STRICT, tenant-scoped. Used by the 4
   callers that legitimately know their organization.
2. A GLOBAL variant for the opt-out path that returns ALL leads matching the phone, so
   attribution is symmetric with the global suppression rather than arbitrary. Rejecting
   attribution when ambiguous is also acceptable, but silently picking one tenant is not.
Phase 2 note (RESOLVED 2026-09-26): `sms/inbound` L101 compared a shared secret with `!==`.
The follow-up sweep found the same pattern at 11 further sites — including two fail-open
cron gates and a `"Bearer undefined"` acceptance — all now use `timingSafeSecretEqual`
(see §8).

---

## 8. SECRET-COMPARE TIMING SWEEP (2026-09-26)

The `sms/inbound:101` residual was fixed and the whole class swept. Twelve sites across nine
files authenticated with raw `===`/`!==` against a shared secret (timing oracle) — two of them
additionally failed open:

| # | Sev | Site | Defect | Fix |
|---|-----|------|--------|-----|
| 1 | MED | `sms/inbound/route.ts` | simulator secret `!==` (tracked residual) | `timingSafeSecretEqual` |
| 2 | MED | `outreach/keyword-inbound/route.ts` | JSON-branch secret `!==` | same |
| 3 | MED | `compliance/opt-out/route.ts` | secret `!==` (suppress-any-number endpoint) | same |
| 4 | MED | `email/inbound/route.ts` | query `?s=` secret `!==` (also: unset env could compare `null !== undefined`) | same |
| 5 | MED | `email/ses-events/route.ts` | secret `!==` | same |
| 6 | MED | `cron/earnings/route.ts` | `cronSecret !== expectedSecret` | same |
| 7 | LOW | `system/cron/route.ts` | `provided !== CRON_SECRET` | same |
| 8 | **HIGH** | `campaigns/automation/cron/route.ts` | **FAIL-OPEN**: `if (CRON_SECRET && provided !== CRON_SECRET)` — unset secret skipped auth entirely → unauthenticated bulk-campaign trigger | fail closed outside development + timing-safe |
| 9 | MED | `jobs/process/route.ts` | `headerSecret === jobSecret` + `bearer === \`Bearer ${cronSecret}\`` (fail-closed already OK) | timing-safe both |
| 10 | **HIGH** | `pipeline/cron/route.ts` | `authHeader === \`Bearer ${cronSecret}\`` accepted the literal **`Bearer undefined`** when `CRON_SECRET` unset in production | fail closed in production + timing-safe |
| 11 | LOW | `utils/authz.ts` (×2) | local-dev bypass header `===` (dev-gated) | timing-safe |
| 12 | LOW | `lib/organization-context.ts` | same local-dev bypass | timing-safe |

- Helper: `apps/web/src/app/api/utils/secretCompare.ts` — SHA-256 both sides →
  `crypto.timingSafeEqual`; **fails closed** on missing/empty values (an env secret set to `''`
  can no longer authenticate an omitted credential).
- Ratchet: `src/app/api/__tests__/security/secret-compare-guard.test.ts` statically scans all
  of `src/` for raw `===`/`!==` against secret-shaped operands (comments excluded) and asserts
  all 12 sites still import the helper — reintroduction fails the build.
- Tests: `utils/secretCompare.test.ts` (8). Full suite green: **202 files / 2301 passed,
  0 failed** (23 skipped, 30 todo). `tsc -p tsconfig.typecheck.json --noEmit` clean.
- Doc fix found during the sweep: `DEPLOY.md` told operators to subscribe
  `/api/sms/inbound?secret=...` for Twilio/SNS — that route never reads `?secret=` (Twilio is
  signature-gated; SNS belongs on `/api/sms/sns-inbound`). Corrected.
- Known residual (accepted): `email/inbound` and `email/ses-events` accept the secret as a
  **query parameter** (`?s=`) because email/SNS providers can only be configured with a URL —
  query strings land in proxy/access logs. Mitigation: keep `SMS_INBOUND_SECRET` high-entropy
  (preflight enforces ≥8 chars, DEPLOY recommends `openssl rand -hex 16`); header path
  (`x-sms-secret`) preferred where the caller supports it. Changing the contract would break
  live integrations (mission guard: preserve functionality).

---

## 9. SESSION-4 SWEEP — portal credentials, cross-tenant disclosure, fabricated data, money authority

Class-based follow-up to §8 (same method: every finding re-expressed as "who else does
this?" and swept across the tree). Full defect table with severities: see
`PRODUCTION-HARDENING-STATUS.md` → "session 4". Summary of what changed:

| Finding | Class | Evidence of fix |
|---|---|---|
| Portal offer links were unsigned base64 and a bare `?leadId=` needed no token at all — anonymous cross-tenant **read and mutate** (accept/counter/decline) | unsigned public credential | `utils/portalToken.ts` (HMAC + TTL + timing-safe, fail-closed), GET/POST require signed token or org-scoped session; minting path signs. Ratchet: `__tests__/security/portal-token-guard.test.ts` (9 tests) |
| Portal closing session path read/mutated any tenant's closing by lead id | IDOR on session path | ownership check added in `portal/closing/route.ts` GET+POST |
| Leaderboard ranked the whole platform (name, revenue, deals) | cross-tenant disclosure | `api/leaderboard/route.ts` scoped to org (board, rank CTE, totalUsers) |
| Leaderboard page rendered 20 invented people/revenue | fabricated data in UI | mock array deleted; real API + honest empty state |
| `/api/comps` returned randomly generated comps in production | fabricated market data | `utils/syntheticData.ts` gate; 503 `COMPS_UNAVAILABLE` in production |
| lead-finder fabricated leads into `sourced_leads` (3 routes) | fabricated data | same gate via `ALLOW_SIMULATED_LEADS` (dev-only) |
| `/api/payments/stripe` POST charged a caller-supplied amount | caller-controlled money | fee derived from buyer contract via `utils/assignmentFee.ts` (shared with charge-assignment); org-scoped dedupe lookup |
| `territories/[id]` unscoped UPDATE/DELETE; lead-finder `sourced_leads` unscoped reads incl. caller ids | missing tenant predicate | org predicate on mutations; source-ownership subquery on all 5 lead-finder queries |

Verification: `tsc -p tsconfig.typecheck.json --noEmit` EXIT=0 · security suite 9 files /
0 failed · payments 2 files / 0 failed · full suite re-run logged in `apps/web/_tfull.log`.

New accepted residual: DB-stored `closings.portal_access_token` rows with
`portal_token_expires_at IS NULL` do not expire (random, DB-bound, but rotation is manual).


---

## 10. SESSION-5 SWEEP — synthetic data boundaries & Defect #26 (2026-09-26)

- **Defect #26 (Synthetic Lead Generation Gate)**:
  - Background: Scrutiny of lead-generation pathways revealed that `api/campaigns/mega-launch/route.ts` and `api/scraper/simulate/route.ts` inserted simulated leads into the database when `syntheticDataAllowed()` was satisfied. In production environments where simulated data was disabled, callers could still hit these routes if the gate wasn't checked before executing generation routines.
  - Fix: Both routes now strictly enforce `syntheticDataAllowed()`, returning `403 Forbidden` (`SYNTHETIC_DATA_FORBIDDEN`) before any simulator logic executes.
  - Ratchet: Added `apps/web/src/app/api/__tests__/security/synthetic-lead-gate.test.ts` scanning every consumer of synthetic generators (`mockLead`, `generateSampleProperties`, etc.) to guarantee every call site is gated by `syntheticDataAllowed()`.
  - Evidence: Full test suite rerun passed cleanly with **2,340 tests passed / 0 failed across 209 test files**.

---

## 11. SESSION-6 SWEEP — multi-tenant matrix, test repairs, CSP & security headers (2026-09-26)

- **Test Suite Structure Repair (`tenant-isolation-2026-09-26.test.ts`)**:
  - Identified malformed nested `describe` blocks inside an incomplete `it('merges when every id belongs to the caller')` test case.
  - Repaired test block nesting, unblocking 5 shadowed tests in TCPA and outreach campaign isolation suites.
  - Verified suite now runs all **10/10 tests green**.

- **Multi-Tenant Route Matrix Test Suite (`multitenant-matrix.test.ts`)**:
  - Implemented comprehensive multi-tenant route matrix test suite running against real PGlite PostgreSQL.
  - 16 distinct matrix cases validating cross-tenant boundaries between Org A and Org B:
    - `GET /api/leads/[id]` (ownership, cross-tenant 404 anti-oracle)
    - `PATCH /api/leads/[id]` (cross-tenant 404, zero state mutation in DB)
    - `GET /api/campaigns/[id]` (ownership, cross-tenant 404)
    - `PATCH /api/campaigns/[id]` (cross-tenant 404, zero state mutation in DB)
    - `GET /api/territories/[id]` (cross-tenant 404)
    - `PATCH /api/territories/[id]` (cross-tenant 404, zero state mutation)
    - `DELETE /api/territories/[id]` (cross-tenant 404, zero state deletion)
    - `GET /api/actions/[id]` (cross-tenant 404)
    - `POST /api/actions/[id]` (cross-tenant 404 execution denial)
    - `GET /api/portal/closing` (session-based cross-tenant 404 Lead not found)
    - `POST /api/portal/closing` (session-based cross-tenant 404 mutation denial)
  - Result: **16/16 tests passed in 4.46s**.

- **Production Security Headers & CSP Regression Ratchet (`regression-guards.test.ts`)**:
  - Evaluates `next.config.js` headers dynamically during test execution:
    - Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`.
    - Enforces CSP directives: `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, and explicitly pins `https://static.cloudflareinsights.com` in `script-src` and `connect-src` to guarantee Cloudflare Workers Web Analytics operates without CSP violation.
    - Enforces API `Cache-Control: no-store, no-cache, must-revalidate`.
  - Result: **7/7 regression guard tests passed**.

- **Browser QA & E2E Pathway Verification**:
  - Confirmed headless browser automation harness (`scripts/browser-qa.cjs`) drove real Chromium/Edge across 13 public routes and 3 viewport widths (375px, 768px, 1440px).
  - Verified authz E2E (`authz.e2e.test.ts` - 9 tests) and wholesale pipeline E2E (`full-wholesale-pipeline.test.ts` - 1 test) pass cleanly against synthetic organizations on real Postgres.

- **Current Security Ratchet Status**:
  - **12 dedicated security test files / 123 tests passed / 0 failed**:
    1. `aggregate-oracle-guard.test.ts` (4 passed)
    2. `auth.test.ts` (23 passed)
    3. `credits.test.ts` (30 passed)
    4. `financial-authority-2026-09-26.test.ts` (9 passed)
    5. `financial-invariant-guard.test.ts` (5 passed)
    6. `lead-insert-org-guard.test.ts` (2 passed)
    7. `multitenant-matrix.test.ts` (16 passed)
    8. `portal-token-guard.test.ts` (9 passed)
    9. `regression-guards.test.ts` (7 passed)
    10. `secret-compare-guard.test.ts` (5 passed)
    11. `synthetic-lead-gate.test.ts` (3 passed)
    12. `tenant-isolation-2026-09-26.test.ts` (10 passed)


