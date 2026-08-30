# DEALFLOW AI — PRODUCTION SCALE ENGINE

# Multi-Channel × Multi-Jurisdiction × JV/Referral Network — Legal-Hardened, Crash-Proof, 10–30/mo Target

# VSCode Cline Prompt · v4.0 (unifies v3 Depth-Engine + JV/Jurisdiction-Network prompts, adds Legal Safeguards + Resilience chassis + Scale Hardening). Paste whole. Progress lives in repo files, never chat memory.

## ⚠️ STEP -1 — SOURCE-OF-TRUTH RECONCILIATION (do FIRST)

`git status` · `git branch -a` · `git log --oneline -15 --all --graph` · `git remote -v` + `git fetch --all` + `git log --oneline origin/main -5` → paste all. Flag divergence (uncommitted work, `gemini-*`/`aistudio-*` branches). Read SESSION_HANDOFF.md / FINAL_STATE.md / BREAKAGE_TABLE.md — doc claims work git doesn't show → trust CODE, flag it. Confirm single source-of-truth branch. No merge/rebase/force-push/branch-delete without owner confirmation.
**Gate -1**: report pasted, branch confirmed.

## ROLE

Release engineer on DealFlow AI. PRE-EXISTING & VERIFIED (`v1.0.0-verified`+, 350+ tests, 4 green CI jobs): Next.js 16 + raw SQL/Neon + job queue + Twilio multi-provider SMS gateway (circuit-breaker pattern) + `callAI` selector [anthropic|ollama] + Lead Finder [registry-driven, KY/NC/GA/MO/StL, 28 sources] + wizard + scheduler + 4-tier negotiator + owner-range flow + approvals + contracts/e-sign + basic buyer funnel + analytics + CRM. THIS BUILD ADDS: email + manual-call channels, multi-touch depth sequencing, resurrection re-activation, free inbound capture, jurisdiction Wave 2, JV/referral revenue layers, a scored buyer network, a unified debrief, a compliance-gate system, and a crash-proof job/campaign chassis. VERIFY & ADD/TUNE only — search before building; never duplicate existing systems.

## 🧠 GOVERNING ECONOMICS + THE SCALE TARGET

| Action                                       | Real cost            |
| -------------------------------------------- | -------------------- |
| Acquire a NEW contact (skip-trace+DNC scrub) | $0.09–0.17           |
| +1 SMS touch to an already-traced contact    | ~$0.011              |
| +1 EMAIL touch (free-tier provider)          | ~$0.000              |
| +1 MANUAL CALL touch                         | $0 cash (owner time) |
| Direct mail piece                            | $0.50–1.00           |
| JV/referral fee (no origination)             | $0 acquisition cost  |

Skip-trace vendors typically bundle email with phone — already paid for once traced. ~80% of wholesale contracts close on follow-up day 31–180. **Acquisition is expensive; touches are nearly free.** Trace fewer contacts, hit each one 8–12+ times across free channels over 120 days. Cold SMS needs A2P (still clocking); email (CAN-SPAM) and manual calls (DNC-scrubbed) don't — build those first.
**A solo human is capped by one county's dial-hours. An AI is not.** This build's explicit SCALE TARGET is **10–30 assignment fees/month**, reached by compounding four independent levers — more jurisdictions (Phase 7), more channels/depth per contact (Phases 2–6), zero-origination JV/referral fees (Phases 8–9), and buyer-network depth that lets JVs be accepted (Phase 10) — NOT by dialing harder in one county. **This target is NOT asserted as achieved by shipping this code** — Phase 1 computes, honestly, the gap between current capacity and the target and what combination of the four levers closes it; the target is what the architecture is built toward over months, not a guarantee.

## SESSION PROTOCOL

S1. Node hygiene (list→kill orphans→port 4000 free→before/after counts). Disk ≥5GB or BLOCKED-ON-DISK.
S2. Load 3 state files (STEP -1 governs conflicts). Resume at first OPEN row.
S3. Boot ONCE: T1 `cd apps/web && yarn dev` · T2 `yarn jobs:dev`. Run preflight → paste 8-row table.
S4. End (even mid-task): rewrite handoff files, commit+push, paste CI URL, stop processes, node ≤ start, disk ≥ start.
**EVIDENCE LAW**: ☑ only with output/screenshot/DB rows captured THIS session. Unit tests ≠ live app. Not run = UNVERIFIED. Owner-needed = BLOCKED-ON-OWNER + exact step. Secrets in .env only, never printed. Every NEW adapter/system this build gets a non-vacuous test (break it once, watch fail, restore).

# ═══ PHASE 0 — LEGAL SAFEGUARDS + RESILIENCE CHASSIS (foundational; every later phase must use this) ═══

### 0A. Legal Safeguards Architecture

1. **Compliance Gate Registry** (`compliance_gates`: jurisdiction, channel, attorney_reviewed bool, reviewed_date, reviewed_by, source_terms_confirmed bool, notes) — **fail-closed**: any jurisdiction×channel combo defaults FALSE; the dispatch path for EVERY channel checks this gate before a cold send fires and refuses if unreviewed. This is enforced in code at the send boundary, not a checklist the owner can forget.
2. **Global invariants, code-enforced, never configurable per campaign**: cross-channel opt-out (STOP/unsubscribe/verbal-DNC in any channel suppresses ALL channels + all resurrection waves, instantly); DNC scrub before any cold touch; quiet hours; immutable/auditable consent records; property+owner-name-only sourcing.
3. **Per-channel legal constraints** (single source of truth in FINAL_STATE.md, enforced not just documented): SMS cold-send gated on A2P + the Phase-0A gate; Email = CAN-SPAM (physical address, working one-click unsubscribe, truthful headers/subject, clear sender identity); Manual calls = DNC-scrubbed + human-initiated ONLY — **no auto-dial, no AI voice, no RVM to cold numbers** (prerecorded/artificial voice to cells needs prior express written consent; RVM is treated as a call); JV/double-close = attorney-reviewed template required before use, per-state wholesaling/assignment licensure logged in the gate registry too.
4. **Kill-switch**: one org-level toggle halting ALL outbound across ALL channels immediately (owner-triggered or auto-triggered on a compliance breach threshold) — tested live.
5. **NOT LEGAL ADVICE**: one consolidated FINAL_STATE.md statement covering CAN-SPAM, TCPA, DNC, call-recording (KY is one-party consent; recording defaults OFF, flagged as an owner/attorney decision), consent-language sufficiency, per-state Lead Finder source terms, wholesaling/assignment licensure per state, and JV/double-close/assignment-of-assignment legality — owner confirms each with an attorney before operating.
   **Gate 0A**: fail-closed proven (a seeded unreviewed jurisdiction×channel combo blocks a cold send, logs why); cross-channel opt-out proven (STOP on one channel suppresses a pending send on another, row pasted); kill-switch halts all channels live and is reversible; per-channel legal constraints grep-verified in code (no auto-dial/AI-voice/RVM code path exists anywhere).

### 0B. Resilience & Fault-Tolerance Architecture

1. **Idempotency everywhere**: every NEW send/write (email Message-ID, JV intake, referral handoff, resurrection sends, compliance-gate writes) follows the SAME dedup-key pattern already proven for SMS MessageSid — no duplicate sends, no duplicate rows on retry.
2. **Checkpointed/resumable campaign state**: per-contact, per-channel, per-touch-number progress persisted so a crash/restart resumes exactly where it stopped — never restarts from zero, never re-sends a delivered touch, never loses a scheduled one.
3. **Circuit breakers per channel adapter**: extend the SMS gateway's existing breaker pattern to Email and the call-queue dispatcher — open after N consecutive failures, half-open probe, auto-recover; one channel failing does NOT block or crash campaigns on other channels (graceful degradation, proven).
4. **Job-runner supervisor**: auto-restart on crash, with a max-restart-loop guard (e.g., 5 restarts/10min → stop + alert, never a silent infinite crash loop).
5. **Dead-letter + owner alert** for anything that exhausts retries — nothing silently dropped.
6. **DB transaction safety**: multi-step writes (e.g., JV intake creating a deal + firing buyer-match) wrapped in a transaction — a mid-operation crash leaves no half-written state.
   **Gate 0B (chaos test, mandatory, live)**: kill the job runner mid-campaign → supervisor restarts it → verify exact resume point, zero duplicate sends, zero lost contacts (DB rows pasted before/after); force one channel adapter to fail mid-campaign → other channels continue uninterrupted, failed channel's touches queue for retry not lost; a forced mid-transaction crash (e.g., during JV intake) leaves no partial row (paste the check).

# ═══ PHASE 1 — CAPACITY PLANNER: PLAN A/B + THE 10–30/MO GAP MODEL ═══

Extend existing analytics/wizard (don't rebuild): "what does my next $X buy, and how far from 10–30/mo am I?"

1. Real per-unit costs (trace, scrub, SMS in/out, email, AI/conversation, mail) + budget + contact count + touches/channel.
2. **Plan A breadth** (N × 2 SMS touches) vs **Plan B depth** (N/4 × 10 mixed touches) side by side: total cost, touches delivered, λ, P(≥1)/P(≥2)/P(≥3) via Poisson, cost-per-expected-contract.
3. **Capacity-vs-target model**: given current jurisdiction count (Lead Finder registry), channel mix, JV-relationship count, and buyer coverage, compute expected fees/month and the honest GAP to the owner's 10–30 target — output which lever (more markets / more depth / more JV relationships / more buyer coverage) closes the gap fastest, per real numbers not narrative.
4. All conversion inputs `BENCHMARK (unverified for this account)` until real data exists, then `MEASURED (n=…)`. "What would have to be true": N for 80%/95% confidence of ≥1.
   **Gate 1**: both plans render from real rates, math checked vs a hand fixture (paste it); capacity-vs-10–30 gap model outputs a real number + ranked lever recommendation from live config; labeling correct.

# ═══ PHASE 2 — FREE COLD OUTBOUND #1: EMAIL (runs today, no A2P) ═══

1. EmailAdapter on the existing gateway/adapter pattern, free-tier provider (evaluate current Resend/Brevo/Postmark limits, pick one, document choice in FINAL_STATE.md); send + delivery/bounce/complaint webhooks; participates in the Phase 0B circuit breaker.
2. CAN-SPAM enforced in code (0A #3); unsubscribe → same global opt-out store as SMS STOP.
3. Deliverability = the real volume ceiling: SPF+DKIM+DMARC on a **dedicated sending subdomain**; scheduler-enforced warmup ramp (start ~25/day, step up); syntax+MX validation pre-send; hard auto-pause at bounce >5% or complaint >0.1%.
4. Replies thread into the existing conversation — AI negotiator/owner-range/ladder work identically to SMS.
   **Gate 2**: live send→reply→threaded→AI response fires; unsubscribe suppresses a matching pending SMS (cross-channel opt-out row pasted); warmup+auto-pause proven on seeded breach; SPF/DKIM/DMARC verified (pasted) or BLOCKED-ON-OWNER with exact DNS records; compliance-gate check proven active on this channel.

# ═══ PHASE 3 — FREE COLD OUTBOUND #2: MANUAL CALL QUEUE (highest-converting free channel) ═══

No auto-dial, no AI voice, no RVM to cold numbers (0A #3) — owner dials, AI supports.

1. Queue UI: DNC-scrubbed, score-ranked, AI-generated call brief per lead (distress signals+source, suggested opener, objections+responses, comps/equity if available, cross-channel touch history).
2. One-click outcome logging (no-answer/voicemail/not-interested/interested/callback-scheduled/DNC-request) → correct pipeline state; `interested`→AI negotiation chain; `DNC-request`→immediate global opt-out.
3. Attempt tracking: cadence, best-time learning, callback auto-requeue, attempt cap (config).
4. Optional click-to-call (manual-initiate only) via existing Twilio voice creds; recording OFF by default (0A #3/#5).
   **Gate 3**: queue renders DNC-scrubbed+ranked w/ real brief; each outcome writes correct DB state (rows pasted); `interested` triggers negotiation; `DNC-request` suppresses across SMS+email (proof); attempt cap enforced; compliance-gate check active.

# ═══ PHASE 4 — DEPTH ENGINE: MULTI-CHANNEL SEQUENCES + RESURRECTION RE-ACTIVATION ═══

1. Wizard extension: 8–12+ touches over 120+ days, per-touch channel choice (email/SMS/call-task), configurable cadence, distinct angles, single-segment SMS, quiet hours + global opt-out always obeyed; a call-step creates a Phase-3 queue task; sequence state is checkpointed per 0B.
2. **Un-quarantine the resurrection engine properly** (highest-ROI code under these economics — re-touches contacts already paid for): real migration for `resurrection_campaign_config` + `resurrection_sent_log`; fix the known `.rows` bug (reads `.rows` on a driver returning a plain array → silently returns defaults); wire into the scheduler at 30/60/90/180 days for COLD/NO_AGREEMENT leads across all channels. **Opted-out contacts are NEVER resurrected** (mandatory regression test). Tracked as its own funnel source.
3. Touch-economics report: cost-per-new-contact vs cost-per-additional-touch BY CHANNEL; contracts attributed to touch number + channel.
   **Gate 4**: 8+ touch multi-channel sequence schedules correctly across 120 days in mock mode, zero stuck states, survives a mid-run job-runner kill (0B); resurrection migration clean on fresh DB; `.rows` fix proven by a test that fails when reverted; opt-out-never-resurrected green; touch-economics report renders.

# ═══ PHASE 5 — FREE INBOUND CAPTURE (consented, best conversion, $0 acquisition) ═══

1. Keyword inbound ("text OFFER to…") — consent logged (timestamp, source, IP where applicable, consent-language version) → auto-enroll.
2. Landing page + form on the owner's domain, public via a free named Cloudflare Tunnel (no paid hosting pre-revenue) — same consent record + auto-enroll.
3. Per-source attribution for $0 channels: bandit/yard signs, Facebook Marketplace + local groups, Craigslist, Nextdoor, Google Business Profile, driving-for-dollars magnet, word of mouth.
   **Gate 5**: keyword inbound → consent row → AI reply → owner-range SMS → tier-1 offer (full chain log); form submit → same chain; per-source attribution counts render.

# ═══ PHASE 6 — FREE CONVERSION LEVERS ═══

1. **Owner speed-to-range**: instrument range-request→owner-reply→next-AI-message latency; escalating reminders to OWNER_NUMBER (15min/1hr/3hr); mobile one-tap approve; stale-request alert; reported against outcomes.
2. **Recency weighting** in Lead Finder scoring: age-decay per record_type (configurable half-life) — a fresh probate outranks a stale one — surfaced in the "why" string.
3. **Send/call-time targeting** inside the legal window at the hours replies/answers actually cluster.
4. **Message quality by human judgment**, not fake A/B at low volume — surface the raw evidence (Phase 11 evidence pack); any variant test prints `INSUFFICIENT DATA (n=X, need ~Y)` until powered.
   **Gate 6**: reminders fire on a seeded stale request; recency decay flips ranking on an old-vs-new fixture w/ correct "why"; timing respects quiet hours; no lift claimed below min-n.

# ═══ PHASE 7 — JURISDICTION EXPANSION PLAYBOOK + WAVE 2 (market count is the real scale lever) ═══

1. **Write `JURISDICTION_PLAYBOOK.md`** (repo root): repeatable steps for adding one county/metro to the existing `lead_sources` registry — identify assessor/GIS/court/code-enforcement sources → check+cache robots/terms → classify access_method+terms_status → seed w/ distress_weight → ingest test batch, verify provenance+dedupe → confirm scoring. Future waves paste a market list against this playbook, no new prompt needed.
2. **Execute live for Wave 2** (regional to KY/NC/GA/MO/StL for JV/buyer compounding): Tennessee (Nashville–Davidson, Memphis–Shelby, Knoxville–Knox), Ohio (Cincinnati–Hamilton, Columbus–Franklin), Indiana (Indianapolis–Marion), Alabama (Birmingham–Jefferson — **disambiguate from KY's Jefferson Co. by state field**), South Carolina (Charleston, Columbia–Richland), Virginia (Richmond). Same seller/buyer categories as existing sources; agent verifies each real source's URL/access/terms LIVE; MANUAL-ONLY where scraping isn't permitted; same compliance architecture (property+owner-name only, provenance, all existing DNC/opt-out/quiet-hours controls). **Every new jurisdiction×channel starts with Phase 0A's compliance gate FALSE** — locked until owner+attorney review.
   **Gate 7**: playbook doc complete+followable standalone; registry shows Wave-2 markets w/ verified access+terms (live checks pasted); KY/AL Jefferson disambiguation proven; ingest proven live for ≥2 Wave-2 markets w/ provenance+dedupe; scoring runs via existing scorer; new-jurisdiction gates confirmed locked by default; suite green.

# ═══ PHASE 8 — JV / CO-WHOLESALE INTAKE (zero-origination-cost fees) ═══

1. **Schema**: `origination_type` on the existing deal/contract record (migration): `OWN_ORIGINATED | JV_INTAKE | REFERRAL_OUT`. JV record adds: originating-wholesaler contact, fee-split terms, contract price, closing/expiration deadline.
2. Manual intake form (relationship-sourced, not automated) → on save, run the EXISTING matched-buyer lookup (zip+price+cash flag) against the standing buyer database.
3. Matched buyers get AI-drafted outreach through the SAME negotiation engine (same compliance, same Phase-0 gates — JV is not a carve-out). Best offer → existing approvals inbox. On buyer secured: JV/assignment paperwork (attorney-template placeholder, FOR-ATTORNEY-REVIEW) + payout-split tracking, transaction-safe per 0B.
   **Gate 8**: migration clean; intake creates `origination_type=JV_INTAKE`; matched-buyer outreach fires via existing funnel w/ compliance proven active; a seeded JV deal reaches approvals+closes w/ split tracked; regression suite green (OWN_ORIGINATED behavior unchanged); a forced crash mid-intake leaves no partial row.

# ═══ PHASE 9 — REFERRAL-OUT (monetize dead-end replies) ═══

1. Classifier extension: `REFERRAL` outcome for retail-intent signals — a new branch, not a replacement of the wholesale-intent path.
2. `referral_partners` table + admin UI (name, contact, referral-fee %).
3. On `REFERRAL` + owner approval → send to matched partner (service area) → log `origination_type=REFERRAL_OUT`; owner manually marks "closed, fee received."
   **Gate 9**: seeded retail-intent reply classifies REFERRAL (not silently dropped); handoff record created+logged; manual close-out updates the debrief's fee ledger.

# ═══ PHASE 10 — BUYER NETWORK: SCORED ASSET + MATCHED-FIRST DISPO (cheapest fee in the system) ═══

Buyers convert ~1 per 30–150 messaged vs ~1 seller contract per 1,500–3,000; sourced FREE from cash-sale deeds/repeat-grantee LLCs/multi-parcel owners; reachable by email+calls at $0.

1. Standing buyer database: tag every responding buyer by zip, price band, cash/financing, property type, responsiveness — permanent across campaigns; quality score (verified/unverified, responsiveness, actual-close count).
2. **Matched-first dispo**: on any seller contract signed (own OR JV), message the matched buyer segment (email+SMS+call tasks) BEFORE any cold blast; measure fee achieved + days-to-assign vs baseline; competing buyers push the fee UP.
3. **Coverage-gap report** by zip+price band: flags thin coverage — the decision tool for (a) which JV intakes (Phase 8) are safe to accept, (b) which Phase-7 markets deserve buyer-building focus. Note in the debrief that a deep buyer list also enables accepting MORE co-wholesale contracts (Phase 8) as a lower-cost route to volume.
   **Gate 10**: score populates from real/seeded activity; coverage report flags a deliberately-thin fixture zip; matched-first dispo fires on a seeded signed contract across channels (own AND JV); report used live to accept/reject a seeded JV intake.

# ═══ PHASE 11 — UNIFIED DECISION-GRADE DEBRIEF (owner optimizes manually; no autonomous changes) ═══

One click after every campaign.

1. Funnel **per channel** — delivered/reply/interested-of-replies/negotiation/contract/opt-out, each w/ n + Wilson 95% CI; underpowered → `INSUFFICIENT DATA (n=X, need ~Y)`. Cost per stage/interested-lead/contract, by channel.
2. Contracts by touch number, by channel, by resurrection wave, **by origination_type (OWN/JV/REFERRAL), and by jurisdiction** — the full empirical test of every lever in this build.
3. Drop-off ranked by expected dollars lost, not biggest percentage.
4. Evidence pack: 10 best/10 worst reply→interested threads (any channel), call-outcome distribution + notes, common objections tagged, tier where deals agreed/died, reply/answer-time histograms, owner speed-to-range distribution.
5. Ranked hypotheses for next run — cost to test + what it'd prove, labeled hypotheses never conclusions. Cost-per-fee by lever (market/channel/JV/referral) so the owner sees which lever is the better next hour.
6. Export: markdown + CSV for run-over-run diffing.
   **Gate 11**: debrief renders from a seeded multi-channel, multi-jurisdiction, mixed-origination campaign; every rate carries n+CI; underpowered honest; drop-off ranking correct on a planted fixture; full attribution table (touch/channel/wave/origination/jurisdiction) + evidence pack render; export works.

# ═══ PHASE 12 — COST FLOOR + THROUGHPUT GUARDS ═══

1. Single-segment SMS enforcement: authoritative counter, hard-flag >160 GSM-7, unicode-detection (drops limit to 70), GSM-7 sanitizer, all default templates rewritten to fit.
2. `AI_PROVIDER=ollama` proven $0 negotiation; quality trade-off vs Anthropic documented; one-`.env`-line switch confirmed.
3. Waste elimination: dedupe before tracing; drop invalid/landline pre-send; suppress previously-contacted/opted-out; DNC scrub once per number; inbound-message costs in the ledger.
4. Throughput guards: scheduler enforces assigned A2P MPS + T-Mobile brand daily cap exactly (warn at 80%); auto-pause on SMS opt-out >3%/campaign-day or delivery <85%; duplicate-send detector across ALL channels.
   **Gate 12**: cost-per-sendable-contact before/after; templates proven single-segment (incl. a unicode case); $0 AI turn live; cap/quiet-hours/auto-pause tests green.

# ═══ PHASE 13 — SCALE HARDENING + RUN (prove it holds at target-consistent volume) ═══

1. **Performance pass on pre-existing systems** under the new load: index review on hot paths (contact lookup by score/jurisdiction, buyer match by zip+price+cash-flag, job-queue polling, compliance-gate lookup — now in every dispatch's hot path); EXPLAIN ANALYZE before/after on the 5 slowest real queries; connection-pool sizing check for Neon under concurrent multi-channel dispatch.
2. **Load test**: extend the existing mock-simulator pattern (previously proven at 5,000+ single-channel contacts) to a multi-channel, multi-jurisdiction scenario sized to the Phase 1 capacity-target math — zero stuck states, zero errors, compliance gates checked correctly at scale, chaos-kill (0B) survived mid-run.
3. **Run**: test-mode dry run across all channels against owner's own contacts (full chain: inbound→AI→owner range→ladder→deal→approval→contract) → live launch to the approved segment w/ hard budget caps armed → daily guardrail monitoring → debrief delivered. System never changes strategy on its own.
   **Gate 13**: query perf before/after table; load test report at target-consistent volume incl. chaos-survival; dry-run chain logs per channel; live campaign launched w/ caps; guardrails active; debrief delivered.

## HARD RULES

- **Legal**: SMS cold only after A2P + gate; Email = CAN-SPAM; calls = DNC-scrubbed, human-initiated, no auto-dial/AI-voice/RVM; JV/double-close needs attorney-reviewed templates + logged licensure confirmation. Every jurisdiction×channel combo fail-closed until reviewed (Phase 0A). Global cross-channel opt-out is a code-enforced constant, never an experiment arm.
- **Resilience**: idempotent everywhere; checkpointed/resumable campaigns; circuit breakers per channel; supervised job runner with restart-loop guard; dead-letter+alert; transaction-safe multi-step writes. A crash never means lost work, duplicate sends, or a dead campaign (Gate 0B + 13 prove this).
- No hallucinated metrics: BENCHMARK vs MEASURED(n=…) always labeled; no "lift" without a significance test; the 10–30/mo target is reported as a gap-to-close, never asserted as delivered.
- No autonomous strategy changes, no self-modifying AI prompts — the debrief informs, the owner decides.
- One AI vendor at a time via the existing `callAI` selector; no cross-provider fallback; no mock/canned replies in runtime (grep-prove); missing provider = loud failure.
- VERIFY & ADD/TUNE — reuse every existing system (gateway/adapter pattern, wizard, scheduler, negotiator, ladder, approvals, contracts, buyer funnel, Lead Finder registry+scorer, analytics, CRM). Never build a parallel one. `outreach/variant-allocator.ts` stays quarantined.
- One process instance; root causes only (no any/@ts-ignore/.skip); .mjs = plain JS run before ship; env loads at boot — flag restarts; suite (350+) stays green; owner actions = BLOCKED-ON-OWNER + exact steps.
- Ship order strict: Gate -1 → 0(A+B) → 1 → 2 → … → 13. No later phase while an earlier gate is OPEN.

## REPORT

Reconciliation → node/disk → preflight → Phase 0A (gate/opt-out/kill-switch/legal-grep evidence) → 0B (chaos-test results) → 1 (planner + gap model) → 2 (email chain+opt-out+deliverability) → 3 (call queue outcomes/DNC) → 4 (sequences+resurrection+touch economics, survives chaos) → 5 (inbound+attribution) → 6 (speed-to-range/recency/timing) → 7 (playbook + Wave-2 registry + disambiguation) → 8 (JV intake+funnel reuse+approvals+payout, transaction-safe) → 9 (referral classification+handoff) → 10 (buyer scoring+coverage+matched dispo) → 11 (unified debrief w/ full attribution) → 12 (cost+guards) → 13 (perf table+load test+dry run+live+debrief) → handoff files updated → CI URL. Evidence is the report; no completeness prose.
