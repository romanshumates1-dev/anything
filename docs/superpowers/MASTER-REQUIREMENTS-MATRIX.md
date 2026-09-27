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



---

# PART 2 — ORIGINAL PRODUCT REQUIREMENTS TRACEABILITY (final release gate, 2026-09-26)

The earlier §0 scope note recorded that the "17 original product tasks" were **not present in git
history** and declined to invent them. The user has since restated them in conversation, so they are
now traceable against code. Source of truth for this part is the user's directive, not the repo.

**Status discipline used below.** `COMPLETE` requires automated evidence *and* a verification tier
that matches what the row claims. Code existing is never sufficient. Where a row is only code- or
test-verified, it says so. `BLOCKED` means an external dependency (credential, account, environment)
prevents verification and is not a statement that the feature is absent.

**Verification tiers:** CODE VERIFIED · TEST VERIFIED · SANDBOX VERIFIED · STAGING VERIFIED ·
PRODUCTION VERIFIED · EXTERNALLY BLOCKED

| # | Original requirement (user-stated) | Impl | Test tier | Prod tier | Evidence | Blocker | Status |
|---|---|---|---|---|---|---|---|
| 1 | AI support works, smaller improved design | Y | TEST VERIFIED | EXTERNALLY BLOCKED | `api/support/chat/route.ts`; rate-limited via `checkRateLimit`; suite green | No live AI provider key in env | **PARTIAL** |
| 2 | Long username/email sidebar issue fixed | Y | CODE VERIFIED | UNVERIFIED | `Shell.tsx` truncation (per prior session) | No authenticated browser session | **UNVERIFIED** |
| 3 | Apollo included as a lead source | Y | TEST VERIFIED | EXTERNALLY BLOCKED | `lead-finder/apollo/{client,config,normalize,route}.ts` + 4 test files | `APOLLO_API_KEY` absent from `.env` | **PARTIAL** |
| 4 | Third-party lead-source billing/upcharge correct | Y | TEST VERIFIED | EXTERNALLY BLOCKED | `tierLimits.ts`, `billing/*`; 73/73 focused regression prior | Stripe key absent | **PARTIAL** |
| 5 | Free-trial demo/sample experience safe | Y | TEST VERIFIED | UNVERIFIED | `synthetic-lead-gate.test.ts` (3) enforces `syntheticDataAllowed()` at every mock generator call site | — | **COMPLETE** (code+test) |
| 6 | Performance improved where evidence supports | N/A | — | — | **Dev server logged "Slow filesystem detected (13976ms)"**. No production p50/p95 captured | No production/staging host access | **UNVERIFIED** |
| 7 | Every major website page works | Y | PARTIAL | UNVERIFIED | Browser QA via system Edge: 10/13 routes, 12x HTTP 200, 0 page errors, 0 net failures. `/` returned ERR (0 bytes); `/api/system/health` hung | Dev-mode shells (200-300 B) are compile placeholders; no auth session | **PARTIAL** |
| 8 | Payment/subscription systems work | Y | TEST VERIFIED | EXTERNALLY BLOCKED | Mock provider + webhook paths tested; `mock-checkout` + `/complete` hard-404 in production; boot log `STRIPE_SECRET_KEY not set` | No Stripe test/live keys | **PARTIAL** |
| 9 | Shopify addressed honestly | **N** | NONE | NONE | Word-boundary search across `src/` + `db/`: **zero** Shopify references | Feature absent from codebase | **BLOCKED - NOT IMPLEMENTED** |
| 10 | Withdrawals/payouts work | Y | TEST VERIFIED | UNVERIFIED | `withdrawals/route.ts`; this session added full bank-account path; 36 bank-account tests | No live payout processor | **PARTIAL** |
| 11 | Console/site errors addressed | Y | PARTIAL | UNVERIFIED | 0 page errors across 10 browser-QA routes; 1 console error on `/pricing` (dev-mode) | — | **PARTIAL** |
| 12 | Campaign/contact/lead-finder/contracts/admin UI redesign | Y | CODE VERIFIED | UNVERIFIED | 141 components; `2026-08-29-ux-overhaul-design.md` | No authenticated visual review | **UNVERIFIED** |
| 13 | Daily/weekly/monthly AI-credit controls | Y | TEST VERIFIED | EXTERNALLY BLOCKED | `aiCreditLimits.ts`, `aiCreditGate.ts`, migration `088`; 20 PGlite tests incl. 40-way concurrency granting exactly 5 | Migrations not applied to prod Neon | **PARTIAL** |
| 14 | Purchased credits retain intended access | Y | TEST VERIFIED | EXTERNALLY BLOCKED | `aiCreditGate.pglite.test.ts` — purchased credits bypass included caps, oversell-proof under 20-way concurrency | Prod DB not applied | **PARTIAL** |
| 15 | Restricted-signup admin toggle works | Y | TEST VERIFIED | UNVERIFIED | `signup-restrictions.ts` is single source of truth; consumed by `middleware.ts`, `authz.ts`, `adminGuard.ts`, `email-domain-policy.ts` | ON/OFF paths unverified at runtime | **PARTIAL** |
| 16 | Billing UI/functionality works | Y | CODE VERIFIED | EXTERNALLY BLOCKED | `billing/plans`, `billing/subscribe`; plan-canonicalization fix prior | No Stripe key | **PARTIAL** |

## 12. Final release-gate findings (2026-09-26)

### Defects found AND fixed this gate
1. **HIGH — verification attempt cap was defeatable (bank accounts).**
   `POST /api/bank-accounts/[id]/verify` reset `verification_attempts = 0` in the *initiate* branch
   while the cap check read that same column. The loop *initiate -> wrong guess -> initiate* therefore
   never reached `MAX_VERIFICATION_ATTEMPTS`, and the 9,801-pair amount space became brute-forceable.
   The pre-existing 429 test passed because it only ever incremented and never re-initiated - a
   textbook absence-of-error/pesticide case. Fixed by removing the reset; pinned by
   `bank-accounts-lifecycle.test.ts` ("initiating a NEW verification does not reset the counter"),
   observed RED before the fix and GREEN after.
2. **HIGH — stored XSS on a public unauthenticated page.**
   `GET /api/contracts/step-out/confirm` interpolated `propertyAddress` (agent-supplied contract data)
   into `text/html` unescaped. The page is reached from a one-time email link with **no session**, so
   anyone able to set a property address could execute script in every recipient's browser. Fixed via
   the existing `escapeHtml` util (also applied to `baseUrl`); pinned by a new test observed RED then
   GREEN.

### Findings reported, NOT fixed (with reasons)
3. **Reflected XSS in `esign/mock-sign`** - `contractId`/`envelopeId` interpolated unescaped. Hard-404s
   when `NODE_ENV=production`, so not reachable in a production deploy. The file is platform-managed
   and marked "DO NOT REWRITE THIS FILE"; escalating rather than editing.
4. **API-key rate limit is stored but never enforced.** `api_keys.rate_limit_per_min` is written by
   `settings/api-keys` and echoed by `/api/v1/auth`, but no middleware consults it. `checkRateLimit`
   is wired only to three AI routes (`ai-recommendations`, `support/chat`, `templates/generate`).
   The public `/api/v1/*` surface is therefore unthrottled. Needs a fail-open vs fail-closed design
   decision and a multi-route change, so it is not made unilaterally at a release gate.

---

# PART 3 — CONTINUATION SESSION (2026-09-26, release gate round 2)

## 13. RETRACTION: my previous rate-limit finding was WRONG

The round-1 report claimed "`rate_limit_per_min` is stored but never enforced; the public
`/api/v1/*` surface is effectively unthrottled." **That claim was incorrect and is retracted.**
It came from grepping for `rate_limit_per_min` and not following the data to `middleware.ts`,
where the enforcement actually lives:

- `src/middleware.ts:107` `enforceRateLimit()` — per-KEY sliding window (correctly keyed by
  API key, NOT by IP, so NAT-sharing tenants cannot starve one another), returning 429 with
  `Retry-After` and `X-RateLimit-*`. It records a hit only when allowed, so a blocked caller
  cannot push its own reset forward.
- `src/middleware.ts:336` routes `/api/v1/*` -> `enforceRateLimit`, everything else ->
  `enforceAccessGate`.
- `src/app/api/__tests__/rateLimit.test.ts` (13 tests) already asserts per-key isolation, the
  N+1 boundary, 401-before-spend, and matcher scope.

Verified: 23 tests green across that suite plus the new one. Recorded here rather than quietly
dropped, because reporting an unverified conclusion as a finding is exactly what the
absence-of-error fallacy warns about.

## 14. What was ACTUALLY wrong, and is now fixed

The real gap is subtler than "not enforced": the middleware limiter is correct but its state is
a module-level `Map` (`const buckets = new Map<string, number[]>()`). This project deploys to

## 15. Performance: the 5-10s navigation problem is a DEV-MODE ARTIFACT

The earlier browser run was invalid because it measured Turbopack on-demand compile shells
(200-300 byte responses). Re-measured properly by pre-warming routes, then timing:

| route | cold (first hit, incl. compile) | warm (compiled) |
|---|---|---|
| `/` | 14,724 ms | **1,126 ms** |
| `/pricing` | 11,729 ms | **601 ms** |
| `/features` | 27,950 ms | **451 ms** |
| `/about` | 14,511 ms | **343 ms** |
| `/contact` | 2,628 ms | **330 ms** |
| `/account/signin` | 6,446 ms | **220 ms** |
| `/account/signup` | 1,202 ms | **214 ms** |
| `/privacy` | 848 ms | **213 ms** |
| `/terms` | 4,231 ms | **175 ms** |
| `/dashboard` | 6,816 ms | **179 ms** |

**Warm: min 175 ms, max 1,126 ms (n=10).** The 5-10+ second navigation complaint is caused by
on-demand compilation in `next dev`, NOT by application or query performance. Production builds
have no on-demand compile, so this must not be reported as a production symptom. The dev server
also emitted `Slow filesystem detected (13976ms)` — a local disk characteristic.

All 10 routes return 200 with **real rendered content** (18 KB - 105 KB), confirming the app
renders. `browser-qa.cjs` still reports `bytes=300` for the same URLs that curl measures at
105,592 bytes, so **the harness's byte metric is unreliable** and must not be used as
page-rendering evidence.

## 16. Tax reporting + auto-withholding: now implemented (was NOT IMPLEMENTED)

Owner requirements for an earnings/tax-reporting document, optional auto-tax withholding, and
transparent withholding visibility were entirely absent. Now delivered:

- `db/migrations/090_tax_withholding.sql` — `tax_withholding_settings` (rate in basis points,
  CHECK 0..10000) and `tax_withholding_ledger` (append-only, `idempotency_key` UNIQUE for replay
  safety, `kind` in WITHHELD/RELEASED/ADJUSTMENT, positive amounts with direction carried by
  `kind`, and `period_qualified` frozen at write time).
- `src/app/api/utils/taxWithholding.ts` — pure policy layer, no DB/clock/randomness, so the money
  rules are exhaustively testable: integer cents only, integer basis points, FLOOR rounding
  (seller never over-withheld by a fraction of a cent), provably lossless `splitWithholding`,
  balance floor at zero so a replayed release can never become money the platform owes, and a
  deterministic idempotency key.
- `src/app/api/utils/__tests__/taxWithholding.test.ts` — 25 tests including a 12x9 losslessness
  grid asserting `net + withheld === gross` for every pair.

**Deliberately NOT claimed:** no tax liability is computed, no rate is assumed universal (rates
are configuration), and the report carries an explicit "this is an ESTIMATE, not a tax form"
disclaimer. No route or UI yet wires the ledger into the withdrawal flow — the money math and
schema are done and tested; withdrawal integration and the report endpoint remain.

## 17. Shopify: reconnaissance complete, still NOT IMPLEMENTED

Searched all branches, all 6 worktrees, git history (`-S shopify -i`), the desktop app, every
`package.json`, and synonyms (ecommerce, store, storefront, merchant, fulfillment, order webhook,
commerce). The ONLY hit anywhere is `@shopify/flash-list` inside a yarn cache zip in another
worktree — an incidental virtualized-list dependency, not an integration. There is no Shopify
code to recover. This is **NOT IMPLEMENTED**, blocked by missing implementation (not an external
blocker), and remains the largest untouched product requirement.

**Cloudflare Workers** (`npm run cf:deploy` -> opennextjs-cloudflare), where middleware runs on
the edge runtime and that Map is per-isolate: not shared across isolates or PoPs, and lost on
eviction. The repo already documents this hazard in `utils/rateLimit.ts`: "an in-memory Map ...

## 18. `error.message` leak audit — COMPLETE (17 sites, 274 route files scanned)

Scanned every non-test `.ts`/`.tsx` under `src` (755 files), then narrowed to the 274
`route.ts` HTTP handlers, for `error: <ident>.message` reaching a response body.

| Site | Verdict |
|---|---|
| `payments/charge-assignment/route.ts:299,307` | **SAFE** — guarded by `error.type === 'StripeCardError'`; comment documents the intent; every other error falls through to `safeErrorResponse`. |
| `payments/buyer-payment/route.ts:176` | **SAFE** — same guarded Stripe-decline pattern. |
| `support/chat:71`, `analytics/ai-recommendations:65`, `templates/generate:31` | **FALSE POSITIVE** — `rateLimitResult.message` is the app's OWN curated limiter string, not a caught exception. |
| `outreach/verify/email/dns:154,182` | **FALSE POSITIVE** — `error.message?.includes('credentials')` is a *boolean* selecting a canned safe string; the raw message is never returned. Good pattern. |
| `settings/outreach/email/test` (5) + `settings/outreach/sms/test` (4) | **GENUINE, LOW** — returns raw Twilio/SES error text to the caller. |

**The one real finding (LOW):** the two `settings/outreach/*/test` routes echo third-party SDK
error messages verbatim, while the rest of the codebase standardizes on `safeErrorResponse`.
Twilio error strings routinely embed the destination phone number, and SES/credential errors can
embed account identifiers. Mitigating: the routes are authenticated, tenant-scoped, and exist
solely so the tenant can debug their own integration — so the information is largely the caller's
own. Not a release blocker; it is a consistency gap. Recommended follow-up: apply the same
canned-message treatment used in `outreach/verify/email/dns`, or route through `safeErrorResponse`
while keeping the underlying detail in the server log.

gives ~zero protection under Vercel, where each invocation can land on a fresh isolate with no

## 19. New finding: 3 "ratchet" guard tests are a latent CI flake

A full-suite run launched CONCURRENTLY with `tsc` produced 3 failures. All three were
`Test timed out in 5000ms` — no assertion failed:

- `src/app/api/__tests__/security/lead-insert-org-guard.test.ts`
- `src/app/api/__tests__/security/secret-compare-guard.test.ts`
- `src/app/api/__tests__/security/synthetic-lead-gate.test.ts`

Re-run alone: **3 files / 10 tests passed in 2.79 s** (tests themselves 1.89 s). Re-run as a
clean full suite with no competing load: **214 files / 2434 passed / 0 failed**.

So they are not broken — but they are filesystem-walking tests that walk the whole `src` tree,
and they have roughly **2.8x headroom against a 5 s budget on an idle box, and none at all under
concurrent load**. They will flake in CI, where test runners are always oversubscribed. This is
a genuine latent defect and is recorded as such rather than dismissed as "flaky, re-running
passed". Recommended fix: give these three a `testTimeout` of 20–30 s (they are bounded tree
walks, not hangs), or narrow the glob they scan.

**Note on the wider implication:** this also means the earlier "213 files / 2409 passed / 0
failed" and any run made alongside other heavy work should be read as load-sensitive. The
authoritative green run is the isolated one above.

## 20. Verified final gate state (2026-09-26)

---

# PART 4 — RELEASE GATE ROUND 3 (2026-09-26)

## 21. CI FLAKE — ROOT-CAUSED AND FIXED (was: 3 timeouts under concurrent load)

**The vitest config deliberately keeps the strict 5s budget.** Its own comment: *"a mocked
test that takes >5s is a real hang and must still fail."* So raising the timeout would have
violated the repo's stated design intent. The fix had to be efficiency.

**Root cause (measured, not guessed).** Six guard tests each shipped a near-identical `walk()`
that traversed the whole `src` tree with `readdirSync` + `statSync`. Three called it at MODULE
LOAD, so the cost was paid during *collection* — visible in the suite's own timing split of
`collect 106.62s` vs `tests 76.53s`.

Benchmarked on this machine (755 files / 5.86 MB under `src/`):

| traversal | cost |
|---|---|
| `statSync` (the original) | 432–638 ms per walk |
| `readdirSync(dir, {withFileTypes:true})` | **113–132 ms per walk (~4x faster)** |

`withFileTypes` returns each entry's type from the syscall that already listed the directory,
eliminating one `statSync` round-trip per file — the dominant cost on Windows.

**Fix:** one shared, memoized scanner (`__tests__/security/_sourceScan.ts`) replacing all six
copies, plus a provably-sound whole-file prefilter in secret-compare (a file containing none of
`secret`/`signature`/`bearer` cannot contain a violation, since every pattern requires one).

**Coverage was PROVEN not weakened — three independent ways:**
1. A temporary probe deep-equality-compared the new file set against the original walk's output:
   **755 = 755, arrays identical.**
2. **Fault injection**: a file containing `provided !== process.env.CRON_SECRET` was temporarily
   created; the guard correctly FAILED and reported `utils/__faultinject__.ts:1`. File removed.
3. Each guard now asserts a **minimum scan size** (`> 600` / `> 300`), so a ratchet can never
   again pass *vacuously* by scanning nothing.

**Flake behaviour, before → after:**

| scenario | before | after |
|---|---|---|
| 3 guards, isolated | 2.79 s | **1.58–1.81 s** (repeat runs) |
| 3 guards, concurrent with `tsc` | **3 x `Test timed out in 5000ms`** | **PASS, 2.23 s** |

## 24. Adversarial review: latent IDOR in `getEffectiveOrganizationId` (FIXED)

`src/lib/organization-context.ts` exported:

```ts
export async function getEffectiveOrganizationId(explicitOrgId?: string | null) {
  if (explicitOrgId) return explicitOrgId;      // <-- no membership check
  const org = await getOrganization();
  return org?.id || null;
}
```

Its own docstring advertised the behaviour — *"Priority: explicit orgId > session context"* —
so any route passing a request-controlled value straight in would have been a textbook IDOR: a
caller could read or write another organization's data by simply supplying its id. The id was
returned as an **answer**, when it should only ever be treated as a **request for access**.

**Blast radius at discovery: zero.** A repo-wide search found no callers outside the definition
itself, so nothing was exploitable today. It was, however, a loaded gun with the safety off, and
the next developer to reach for a "get the org id" helper would have inherited a cross-tenant
data leak with a reassuring name and a helpful docstring.

**Fix:** an explicit org id is now honoured only when the session user is genuinely a member of
that organization, or is a platform `ADMIN`. Anything else falls back to the org the session is
actually entitled to. Both new helpers **fail closed** on a database error — a query failure must
never be misread as "is a member" or "is an admin", which would silently re-open the hole.

**Verified:** typecheck 0 errors; the 4 pre-existing tenant-isolation suites (analytics/advanced,
regions/estimate, leadPhone, admin/organizations) still pass — 28 tests.

| all 6 guards | — | **PASS, 23 tests, 3.09 s** |
| FULL suite + `tsc` + `build`, all 3 concurrent | 3 failures | **214 files / 2434 passed / 0 failed** |

No timeout was inflated, no assertion weakened, no test skipped, no retry added.

**Collateral fix:** the same PowerShell `Get-Content -Raw` round-trip that corrupted files
earlier had also mangled UTF-8 em-dashes into mojibake in `synthetic-lead-gate.test.ts` and in
migration `090`. Both were detected by a codepoint scan and repaired; migration 090's decorative
box rules were normalised to ASCII. All touched files verified non-ASCII-clean.

## 22. Tax withholding: feature COMPLETE (schema -> money -> persistence -> APIs -> withdrawal)

**This found and fixed a real financial-reporting bug.** The first implementation of the
withdrawal hook set `taxWithheldCents` *before* awaiting the ledger write, so when the write
threw, the response still reported 15 000 withheld and a net payout of 85 000 for a withdrawal
that was in fact paid out at the full 100 000. The fail-open test caught it. The fix assigns the
response figures **only after a confirmed insert**, and resets defensively in the catch.

Delivered:
- `db/migrations/090_tax_withholding.sql` — settings + append-only ledger, UNIQUE
  `idempotency_key`, positive-amount CHECK, `period_qualified` frozen at write time.
- `utils/taxWithholding.ts` — pure policy: integer cents, basis points, floor rounding,
  lossless split, zero-floored balance, deterministic idempotency key.
- `utils/taxWithholdingStore.ts` — persistence only, no arithmetic and no policy; every
  aggregate tenant-filtered in SQL; writes via `ON CONFLICT (idempotency_key) DO NOTHING`.
- `api/tax/settings/route.ts` — GET/PUT. Org comes from the session **only**; rate validated
  0..10000; unknown body fields ignored (mass-assignment guard).
- `api/tax/report/route.ts` — GET with day/week/month/quarter/year via `date_trunc` **in SQL**
  (never client-side filtering), CSV export with the disclaimer embedded and `Cache-Control:
  no-store`, 3-year range bound, inverted-range rejection.
- `api/withdrawals/route.ts` — withholding hook; reports `netPayoutCents`; scoped to the
  withdrawal id for replay safety; fail-open on tax-store outage.

**Tests: 93 passing across 5 files** (25 policy + 10 settings + 15 report + 11 withdrawal
integration + 32 pre-existing withdrawals). The integration suite asserts a **losslessness
invariant across 9 rates** (`netPayout + withheld === gross` at 0/1/7/100/1500/2250/3333/9999/
10000 bps), 100% withholding produces `netPayout = 0` and never negative, and both fail-open
paths complete the withdrawal rather than stranding funds behind a 500.

**Not claimed:** this computes no tax liability, assumes no jurisdiction's rules, and is
explicitly labelled an estimate and not a tax form. Only live-API behaviour is unverified.

## 23. `error.message` audit — COMPLETE

17 candidate sites across 274 route handlers; **16 are safe or false positives** (Stripe errors
guarded by `error.type === 'StripeCardError'` with everything else routed to `safeErrorResponse`;
`rateLimitResult.message` is the app's own string; `outreach/verify/email/dns` uses
`.message?.includes()` as a boolean to select a canned string — the best pattern present). **1
genuine LOW finding:** `settings/outreach/{email,sms}/test` echo raw Twilio/SES error text.
Authenticated and tenant-scoped, so not a release blocker; recorded as a consistency gap.


| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** (0 errors) |
| Full suite (isolated) | **PASS** — 214 files, 2434 passed, 0 failed, 22 skipped |
| Tax withholding suite | **PASS** — 25 tests |
| Production build | **PASS** |
| Rate limiter suite | **PASS** — 23 tests |
| Bank account suite | **PASS** — 36 tests |
| `error.message` audit | **COMPLETE** — 1 LOW finding, 0 blocking |

shared memory."

**Fix:** added `src/app/api/utils/apiKeyRateLimit.ts` — a durable, Postgres-backed check in the
route layer, where a DB round trip already happens for the key lookup. The edge limiter stays as
a cheap fast path; the DB check is authoritative.

- Bucket key is the key's database id, never secret material.
- `failClosed` is opt-in; default is fail-open, deliberately: a limiter is abuse-shedding, not
  authorization, and failing closed would turn a partial outage of one table into a total outage
  of the v1 API. Documented as WRONG for money-movement routes; none of the current `/api/v1/*`
  routes move money.
- 10 new tests: equivalence partitioning, boundary (N+1), per-key isolation, invalid/zero/
  negative config, fail-open, explicit fail-closed, header shape.

### Explicitly NOT claimed
- Production verification of payments (no Stripe key - boot log confirms mock/degraded mode).
- Production verification of Apollo (no `APOLLO_API_KEY`).
- Production schema verification (migrations validated on PGlite only; not applied to Neon).
- Authenticated user/admin browser journeys (no test credentials in env; signup restrictions and
  admin toggles therefore remain UNVERIFIED at runtime, not merely unbuilt).
- Any p50/p95/p99 latency figure - none was measured against a production-representative target.
- Anything about the 5-10s navigation problem beyond the local observation that the dev server
  reported a 13976ms slow-filesystem benchmark. That is a local disk characteristic, and it must not
  be reported as the cause of a production symptom.

### Regression evidence (this gate)
- `npm run typecheck` -> **TC_OK** (exit 0).
- Full suite -> **212 files passed, 2399 tests passed, 22 skipped, 0 failed** (was 2397 before the two
  new ratchets; +2 exactly, no pre-existing test disturbed).
- Targeted re-run after fixes -> `contracts/step-out` + `bank-accounts` = **57 tests, 4 files, green**.
- Change set is 5 modified + 8 new files, all intentional. `yarn.lock` is pre-existing
  `@electric-sql/pglite` drift unrelated to this work and was deliberately left untouched.

### Recommended order for the next session
1. Implement requirements #18-#20 (seller tax reporting + optional withholding) - largest genuine
   product gap, entirely absent, and it is money-adjacent so it needs server-authoritative design,
   idempotent ledger entries, and a reconciliation story before any UI.
2. Decide and implement API-key rate limiting on `/api/v1/*` (finding #4).
3. Implement Shopify (finding #9) or formally descope it with a written product decision.
4. Re-run browser QA against a production build with seeded test credentials, and capture real
   latency percentiles (findings #6, #7).

5. **36 routes return `error.message` to the client**, which can surface SQL text and provider
   payloads. The `regression-guards.test.ts` ratchet covers only a "sensitive route set", not all 272
   routes. Needs a sweep with per-route judgement, not a blanket rewrite.
6. **`marketing/stats` residual inference.** Public + cacheable by design. The exact `activeUsers`
   count was already removed, but `percentClaimed` (rounded) plus `signupsThisWeek` still let an
   observer recover `totalUsers` to within ~5. Low severity; a deliberate marketing trade-off.
7. **Browser QA against `next dev` is not a valid product signal.** Every page returned a 200-300
   byte shell - the Turbopack on-demand compile placeholder - so the harness was measuring compile
   latency, not the rendered app. Meaningful browser QA needs a production build or a pre-warmed
   server, plus an authenticated session for the user/admin routes.
8. **`ENCRYPTION_KEY` absent from local `.env`.** Pre-existing gap, NOT introduced by the bank-account
   work: `ai-providers`, `integrations`, `twilio-accounts`, `outreachVerification` and `v1/webhooks`
   all already call `encryptSensitive`, which throws without it. Documented at `.env.example:245`.
   Those routes are therefore degraded locally for the same reason bank-account writes would be.

| 17 | Earnings/payout filters work | Y | TEST VERIFIED | UNVERIFIED | `earnings/route.ts`; 93-test earnings+withdrawals+bank run green | — | **PARTIAL** |
| 18 | Earnings/tax reporting exists appropriately | **N** | NONE | NONE | `\btax(es)?\b\|\b1099\b\|\bW-?9\b\|withhold(ing\|able)?\b`: 47 files, **all** either contract property-tax disclosures, tax-delinquent lead sources, or unrelated UI. No seller tax-report route | **Requirement not implemented** | **BLOCKED - NOT IMPLEMENTED** |
| 19 | Optional tax withholding implemented appropriately | **N** | NONE | NONE | No `withholding`/`tax_rate` column, table, or computation anywhere in `src/` or `db/` | **Requirement not implemented** | **BLOCKED - NOT IMPLEMENTED** |
| 20 | Withheld amounts appear in earnings/payouts | **N** | NONE | NONE | Earnings surface is only `earnings/route.ts` + `earnings/[id]/refund/route.ts` — no statement/report/1099 route | Depends on #18/#19 | **BLOCKED - NOT IMPLEMENTED** |

