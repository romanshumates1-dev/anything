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

## Section 3 — Real SMS loopback — **BLOCKED-ON-OWNER (10DLC)**
- ☐ All live-send steps deferred until 10DLC approval. Inbound webhook + signature verification are wired and unit-tested; Personal Test Mode allowlist enforced.

## Section 4 — Scale readiness ($0, mock) — **BLOCKED-ON-OWNER (10DLC)** for live; mock-mode sim OK
- ☐ 5k-contact simulator not run this session (mock-mode only when run; never live sends pre-10DLC).

## Section 5 — AI integrity (Anthropic-only default + optional local Ollama)
- ☑ 5.1 Repo-wide grep: zero Gemini/Google-AI in any runtime path; single AI entry point (`callAI`) with Anthropic default.
- ☑ **5.4 AI provider option (NEW):** app can use the hosted Claude API OR a local open-source model via Ollama, toggled in Settings → AI Provider (persisted in `app_settings`; env fallback; default Anthropic). Proven live: toggle persists (source=db), `/api/system/ai-status` returns true green/red — Ollama "not reachable / is `ollama serve` running?" and Anthropic surfaces the real $0-credit error. 11 unit tests (mapping/resolution/dispatch). Screenshot `e2e/.proof/ai-provider.png`.
- ☑ 5.3 Missing key at runtime → loud error (no canned-reply fallback outside tests).
- ☐ 5.2 Live 200 from a model — **BLOCKED-ON-OWNER**: fund Anthropic, OR run Ollama locally and Test connection (green).

## Section 6 — Domain & deploy (dealswiftautomation.com)
- ☑ 6.1 Scaffold-host sweep: no hardcoded scaffold host in web runtime; desktop prod default → dealswiftautomation.com.
- ☑ 6.2 `DEPLOY.md` complete (Vercel + Vercel Cron + Neon, no Redis; DNS, env list, migrations, Twilio webhook, AI provider options).
- ☑ 6.3 App is env-driven for its origin (BETTER_AUTH_URL / PUBLIC_WEBHOOK_URL / NEXT_PUBLIC_APP_URL).
- ☐ 6.4 BLOCKED-ON-OWNER: registrar DNS, Vercel project `anything-web` + domain, prod secrets, Twilio prod webhook.

## Section 7 — Website & desktop
- ☑ 7.x Marketing pages render; marketing Playwright spec green. Desktop bundles + typechecks in CI; prod APP_URL → dealswiftautomation.com; loads the gated web app (honors domain-lock + RBAC).
- ☐ 7.2 Lighthouse — not run this session.

## Section 8 — Compliance finals
- ☑ 8.4 Org isolation test green. Domain-lock + RBAC enforced server-side at every layer (register/login/middleware/API/admin/v1-key). Session revocation immediate (cookie-cache disabled).
- ☑ 8.x Opt-out/quiet-hours/DNC covered by existing tests (regression green).
- ☐ Lead Finder compliance: property+owner-name only, 0 contact fields (proven); sourced leads obey DNC/opt-out via the shared pipeline.

## Section 9 — Launch freeze
- ☐ 9.x Final GO/NO-GO after Part C + a full section-by-section live pass. Owner-blocked list: Anthropic credit, 10DLC, DNS/Vercel/Twilio logins.
