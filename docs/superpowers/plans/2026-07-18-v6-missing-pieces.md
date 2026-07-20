# v6 Implementation Plan — Missing Pieces (P1–P5 + Deploy + .EXE)

## Goal
Deliver 5 missing integrations (E-Sign Events, Fee Collection, Owner Alerting, Funnel Analytics, Backup/Restore), complete v5 remainder, one-command deploy, and Windows .exe.

## Architecture
Monorepo (apps/web + apps/desktop), Next.js 16, Neon Postgres, Twilio (mock/test), Stripe (TEST mode), Electron.

## Tech Stack
- Backend: Next.js API routes, Postgres (Neon), `sql` tagged template literals
- Frontend: React/Next.js, shadcn/ui, Tailwind
- Desktop: Electron + electron-builder (NSIS)
- Testing: Vitest, Playwright
- Payments: Stripe TEST mode (mock driver for offline dev)
- E-sign: Mock driver (documenso/docusign-stub pattern)

## Global Constraints
- No cloud dependency required to go green (local-first)
- All webhook signatures verified (Stripe, e-sign, Twilio)
- Idempotent operations everywhere
- Append-only ledger (no UPDATE of amounts)
- Windows-first scripts (PowerShell/.bat)
- Per-phase self-review before claiming done

---

## Phase P1 — E-Sign Event Driver

### Files to create/modify:

1. **`apps/web/src/app/api/services/esignProvider.ts`** — NEW
   - Interface: `EsignProvider { createSigningLink(contract): link; verifyWebhook(body, sig): boolean; }`
   - Implementations: `MockEsignProvider` (generates link + dev "simulate sign" button), `DocumensoProvider` (stub), `DocusignStub` (stub with `// LIVE:` markers)
   - Same pattern as `smsMode.ts` / `voice-gateway.ts`

2. **`apps/web/src/app/api/services/esignProvider.test.ts`** — NEW
   - Mock creates link, verifyWebhook valid + tampered, idempotent

3. **`apps/web/db/migrations/018_esign_events.sql`** — NEW
   - `esign_events` table: id, contract_id, event_type (sent/viewed/signed/countersigned), event_data jsonb, created_at
   - Index on contract_id, event_type

4. **`apps/web/src/app/api/esign/webhook/route.ts`** — NEW
   - POST route, signature validation, idempotent on event id
   - On `signed`: UPDATE contract status, emit domain event, log to Event Log

5. **`apps/web/src/app/api/esign/webhook/webhook.test.ts`** — NEW
   - Mock full cycle, tampered webhook rejected, duplicate webhook idempotent

6. **`apps/web/src/app/api/services/contractStatusMachine.ts`** — MODIFY
   - Extend status transitions: sent → viewed → signed → countersigned
   - Add timeline entries on contract card

7. **`apps/web/src/components/contracts/ContractTimeline.tsx`** — NEW
   - Timeline component showing e-sign events on contract card

8. **`apps/web/src/app/api/contracts/route.ts`** — MODIFY
   - Include timeline data in contract response

### Tests:
- Mock full cycle: create contract → send for signing → simulate sign → webhook fires → status updated
- Tampered webhook rejected (403)
- Duplicate webhook idempotent
- Status regressions impossible (no signed→sent)

---

## Phase P2 — Assignment-Fee Collection (Stripe TEST mode)

### Files to create/modify:

1. **`apps/web/db/migrations/019_payments_ledger.sql`** — NEW
   - `payments_ledger` table: id, contract_id, buyer_id, amount_cents, currency, stripe_payment_intent_id, stripe_event_ids[], status(created→sent→paid→failed→refunded), created_at, paid_at
   - Append-only (corrections = new rows, never UPDATE amounts)
   - Indexes on contract_id, status

2. **`apps/web/db/migrations/020_fee_collection_settings.sql`** — NEW
   - `contracts.fee_collection` column: collect_now | at_closing (default at_closing)
   - `contracts.fee_config` jsonb: {type: 'percent'|'flat', value: number}

3. **`apps/web/src/app/api/services/stripeProvider.ts`** — NEW
   - Interface: `StripeProvider { createPaymentLink(amount, contract): link; verifyWebhook(body, sig): boolean; }`
   - Implementations: `MockStripeProvider` (generates mock link, simulates webhook), `LiveStripeProvider` (real Stripe API, `// LIVE:` markers)
   - Mock passes all gates without live keys

4. **`apps/web/src/app/api/services/stripeProvider.test.ts`** — NEW
   - Mock creates link, verifyWebhook valid + tampered

5. **`apps/web/src/app/api/payments/webhook/route.ts`** — NEW
   - Stripe webhook: signature-verified, idempotent on event id
   - `payment_intent.succeeded` → cross-check amount against ledger → mark paid
   - `payment_intent.payment_failed` → mark failed
   - Mismatch → alert + hold (no auto-mark)

6. **`apps/web/src/app/api/payments/webhook/webhook.test.ts`** — NEW
   - End-to-end: mock-sign → payment link created → stripe trigger → ledger paid → owner notified once
   - Replayed webhook idempotent
   - Tampered signature 403
   - Amount-mismatch held
   - at_closing skips request
   - Refund transitions

7. **`apps/web/src/app/api/payments/route.ts`** — NEW
   - GET: list payments for contract
   - POST: create payment (owner-initiated)
   - POST /refund: owner-initiated refund with reason

8. **`apps/web/src/app/api/contracts/route.ts`** — MODIFY
   - Include payment chip data (status, amount, link)

9. **`apps/web/src/components/contracts/PaymentChip.tsx`** — NEW
   - Payment status chip on contract card
   - Shows paid/failed/pending with amount
   - Owner refund button

10. **`apps/web/src/app/api/services/dispatchGate.ts`** — MODIFY
    - Add payment notification dispatch path

### Tests:
- End-to-end mock-sign → payment link → Stripe test webhook → ledger paid → owner notified once
- Replayed webhook idempotent
- Tampered signature 403
- Amount-mismatch held
- at_closing skips request
- Refund transitions

---

## Phase P3 — Owner Alerting

### 3a. Human-request detection (inbound)

1. **`apps/web/src/app/api/services/humanRequestDetector.ts`** — NEW
   - Two-stage: keyword fast-path + LLM intent fallback
   - Keywords: "real person", "owner", "manager", "call me", "who is this", "human"
   - On hit: thread → requires_human, AI paused, owner notified

2. **`apps/web/src/app/api/services/humanRequestDetector.test.ts`** — NEW
   - 30-message fixture corpus: explicit asks, embedded-word false-positive traps, normal replies
   - Zero missed explicit asks, FP rate logged

3. **`apps/web/src/app/api/sms/inbound/route.ts`** — MODIFY
   - Wire human-request detection before AI reply

### 3b. System-down deadman

4. **`apps/web/src/app/api/services/heartbeat.ts`** — MODIFY
   - Stale heartbeat → one SMS to owner per outage (dedupe key = outage window)
   - Recovery → "restored" notification

5. **`scripts/watchdog.ps1`** — NEW
   - Windows Scheduled Task template
   - Catches app-process death, alerts via direct Twilio call from script (mock-safe)

6. **`apps/web/src/app/api/services/heartbeat.test.ts`** — MODIFY
   - Stale-heartbeat → exactly one SMS across repeated ticks
   - Recovery → "restored" notification

---

## Phase P4 — Funnel Analytics

1. **`apps/web/db/migrations/021_stage_transitions.sql`** — NEW
   - `stage_transitions` table: lead_id, from_stage, to_stage, occurred_at, campaign_id, profile_id, channel
   - Indexes on lead_id, occurred_at, campaign_id

2. **`apps/web/src/app/api/services/stageTransitionRecorder.ts`** — NEW
   - Written at every state-machine transition
   - Best-effort backfill from audit logs

3. **`apps/web/src/app/api/analytics/funnel/route.ts`** — NEW
   - Phase-to-phase conversion % table
   - Drop-off ranking (worst-converting step highlighted)
   - Cohort filters (campaign/profile/channel/date range)
   - Per-follow-up-step response rates
   - Median time-in-stage
   - Noise panel (opt-out rate, dispatchGate skip reasons, numeric-guard blocks, human-request escalations)
   - Cost-per-stage and cost-per-signed-contract
   - Negotiation stats (avg rounds to agreement, walk-away rate, in-range close rate)

4. **`apps/web/src/app/analytics/funnel/page.tsx`** — NEW
   - Funnel page UI with conversion table, filters, charts

5. **`apps/web/src/app/api/analytics/route.ts`** — MODIFY
   - Include funnel data in analytics response

### Tests:
- Transition writes on every state change
- Funnel numbers reconcile against raw counts (SQL pasted)
- CRM snapshot unchanged

---

## Phase P5 — Local Backup/Restore

1. **`scripts/backup.ps1`** — NEW
   - pg_dump, timestamped, retention N days
   - Scheduled Task template

2. **`scripts/restore.ps1`** — NEW
   - Typed confirmation before restore

3. **`DEPLOY.md`** — MODIFY
   - Add backup/restore section

### Verification:
- backup → drop dev DB → restore → full suite green
- Row logged

---

## v5 Remainder — Close Open Rows

- Phase A bounded negotiation: already complete (100/100 fuzz, 20/20 guard, 150/150 regression)
- T-safety driver: already complete (zero-SDK-call proof)
- V-R inspection clock: already complete (16/16 tests, live chip)
- Phase Q route sweep: extend to new surfaces (funnel page, payment chips, e-sign timeline, alerting settings)

---

## One-Command Deploy + Windows .EXE

### 4a. deploy.ps1

1. **`scripts/deploy.ps1`** — NEW
   - build → migrate → start prod compose profile (fallback: node + worker)
   - Poll health until green (fail red + exit non-zero)
   - Open browser

### 4b. Electron .exe

2. **`apps/desktop/electron-builder.yml`** — MODIFY
   - NSIS target, x64, app icon, version from package.json

3. **`apps/desktop/src/main/main.ts`** — MODIFY
   - On launch: detect/start local stack, wait for health, load app
   - Single-instance lock
   - Tray icon reflecting health state (green/amber/red)
   - Native toast on owner alerts
   - Graceful "stop stack on exit?" prompt

4. **`apps/desktop/src/main/tray.ts`** — MODIFY
   - Health state tray icon

5. **`DEPLOY.md`** — MODIFY
   - Unsigned-exe SmartScreen behavior documented
   - Optional code-signing steps

---

## Execution Order

1. Checkpoint (commit + push current state)
2. P1 — E-Sign Event Driver
3. P2 — Assignment-Fee Collection
4. P3 — Owner Alerting
5. P4 — Funnel Analytics
6. P5 — Local Backup/Restore
7. v5 remainder sweep
8. Deploy + .exe
9. Final DoD verification