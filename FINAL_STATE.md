# FINAL_STATE.md — DealFlow AI

## New capabilities added (session w — Phases 0B / 3 / 5 / 6 / 12 / 13)

| Capability | Status | Notes |
|---|---|---|
| Job supervisor (restart-loop guard, dead-letter alert) | ✅ CODE COMPLETE | `jobSupervisor.ts`; 5 restarts/10min → halt+alert; `alertDeadLetters()` via cron |
| Per-channel circuit breakers (email + mail) | ✅ CODE COMPLETE | `channelCircuitBreaker.ts`; extends SMS gateway pattern; email breaker wired into `emailDriver.ts` |
| Stuck campaign contact repair | ✅ CODE COMPLETE | `repairStuckCampaignContacts()` in supervisor; called by dead-letter-alert cron |
| Phase 3: interested → negotiation chain | ✅ CODE COMPLETE | `call-queue/outcome/route.ts`; upserts conversation + enqueues `ai_reply` job |
| Phase 5: keyword SMS inbound (OFFER/CASH/SELL/etc.) | ✅ CODE COMPLETE | `outreach/keyword-inbound/route.ts`; consent record + lead upsert + AI enrollment |
| Phase 5: per-source attribution endpoint | ✅ CODE COMPLETE | `analytics/attribution/route.ts`; bandit_sign/facebook/craigslist/etc. |
| Phase 6: speed-to-range reminders (15min/1hr/3hr) | ✅ CODE COMPLETE | `conversionLevers.ts`; wired into `ownerRangeRequest.ts` |
| Phase 6: recency decay scoring | ✅ CODE COMPLETE | `applyRecencyDecay()` with configurable half-lives per signal type |
| Phase 6: send-time targeting | ✅ CODE COMPLETE | `bestSendHour()` with observed histogram → prior fallback + INSUFFICIENT DATA label |
| Phase 12: single-segment SMS enforcement | ✅ CODE COMPLETE | `smsGuards.ts`; GSM-7/UCS-2 detection, extended char counting, overLimit flag |
| Phase 12: GSM-7 sanitizer | ✅ CODE COMPLETE | `sanitizeToGsm7()`; smart quotes, em-dash, ellipsis → ASCII. Idempotent |
| Phase 12: duplicate-send detector | ✅ CODE COMPLETE | `isDuplicateSend()`; SHA-256 hash + phone + campaign, 24h window; wired into jobs.ts |
| Phase 12: throughput guards (MPS + daily cap + auto-pause) | ✅ CODE COMPLETE | `checkThroughput()`; wired into send_message job handler |
| Phase 13: performance indexes (10 hot paths) | ✅ CODE COMPLETE | migration 049; compliance_gate, lead score, buyer match, job poll, DNC, dedup, opt-out |
| Phase 13: perf probe endpoint | ✅ CODE COMPLETE | `system/perf/route.ts`; wall-clock timing on 5 hot paths + job queue depth |



| Capability | Status | Notes |
|---|---|---|
| Compliance gate registry (fail-closed per jurisdiction×channel) | ✅ CODE COMPLETE | migration 047; `complianceGate.ts`; wired into dispatchGate step 3.3; all new jurisdictions start locked |
| Kill-switch (org-level halt all outbound) | ✅ CODE COMPLETE | `outbound_kill_switch` table; activate/deactivate API; checked first in complianceGate |
| Capacity planner (Plan A/B + 10–30/mo gap model) | ✅ CODE COMPLETE | `capacityPlanner.ts`; Poisson math; ranked levers; all BENCHMARK-labeled; `/api/campaigns/planner` |
| Resurrection engine (30/60/90/180 day re-activation) | ✅ CODE COMPLETE | `resurrectionEngine.ts`; opt-out exclusion at SQL level; idempotent; cron task wired |
| Wave 2 jurisdictions (TN/OH/IN/AL/SC/VA) | ✅ CODE COMPLETE | migration 048; all MANUAL_ONLY; all gates locked; KY/AL Jefferson disambiguated |
| JURISDICTION_PLAYBOOK.md | ✅ COMPLETE | Repo root; standalone repeatable steps |
| JV intake (origination_type=JV_INTAKE, matched-buyer outreach) | ✅ CODE COMPLETE | `/api/jv`; transaction-safe; reuses existing buyer lookup + send pipeline |
| Referral-out (REFERRAL_OUT origination, partner admin) | ✅ CODE COMPLETE | `/api/referral`; partner CRUD; handoff + close-out |
| Buyer network (scored, coverage-gap report) | ✅ CODE COMPLETE | `buyers` table; `/api/buyers`; coverage-gap flags thin zips |
| Unified debrief (Wilson CI, full attribution) | ✅ CODE COMPLETE | `/api/debrief`; per-channel funnel; origination/jurisdiction/wave attribution; CSV export |

**Standing invariants (unchanged):** no live SMS pre-A2P; escalation invariant supreme; beta flags default OFF; no autonomous strategy changes.

**NOT LEGAL ADVICE:** CAN-SPAM, TCPA, DNC, call-recording consent, per-state wholesaling/assignment licensure, JV/double-close/assignment-of-assignment legality — owner confirms each with an attorney before operating. Every new jurisdiction×channel starts locked until owner+attorney review.

---

**Branch:** feat/mvp-prelaunch
**As of:** 2026-07-23, review pass — reviewed session (t)'s work (all sound) and corrected one documentation error it introduced (the typecheck-tooling row below). See BREAKAGE_TABLE.md's "CORRECTION" note in the session (t) section for the full trace.
**Prior:** 2026-07-22, session (t) — closed the 2 items session (s) spun off, plus real `/how-it-works` screenshots (see BREAKAGE_TABLE.md and SESSION_HANDOFF.md for the full session log). Rows below updated in place; everything else is unchanged from the Phase 0–7 sprint and was NOT re-verified (credit discipline).

**This file supersedes all prior versions.** A previous version of this file (authored by an earlier, parallel session, dated 2026-07-19/20) made claims this session directly disproved with observed evidence — most notably "E-Sign Webhook ✅ Per-provider signature validation" and "Payments Webhook ✅ Stripe signature validation," both of which were forgeable (bug #34, closed in Phase 5). Nothing below is asserted without a proof reference in `BREAKAGE_TABLE.md`; anything not provably working is listed as such, not rounded up.

---

## Verified capability matrix

| Capability | Status | Proof |
|---|---|---|
| Migration chain (42 files) applies cleanly + idempotently from any prior state | ✅ VERIFIED | `[migrate] done — 42/42 applied (idempotent)`, run twice back-to-back, most recently for migration 042 (session t) |
| Repo route inventory (101 API routes, 43 pages) | ✅ VERIFIED (as of Phase 0) | `docs/AUDIT_2026-07-21.md` — 67 WIRED / 31 SUSPECT / 3 STUBBED at audit time; the majority of SUSPECT rows were closed in Phases 1–5 (see BREAKAGE_TABLE) |
| Marketing surface (9 pages: `/`, `/how-it-works`, `/features`, `/pricing`, `/faq`, `/about`, `/contact`, `/trust`, legal index) | ✅ VERIFIED | link-check: 22/22 internal hrefs, 0 failed; `/pricing` reads live DB (migration 035); 375px zero-overflow proven via DOM measurement |
| `/how-it-works` screenshots | ✅ VERIFIED (session t) | 5 real Playwright-captured screenshots at 1280x720 (`scripts/capture-how-it-works-screenshots.mjs`), session-email banner clipped, wired into the page via `next/image`. The prior blocker was never the capture tool itself — it was that screenshots need Playwright to persist to disk, matching this repo's existing `e2e/.proof/*.png` pattern |
| Contact form round trip (submit → DB → operator notification) | ✅ VERIFIED | Live browser submission → `contact_messages` row → `human_approvals` PENDING row → visible in `/approvals` UI → resolved |
| Reviews: public list, aggregate, sort, filter, pagination | ✅ VERIFIED | 1000-row live seed; `?stars=1` → 1 result matching DB; sort/pagination independently proven via network requests |
| Reviews: submit → moderate → publish | ✅ VERIFIED | Browser submission (verified customer) → pending → real admin approve → public feed → `review_audit_log` row |
| Reviews: FTC 16 CFR 465 demo-data segregation | ✅ VERIFIED | Demo seed writes `is_demo=true, verified_customer=false`; production query excludes `is_demo` rows (code-path verified); SAMPLE DATA banner renders when demo data present |
| Legal: 9 versioned docs, single markdown source, TOC | ✅ VERIFIED | All 9 routes 200; version/effective-date/attorney-marker render; entity placeholders substitute from env |
| Legal: signup acceptance, re-accept gate, messaging-compliance gate | ✅ VERIFIED | Fresh signup → 2 acceptance rows (ip+UA captured); pre-existing user → redirected to `/legal/accept` until re-accepted; version-bump gate proven with the exact middleware query; campaign launch → 403 without messaging-agreement acceptance, passes after |
| Real-Twilio inbound STOP → suppression → send blocked | ✅ VERIFIED | Valid-signature form POST body=STOP → suppression row written → dispatchGate would deny; bogus signature still 403 |
| Admin panel: users (ban/suspend/unban/kick/force-reset/GDPR-delete/promote), reviews, billing/refunds, compliance, audit log | ✅ VERIFIED | `/admin/*` UI built + guarded; full ban lifecycle (login-reject + mid-session kick) proven both directions; refund end-to-end with idempotency; force-reset + GDPR-anonymize proven live |
| Admin API 403 enforcement | ✅ VERIFIED | Scripted non-admin session against all 17 `/admin` API routes — all 17 returned 403 |
| Tenant scoping (`getOrganization()` used instead of the never-set `session.user.organizationId`) | ✅ VERIFIED for the 25 fixed call-sites + 2 FK-violation follow-ons | `/api/leads/bulk` proven 200 with a real `organization_id` (previously guaranteed 500) |
| Tenant scoping — full IDOR test suite across every authenticated route | ✅ VERIFIED, 0 known gaps | Systematic hand-audit of all 15 dynamic-id routes (table in BREAKAGE_TABLE.md session s) — most already correctly scoped or global-by-design. 4 real cross-org leaks found and fixed with tests (session s), each mutation-proven RED first: `GET /api/payments?contractId`, `POST /api/leads/[id]/ai`, `GET /api/conversations/[leadId]`, `GET /api/conversations/thread/[leadId]`. The 1 remaining gap flagged by session (s) — legacy `campaigns`/`campaign_leads` had no `organization_id` column at all — is now closed (session t, migration 042, commit `ceb5496`): both tables scoped, all 3 routes call `getOrganization()`, independently RED→GREEN-verified by a second agent. Retiring the legacy system outright was considered and rejected — it's still the tested pipeline `flows.test.ts`/`full-wholesale-pipeline.test.ts`/`flows-live.test.ts` exercise directly. **New narrow gap found, not fixed:** `AddLeadsControl` on the same page always 400s (UUID vs `Number.isInteger` check) — spun off separately |
| SMS delivery-status callback receiver | ✅ VERIFIED | `/api/sms/status`: valid signature advances `message_events.status`; bogus signature 403s, row unchanged |
| Webhook trust boundaries (e-sign provider selection, mock endpoints) | ✅ VERIFIED | Provider now server-configured only (client header ignored, test-proven); mock-checkout/mock-sign hard-gated on `NODE_ENV`, missing prefix-check added, reflected XSS fixed |
| Stripe webhook signature verification | ✅ VERIFIED (session s) | Real HMAC scheme (`t=<ts>,v1=<hex>` over `${ts}.${body}`, SHA-256, constant-time compare, ±300s replay tolerance) in `stripe-webhook.ts`, pure `node:crypto` — no live/test Stripe account needed since verification is independent of the payment-creation API. 13 tests: valid, tampered body, malformed header, stale timestamp, missing secret. Mock provider unchanged (still accepts any signature by design in dev mode) |
| Boot-time env validation | ✅ VERIFIED (narrow scope) | `instrumentation.ts` hard-fails on missing `DATABASE_URL`/`BETTER_AUTH_SECRET`; Twilio/Stripe/AI keys soft-warn by design (mock-fallback is the app's normal mode) |
| Durable, multi-instance-safe rate limiting | ✅ VERIFIED (session s) | Migration 041 `rate_limits` table (composite PK), atomic `INSERT ... ON CONFLICT DO UPDATE` per call — no read-then-write race. Live concurrency proof against the real dev DB: 5 racers on a limit-of-2 bucket → exactly 2 allowed, row count=5. Contact/review call sites unchanged (same function signature) |
| Outreach campaigns subsystem (`/api/outreach/*`) | ✅ VERIFIED (session s) | All 5 bug #36 defects fixed: params-await on pause/resume/stats/cancel/contacts; contacts batch-INSERT placeholder misalignment (`idx*4`→`idx*5`); OPENING template's missing `campaign_id`; scheduler now enqueues real `send_message` jobs instead of no-op SENT flips; `/api/funnel`'s join on a nonexistent `contract_id` column fixed (rejoined via `leads`). 25 tests, each mutation-proven RED against the original bug first |
| Funnel analytics data pipeline (`stage_transitions` writer) | ✅ VERIFIED (session t) | `recordStageTransition` wired into 7 real lifecycle points (commit `bc969fd`): NEW on lead creation, CONTACTED on QUEUED→SENT, ENGAGED on affirmative reply, NEGOTIATING on approval, CLOSED_LOST on no-agreement/STOP. Live-DB proof: real funnel counts after a throwaway lead's real lifecycle. **2 gaps found, not fixed:** SIGNED/ASSIGNED stages unwired — blocked by `contractGeneration.ts` having zero callers and never setting `contracts.seller_lead_id`, so there's no lead_id to record against; `backfillStageTransitions()` (for historical data) is separately broken — reads a `payload->>'leadId'` key no `logEvent()` call ever writes. Both spun off |
| Secrets-in-bundle build-time grep | ✅ VERIFIED (session s) | `scripts/check-secrets-in-bundle.mjs` greps `.next/static` for both the literal value of every configured secret AND secret-shaped literal prefixes (sk_live_/sk_test_/whsec_/sk-ant_/postgres URL w/ creds). Wired into `deploy.ps1`'s node path right after `next build` — a leak fails the deploy. Ran against a real production build this session: 53 files scanned, all PASS |
| Production build + boot on the correct port | ✅ VERIFIED | Full `deploy.ps1` cold run: migrations 40/40, build compiled clean (143 routes), health check passed on first attempt on :4000 (bug #43 fixed) |
| Desktop app: builds, packages, boots without crashing | ✅ VERIFIED | v1.0.1 NSIS installers (x64/arm64/combined) built; 4-process Electron tree confirmed alive post-launch, cleanly terminated |
| Desktop app: UI renders correctly, login works, campaign screen renders | ⚠️ PARTIALLY VERIFIED (session t, web-origin proxy) | The Electron shell loads the same web app in a `BrowserWindow`; real sign-in + `/campaigns` rendering verified directly against that origin (checklist items #4–#5 in SESSION_HANDOFF.md). Does **not** cover items #1–#3 (installer completes, native window renders, loads the configured `DEALFLOW_APP_URL`) — those need the actual packaged `.exe` and remain a genuine human/owner pass |
| Typecheck verification tooling itself | ✅ VERIFIED reliable, session (t)'s "56 errors" claim RETRACTED (review pass) | Session (t) ran bare `yarn tsc --noEmit` (no `-p` flag) and found 56 errors, concluding every prior "typecheck 0" claim project-wide "may have been silently unverified." Re-checked independently: bare `yarn tsc --noEmit` resolves the **default** `tsconfig.json`, not this repo's `tsconfig.typecheck.json` — a different, broader scope, not a more-reliable check. `tsconfig.typecheck.json` deliberately excludes `*.test.ts`/`__tests__/**` (its own `"//"` comment explains why — test files are validated by execution via vitest, not a strict type-gate); all 56 "errors" sit inside that exclusion. The repo's real `"typecheck"` script (`tsc -p tsconfig.typecheck.json --noEmit`, run as `yarn typecheck`) is what every prior session actually ran (directly or via the local `node_modules/.bin/tsc` binary) and it is **confirmed exit 0, run twice independently**. The only real, already-known issue — bare `npx tsc` sometimes resolving an npm stub instead of the installed compiler — was already solved by every session using the local binary directly, which is what `yarn typecheck` does too. Every "typecheck 0" claim in this project's history stands; the follow-up task spun off from session (t)'s misdiagnosis should be closed, not worked |
| Desktop auto-update | ❌ NOT CONFIGURED | `updater.ts` assumes a feed `electron-builder.yml` never defines (no `publish:` block → no `latest.yml`). Logged as an owner decision item, not half-implemented |
| Desktop draft GitHub release | ✅ VERIFIED | `desktop-v1.0.1`, 4 assets uploaded and byte-size-verified, draft (not public) |

## Standing invariants (unchanged all sprint)

- No live SMS until Twilio 10DLC/A2P approval clears — everything in this sprint ran in mock/Personal-Test-Mode.
- Escalation invariant: AI never states/confirms prices; price talk → `requires_human=true` + owner notification. Untouched this sprint.
- Beta flags (`voiceEscalation`, `twilioDemo`, `boundedNegotiation`, `negotiationProfiles`, etc.) default OFF. Untouched this sprint.
- Compliance: opt-out-first, quiet hours 8am–9pm lead-local, DNC beats everything. Untouched this sprint (bug #32's fix strengthens this on the real-Twilio path specifically).
- No secrets printed, committed, or exposed in this session's output.
- PR #4 remains a DRAFT — not merged, per standing instruction.

## What "done" means here

Every ✅ row above has a corresponding dated entry in `BREAKAGE_TABLE.md` with the actual command/output that proved it, not a description of intent. Every ❌ row has a stated reason (environment blocker, explicit scope deferral, or owner-gated decision) — none are silent gaps.
