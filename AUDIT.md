# AUDIT.md — Phase 0 preflight (MVP prompt v2, retargeted at THIS repo)

Date: 2026-07-15 · Repo: `D:\anything` (Next.js 16 monorepo) · HEAD `0a8a97b` (CI-green)
Method: evidence only — every row below was grepped/queried this session. Inventory only, nothing fixed.

---

## 0. PREMISE CORRECTIONS (the prompt's assumptions vs. this repo)

| Prompt assumption | Reality (evidence) | Impact |
|---|---|---|
| App is `dealflow_ai_platform.html` + `wholesaling-funnel-calculator.html`; "no build system, no package.json, no server, no tests" | **Neither file exists** (repo, Downloads, or the 3 `dealflow-ai*.zip` — those are a *Google AI Studio React/TS* lineage). Repo = Next.js 16 + Neon + Electron, `package.json` monorepo, **48 test files / 350 tests**, 4-job CI | Phase 0 "read both HTML files" and Phase 1 "move/extract `app.js` from inline `<script>`" are **unexecutable**. Superseded by Option B: lift substance onto the real platform. |
| "**BullMQ delayed jobs — already in the stack**" | **FALSE.** Zero `bullmq`/`redis`/`ioredis` in either `package.json`. The only mention is a **comment**: `followUpScheduler.ts:58 // In production: queue SMS job via BullMQ/Twilio` | INT-4 must use the **existing Postgres `jobs` queue** (below), not Redis. Adding BullMQ = new infra + duplicate drain loop for zero gain. |
| INT-4 replaces "ad-hoc `setTimeout` follow-up chains" | **No setTimeout chains.** `services/followUpScheduler.ts` is a real DB-driven hourly ladder (`campaign_message_templates.delay_hours` + `sequence_order` + `campaign_contacts.follow_ups_sent`) | INT-4 **extends/absorbs** an existing scheduler — must not fork a second one. |
| INT-3 "extend the existing `numberPool.ts`" (pool of `{number, areaCode, dailyCount, healthScore}` + `pickNumber`) | `numberPool.ts` is **10DLC throughput MATH only** — exports: `computeDailyCapacity`, `requiredNumbersForVolume`, `canFitDailyVolume`, `computeThroughputCeiling`, `DEFAULT_THROUGHPUT`. **No pool storage, no `pickNumber`, no per-number `dailyCount`/`healthScore`, no area-code matching** | INT-3 is a **new build** (pool registry + picker), not an extension. The capacity math is reusable for caps. |

---

## 1. INTEGRATION-POINT INVENTORY (real / stubbed / missing)

### The real scheduling primitive — `jobs` table + `utils/jobs.ts`  ✅ REAL
`id, type, payload, status, attempts, max_attempts, error_message, dedupe_key, run_at, locked_until, created_at, updated_at`
- `run_at` → **delayed execution** (INT-4 ladder timing)
- `dedupe_key` + partial unique index + `ON CONFLICT (dedupe_key) … DO NOTHING` → **per-step idempotency** (INT-4 requirement, already native)
- `locked_until` (5-min lock) + `run_at <= now` + `ORDER BY run_at ASC` → safe concurrent drain
- Postgres-persisted → **restart-resume for free**
- Drained by `POST /api/jobs/process` — prod: Vercel Cron; dev: `scripts/jobs-dev.mjs` every 3s
- **⇒ "do not build a custom ticker" is already satisfied. INT-4 = enqueue ladder steps with `run_at` + `dedupe_key`.**

| Surface | State | Evidence |
|---|---|---|
| Inbound SMS → AI | ✅ REAL | `sms/inbound/route.ts:169 enqueueJob('ai_reply', {leadId, conversationId})` |
| AI orchestration + escalation | ✅ REAL | `ai-orchestrator.ts` (`callAI`, confidence gate, `detectHighRisk` net in **both** conversation + `ai_reply` job paths) |
| SMS provider abstraction (mock/twilio, env-switched) | ✅ REAL | `gateway/providers.ts` (TwilioAdapter; `messagingServiceSid` else `fromNumber`) |
| Opt-out / consent | ✅ REAL | `utils/compliance.ts` (`checkConsent`, `registerOptOut`, `registerConsent`), `services/optOutDetection.ts` (`isOptOutMessage`) |
| Follow-up ladder (hourly) | ✅ REAL | `services/followUpScheduler.ts` (`processFollowUps`) |
| 10DLC throughput math | ✅ REAL | `utils/numberPool.ts` |
| Beta-flag persistence | ✅ REAL (unused for flags) | `app_settings` (key/value jsonb) — already backs the AI-provider toggle |
| Event-log data source | ✅ REAL | `audit_logs` + `utils/logger.ts logEvent()` |
| **Local-presence pool + `pickNumber`** | ❌ MISSING | no pool storage/picker (see §0) |
| **Speed-to-Lead SLA timer + metric** | ❌ MISSING | no t0→dispatch measurement anywhere |
| **Voice / RVM channel** | ❌ MISSING | no `voiceProvider`, no voice route |
| **Cadence ladder (T+0/60s/4h/D1/3/7/14 + window-snap)** | ❌ MISSING | only the hourly template ladder exists |
| **Beta Flags panel UI** | ❌ MISSING | no UI |
| **Event Log panel UI** | ❌ MISSING | no UI (data exists) |
| **`/api/health` `{ok, services{}, betaFlags{}}`** | ⚠️ PARTIAL | `system/health` returns `{status:'healthy'\|'degraded'}` — needs additive extension |
| **`launch.bat` / `launch.ps1`** | ❌ MISSING | dev boot is manual (`yarn dev` + `jobs:dev`) |
| **Quiet-hours / send-window enforcement at dispatch** | ⚠️ **NOT FOUND** | grep of `src/app/api` for `quiet\|sendWindow\|isWithin\|21:00` → **zero hits**. Wizard *collects* `sendWindowStart/End` (09:00/19:00); dispatch-time enforcement unverified. **INT-2 + INT-4 both depend on it.** |

---

## 2. BLOCKERS / RISKS (must be decided before code)

1. **INT-1's <60s SLA is architecturally impossible in prod as-built.** Prod drain is Vercel Cron `* * * * *` = **once per minute**, so an `ai_reply` job can wait ~60s *before the AI call even starts*. Vercel Cron's floor is 1/min. Compounding: with `AI_PROVIDER=ollama` (current), qwen2.5:7b takes **~50s/generation** on this hardware. ⇒ <60s requires (a) an always-on worker polling seconds (Fly/Railway), **and** (b) `AI_PROVIDER=anthropic` (~2–5s). Locally (`jobs-dev` 3s poll + Anthropic) it is achievable. **Decision needed.**
2. **INT-3 cap conflict.** Prompt hard-caps **125 outbound/day/number**; the repo's real 10DLC math models T-Mobile ~2,000/day + MPS ceilings. 125 is a vendor deliverability/rotation convention, not a carrier limit. **Decision: keep 125 as a conservative guard, or derive from `computeDailyCapacity`?**
3. **Quiet hours may not exist at dispatch** (see table). INT-2/INT-4 must not *assume* it — this is build-or-confirm work, and it gates any voice/RVM.
4. **INT-2 legal surface.** Voice + RVM carry TCPA prior-express-consent duties distinct from SMS, while A2P/10DLC is pending. Mitigated by spec: mock driver only, Twilio driver **stubbed** with `// LIVE:` markers, `consentBasis` gate, flag **OFF by default**. Nothing dials.
5. **Research figures** (21x, 391%, ~400%) are vendor/marketing stats. Per your standing rule they'll be recorded as **unverified**, never asserted as measured lift.

---

## 3. PHASE PLAN (file-level; nothing written yet)

**P1 — Launcher + observability shell**
- `launch.ps1` / `launch.bat` (repo root): kill stale node on :4000 → `yarn dev` + `jobs:dev` → poll `/api/health` until `ok:true` (15s cap, red-fail + exit 1) → `start http://localhost:4000` → status table (service/port/driver/flags). *No local Redis/Postgres to boot — Neon is cloud; the "workers" are `jobs-dev`.*
- `src/app/api/system/health/route.ts`: extend additively → `{ok, services:{db,jobs,ai,sms}, betaFlags:{...}}` (keep `status` for the existing Shell indicator).
- `src/app/api/utils/betaFlags.ts` + `settings/beta-flags` route: 4 flags in `app_settings`, admin-gated, live toggle.
- `src/components/settings/BetaFlagsCard.tsx` + `src/components/EventLogPanel.tsx` (reads `audit_logs`, newest-first, filter by integration). **Wired end-to-end or not added.**

**P2 — Integrations (one per commit: implement → run → verify → log)**
- **INT-1** `services/speedToLead.ts`: stamp t0 at `sms/inbound` enqueue; `ai_reply` handler records dispatch t1 + emits `speed_to_lead` event; 45s ack-SMS fallback (template, gated by flag + consent); `/api/analytics` adds avg + rolling-24h **P95**; metric card green/amber/red.
- **INT-3** `db/migrations/009_number_pool.sql` (`number_pool`: number, area_code, daily_count, health_score, last_reset) + `utils/numberPoolPicker.ts` (`pickNumber(leadPhone)`: exact area → nearest region → least-used; cap + daily reset) + settings usage table. Reuses existing capacity math for the cap.
- **INT-4** `services/cadenceEngine.ts`: enqueue ladder as **`jobs` rows** (`run_at` + `dedupe_key = cadence:{contactId}:{step}`); window-snap to 10–11am/2–4pm lead-local; quiet hours; reply/DNC cancels remaining; **absorbs** `followUpScheduler` (no second scheduler); per-lead timeline strip in conversation pane.
- **INT-2** `services/voiceProvider.ts` (mock weighted answered/no-answer/voicemail; Twilio **stubbed**, `// LIVE:` + TCPA header comment) + `api/voice/call` route; outcomes feed the **existing** seller state machine (reuse `handleSellerReply` path — no fork); `consentBasis` gate + quiet hours + STOP suppression hard-coded; flag OFF.

**P3 — Atomic verification**
- `tests/`: health boot; lead-parser 6 fixtures; state-machine happy path; **negotiation-ceiling fuzz 50 runs asserting the computed offer number** (not prose); INT-1..4 acceptance; opt-out suppression; **flags-off ⇒ zero events**; **restart-resume cadence** (no dupes via `dedupe_key`).
- `BREAKAGE_TABLE.md` rows with **observed output**; `FINAL_STATE.md` 15-step manual QA (run once, record); DoD checklist.

---

## 4. GATE 0 STATUS
Audit complete; premises corrected with evidence; plan is file-level. **Stopping for owner review before any code**, per instruction.
