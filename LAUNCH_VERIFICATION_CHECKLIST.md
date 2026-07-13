# LAUNCH_VERIFICATION_CHECKLIST.md — DealFlow AI

The actionable pre-launch checklist. Mark ☑ only with evidence captured THIS session
(command+output, DB rows, screenshot, live log, or CI URL). ☐ = unverified.
BLOCKED-ON-OWNER = needs an owner action (login/secret/registration).

> **HARD COMPLIANCE GATE — SMS.** The owner does **not** have Twilio 10DLC / campaign
> registration yet. Until approved: **no live outbound SMS**. All SMS verification stays
> in Personal Test Mode / mock mode (Sections 3–4 below are BLOCKED-ON-OWNER for live
> sends). Receiving the inbound webhook is fine.

## Section 0 — Source of truth
- ☑ `main` is the single source of truth; local == `origin/main`; CI green. (session e/f/g)

## Section 1 — Foundation
- ☑ 1.2 `tsc -p tsconfig.typecheck.json` exit 0 (real compiler, not a stub).
- ☑ 1.3 Unit/contract suite green: **342 tests (323 passed / 19 skipped)**.
- ☑ 1.4 Fresh-DB bootstrap: schema + campaign-pipeline + migrations 001–007 apply idempotently (CI e2e job, green).
- ☑ 1.5 CI all 4 jobs green on GitHub runners (Web / Desktop / E2E / Layer C).
- ☐ 1.1 Preflight 8/8 — **BLOCKED-ON-OWNER**: Check 4 (Anthropic) fails on $0 credit; add credit.

## Section 2 — Live app journey
- ☑ 2.1–2.8 Register→dashboard, every tab renders, import (paste+file), wizard→ACTIVE, inbox, approvals unblock — Playwright journey green (10-step). Analytics funnel non-zero.

## Section 3 — Real SMS loopback — Twilio TRIAL (live findings 2026-07-13)
- ☑ Twilio REST auth works (preflight Check 5); signed inbound webhook processed (Check 6).
- ⚠️ **Trial limits (live-tested):** Lookup API → `401 policy evaluation failed` (add-on not enabled on trial → skip-trace/compliance-data unavailable until upgrade). Outbound via **Messaging Service** → `400 trial accounts have limited parameter access` — trials send only **from the trial number to a verified number**. The app prefers the Messaging Service (correct for prod 10DLC), so **the app cannot send on the trial**; a live send requires either upgrade + 10DLC, or a direct From-number test to a verified recipient.
- ☐ Live outbound round-trip: BLOCKED — needs the trial From number + a verified recipient (owner providing); and full app-path sending needs 10DLC + a paid account. NO bulk/unsolicited sends attempted (compliance).

## Section 4 — Scale readiness ($0, mock) — **BLOCKED-ON-OWNER (10DLC)** for live; mock-mode sim OK
- ☐ 5k-contact simulator not run this session (mock-mode only when run; never live sends pre-10DLC).

## Section 5 — AI integrity (Anthropic-only default + optional local Ollama)
- ☑ 5.1 Repo-wide grep: zero Gemini/Google-AI in any runtime path; single AI entry point (`callAI`) with Anthropic default.
- ☑ **5.4 AI provider option (NEW):** app can use the hosted Claude API OR a local open-source model via Ollama, toggled in Settings → AI Provider (persisted in `app_settings`; env fallback; default Anthropic). Proven live: toggle persists (source=db), `/api/system/ai-status` returns true green/red — Ollama "not reachable / is `ollama serve` running?" and Anthropic surfaces the real $0-credit error. 11 unit tests (mapping/resolution/dispatch). Screenshot `e2e/.proof/ai-provider.png`.
- ☑ 5.3 Missing key at runtime → loud error (no canned-reply fallback outside tests).
- ☑ **5.2 Live model generation PROVEN via Ollama.** qwen2.5:7b drove the real orchestrator prompt end-to-end; `ai_reply` jobs complete on attempt 1 through the Ollama path (Anthropic would fail on $0 credit, so these are genuinely local-model). Required a fix — see 5.5.
- ☑ **5.5 Ollama JSON fix (live-found).** qwen2.5 emitted loose text, not strict JSON → orchestrator `JSON.parse` would dead-letter the job. Added Ollama `format:"json"` (opt-in `json` call option; Anthropic ignores it; orchestrator passes `json:true`). TDD RED→GREEN; committed `30c0be3`. Escalation stays server-side via `detectHighRisk` regardless of model output.
- ⚠️ 5.2b Anthropic live 200 still BLOCKED-ON-OWNER ($0 credit) — but no longer launch-blocking since Ollama is a working provider.

## Section 6 — Domain & deploy (dealswiftautomation.com)
- ☑ 6.1 Scaffold-host sweep: no hardcoded scaffold host in web runtime; desktop prod default → dealswiftautomation.com.
- ☑ 6.2 `DEPLOY.md` complete (Vercel + Vercel Cron + Neon, no Redis; DNS, env list, migrations, Twilio webhook, AI provider options).
- ☑ 6.3 App is env-driven for its origin (BETTER_AUTH_URL / PUBLIC_WEBHOOK_URL / NEXT_PUBLIC_APP_URL).
- ☐ 6.4 BLOCKED-ON-OWNER: registrar DNS, Vercel project `anything-web` + domain, prod secrets, Twilio prod webhook.

## Section 7 — Website & desktop
- ☑ 7.x Marketing pages render; marketing Playwright spec green (2/2). Desktop bundles + typechecks in CI (green).
- ☑ **Part C (desktop alignment):** prod `DEFAULT_APP_URL` → `https://dealswiftautomation.com` (dev localhost). Desktop has NO local auth surface (grep: only a "never bypass TLS in prod" comment), confines navigation to the app origin (`security.ts` will-navigate/redirect/webview guards), hardens the session (denies all permission requests), and loads the gated web app root — so it structurally cannot bypass domain-lock/RBAC (all server-side, proven live). Packaged-binary click-through = BLOCKED-ON-ENV (needs built installer + GUI session).
- ☐ 7.2 Lighthouse — not run this session.

## Section 8 — Compliance finals
- ☑ 8.4 Org isolation test green. Domain-lock + RBAC enforced server-side at every layer (register/login/middleware/API/admin/v1-key). Session revocation immediate (cookie-cache disabled).
- ☑ 8.7 **Live authz sweep (this session):** all 10 new routes (lead-finder sources/upload/create-campaign/sourced-leads/[id], settings/ai-provider, system/ai-status, admin/users) return **401 to anonymous** — none reachable without an authorized admin session.
- ☑ 8.x Opt-out/quiet-hours/DNC covered by existing tests (regression green).
- ☐ Lead Finder compliance: property+owner-name only, 0 contact fields (proven); sourced leads obey DNC/opt-out via the shared pipeline.

## Section 9 — Adversarial audit + launch freeze
- ⚠️ **Audit PARTIAL (session-limit truncated).** The multi-dimension bug/exploit audit ran only the **lead-finder** dimension before a session limit killed the other 5 dimensions (authz, ai-provider, injection, frontend, prod) and every verifier. It is **not** a clean bill of health — re-run those 5 dimensions when the limit resets.
- ☑ **Lead-finder findings fixed + re-verified (6):**
  1. **[compliance] Contact-column strip regex holes** — `\b` boundaries missed `phone_number`/`EmailAddress`/`Cell Phone`; `EmailAddress` then matched `/mail/i` → stored as `mailing_address`. **Fixed** (normalized-header token match; 'email' not 'mail' so "Mailing Address" survives). Live re-test: fixture with those headers → **0 contact data persisted**, mailing NULL.
  2. **[correctness] dedupe key dropped owner-only rows** — added `owner_name` to the key.
  3. **[correctness] cross-source parcels silently dropped** — dedupe key now source-scoped (same parcel in 2 sources kept).
  4. **[correctness] scoring was array-order dependent** — signals now ranked by strength (strongest = full weight).
  5. **[robustness] handoff double-hand-off race** — claim-first conditional UPDATE (status='new') before insert.
  6. **[compliance, 2nd pass] embedded contact in freeform cell** — a phone/email inside a non-contact column (e.g. "Notes") was persisted verbatim. **Fixed** via `scrubContactValues()` (US-phone + email value redaction) on every persisted raw value — TDD (RED→GREEN). 
  Regression tests added throughout; unit **328 passed / 19 skipped**; typecheck 0; all commits CI-green (4 jobs).
- ☑ Live authz sweep (independent of the audit): all 10 new routes 401 to anonymous.

### GO / NO-GO — **Conditional GO**
- **Proven:** every commit this session CI-green (4 jobs each); RBAC/domain-lock enforced + live-verified at every layer; session revocation immediate; Lead Finder compliance hardened across TWO audit passes (0 contact data at column AND value level, provenance, dedupe, scoring); AI-provider toggle live; DEPLOY.md complete with a hard 10DLC SMS gate; Part C (desktop) verified no-bypass.
- **NOT claimed:** "completely exploit-free." The adversarial audit could not finish 5/6 dimensions (ai-provider, injection, frontend, prod, authz-deep) — twice killed by a session limit. That coverage gap is real; re-run the audit when the limit resets before asserting exploit-hardened.
- **Owner-blocked before live launch (all in DEPLOY.md):** Anthropic credit · Twilio **10DLC** (NO live SMS until approved) · registrar DNS · Vercel project `anything-web` + domain · prod secrets · Twilio prod webhook.
