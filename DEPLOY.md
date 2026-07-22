# DEPLOY.md — DealFlow AI → https://dealswiftautomation.com

Copy-paste runbook to put the web app + background job runner online at the
owner's domain. Steps that only the owner can do (they require a login) are
tagged **BLOCKED-ON-OWNER** with the exact action.

---

## 0. Chosen host + why

**Recommendation: Vercel (web) + Vercel Cron (job runner) + Neon (Postgres).**

The app is a Next.js 16 App-Router app whose background work is a **Postgres-backed
queue** (the `jobs` table), drained by an HTTP endpoint (`POST /api/jobs/process`).
Grep confirms there is **no Redis/BullMQ** in the runtime — the "Redis" references
in the code are aspirational comments only. So the prompt's assumed Redis + separate
worker box is **not required**:

- **Vercel** runs Next 16 natively, auto-deploys from the GitHub branch, and gives
  free TLS + apex/www domains. (~$0 hobby for a trial, ~$20/mo Pro for custom cron
  frequency + no cold starts.)
- **Vercel Cron** invokes `POST /api/jobs/process` on a schedule (drains the queue) —
  no always-on worker to run or pay for, because the drain is just an HTTP call.
- **Neon** is already the database (serverless Postgres, generous free tier).

Trade-off: a single VPS or Fly.io box running `next start` + a systemd/cron timer for
the job poll is cheaper at high volume and keeps everything in one place, but you own
the OS patching, TLS renewal, and process supervision. For a solo operator launching,
Vercel + Neon is the least ops for the money. If you outgrow Vercel's cron frequency or
function timeouts, move the job drain to a small Fly.io/Railway worker running the same
poll loop as `scripts/jobs-dev.mjs` (pointed at the prod URL) — no app changes needed.

---

## Container Deployment (alternative to Vercel)

If you prefer container deployment (Fly.io, Railway, or any Docker host):

```bash
# One-time setup
cp apps/web/.env.example apps/web/.env
# Fill in DATABASE_URL (Neon), BETTER_AUTH_SECRET, etc.

# Start the stack
docker compose up -d

# Verify health
curl http://localhost:4000/api/system/health

# Stop
docker compose down
```

**Important:** The app uses `@neondatabase/serverless` which speaks HTTP/WebSocket to Neon.
A vanilla `postgres:16-alpine` container CANNOT be used as the database because:
- The serverless driver does NOT speak the Postgres wire protocol
- For fully-local testing, you would need Neon's local WebSocket proxy
- For now, `DATABASE_URL` must point at a real Neon branch (free tier works)

See docker-compose.yml for the worker container timing and profiles (ollama optional).

---

## 1. DNS records at the registrar  — **BLOCKED-ON-OWNER**

At the registrar for `dealswiftautomation.com`, set:

| Type  | Name  | Value                     | Purpose                    |
|-------|-------|---------------------------|----------------------------|
| A     | `@`   | `76.76.21.21`             | apex → Vercel (Vercel shows the exact IP in the domain UI) |
| CNAME | `www` | `cname.vercel-dns.com`    | www → Vercel               |

> The exact apex A-record IP / verification TXT is shown by the host when you add
> the domain (see step 4). Use the value the host displays, not a guessed one.

**BLOCKED-ON-OWNER:** only the domain owner can edit registrar DNS.

---

## 2. Production environment variables (names + purpose — NO values)

Set these in the host's project settings (Vercel → Project → Settings → Environment
Variables). Never commit values; `apps/web/.env` is gitignored.

**Core**
- `DATABASE_URL` — Neon Postgres connection string (prod branch).
- `BETTER_AUTH_SECRET` — random 32+ byte secret for session signing.
- `BETTER_AUTH_URL` — `https://dealswiftautomation.com` (auth base + trusted origin).
- `NEXT_PUBLIC_APP_URL` — `https://dealswiftautomation.com` (client-side base URL).

**Access control (RBAC / domain lock)**
- `ALLOWED_EMAIL_DOMAINS` — `dealswiftautomation.com` (comma-separated to add more).
- `MIN_ACCESS_ROLE` — `ADMIN` (loosen to `MEMBER` later to open the app up).
- `SEED_ADMIN_EMAILS` — `roman.shumate@dealswiftautomation.com`.

**AI (Anthropic — the only AI vendor)**
- `ANTHROPIC_API_KEY` — Anthropic key (**account needs credit — see step 7**).
- `ANTHROPIC_MODEL` — e.g. `claude-sonnet-5`.

**SMS (Twilio)**
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — Twilio credentials.
- `TWILIO_MESSAGING_SERVICE_SID` and/or `TWILIO_FROM_NUMBER` — sending number/service.
- `TWILIO_NUMBER_TYPE`, `TWILIO_10DLC_ASSIGNED_MPS`, `TWILIO_10DLC_TMOBILE_DAILY_CAP` — 10DLC throughput caps.
- `OWNER_NUMBER` — E.164 owner phone for owner-range round trips.
- `PUBLIC_WEBHOOK_URL` — `https://dealswiftautomation.com/api/sms/inbound` (Twilio signs against this).
- `SMS_INBOUND_SECRET` — shared secret for the simulator branch of the inbound webhook.

**Job runner / cron**
- `JOB_RUNNER_SECRET` — secret the cron request sends to `POST /api/jobs/process`.
- `CRON_SECRET` — secret for `POST /api/system/cron`.

**Business config**
- `ASSIGNMENT_FEE_CENTS` — assumed wholesale fee for margin estimates (default 1000000 = $10k).

**Optional (leave unset unless used)**
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `APPLE_*` — social login (off if unset).
- `NEXT_PUBLIC_CREATE_*` — legacy scaffold dev-shim flags; leave UNSET in prod (they gate a dev-only social shim that stays inert when unset).
- `RUN_LIVE_FLOWS` — leave unset in prod (CI-only live-flow toggle).

---

## 3. Apply the database schema to prod Neon (idempotent — the deploy test)

Against the **prod** `DATABASE_URL`, apply the base schema then ALL migrations.
Everything is idempotent (`IF NOT EXISTS` / `ON CONFLICT`), proven on a fresh DB
by the CI Layer-C + e2e bootstrap.

**Recommended (one command — applies every `migrations/*.sql` in order):**
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/campaign-pipeline-schema.sql
node apps/web/scripts/migrate.mjs   # globs migrations/*.sql (dollar-quote & comment aware)
```
`migrate.mjs` uses the neon serverless driver over `DATABASE_URL`, so it needs a
Neon URL (same one the app uses). It reports `done — N/N applied (idempotent)`.

Alternatively apply each `apps/web/db/migrations/*.sql` with `psql -f` in numeric
order (001 → 017+). The glob is preferred so new migrations are never missed —
this list previously drifted (stopped at 012) while 013–017 shipped.

The owner (`roman.shumate@dealswiftautomation.com`) becomes ADMIN automatically:
migration 005 upgrades the row if it exists, and the better-auth `user.create` hook
grants ADMIN on first signup for any `SEED_ADMIN_EMAILS` address.

---

## 4. Build + start (host does this automatically on Vercel)

- **Root directory:** `apps/web`
- **Build command:** `yarn build`  (→ `next build`)
- **Start command:** `yarn start`  (→ `next start`)  — Vercel handles this itself.
- **Secrets-in-bundle check:** `yarn check:secrets-in-bundle` (run automatically by `deploy.ps1` right after the build, in the node path) greps `.next/static` — the actual client-shipped JS — for the literal value of every configured server-only secret plus known secret-shaped literal prefixes (`sk_live_`, `sk_test_`, `whsec_`, `sk-ant-`, a Postgres URL with embedded credentials). Fails the deploy if anything is found. Vercel doesn't run this by itself — if wiring it into a CI/CD build step later, run it as a post-build check with the same env the build used.

**BLOCKED-ON-OWNER:** in the Vercel project **`anything-web`**, import the GitHub repo,
set root dir `apps/web`, add the env vars from step 2 (use `apps/web/.env.example`
as the checklist), then add the custom domain `dealswiftautomation.com` (+ `www`) —
Vercel then shows the exact DNS records for step 1.

---

## 5. Background job runner in prod (NOT `yarn jobs:dev`)

`yarn jobs:dev` is dev-only. `apps/web/vercel.json` ships a **DAILY** cron:

```json
{ "crons": [ { "path": "/api/jobs/process", "schedule": "0 8 * * *" } ] }
```

**Why daily, not every-minute:** Vercel **Hobby** caps cron frequency at once per day —
an every-minute schedule (`* * * * *`) makes the deploy FAIL with
*"Cron jobs on the Hobby plan can run at most once per day."* (This was the Vercel
launch error, fixed 2026-07-17 by changing the schedule.) The daily cron is only a
**safety-net drain**.

**Real-time draining is the always-on WORKER, not the cron.** Cadence steps, `ai_reply`,
and sends need seconds-to-minutes latency, which a daily cron cannot provide. In prod,
run the **worker container** (`apps/web/scripts/worker.mjs`) on Fly.io/Railway — it polls
`POST {APP_URL}/api/jobs/process` every `JOB_POLL_INTERVAL_MS` (default 3s) with the
`x-job-runner-secret` header. That is what closes the INT-1 Speed-to-Lead SLA.

**If you want minute-level draining ON Vercel:** upgrade to **Pro** and set the schedule
back to `* * * * *`. The `/api/jobs/process` route accepts both the cron `Authorization:
Bearer $CRON_SECRET` and the worker `x-job-runner-secret: $JOB_RUNNER_SECRET`, and handles
GET + POST — so set `CRON_SECRET` in Vercel and it works with no extra config either way.

---

## 6. Twilio console  — **BLOCKED-ON-OWNER**

In the Twilio console for the sending number / Messaging Service, set the inbound
webhook to **POST** `https://dealswiftautomation.com/api/sms/inbound`. This must
exactly match `PUBLIC_WEBHOOK_URL` (the route validates Twilio's signature against it).

**BLOCKED-ON-OWNER:** requires the owner's Twilio login.

### ⚠️ 6a. 10DLC / campaign registration — HARD GATE on live SMS

**The owner does NOT yet have 10DLC / campaign acceptance.** Until Twilio approves the
brand + campaign registration, **do not enable live outbound SMS** — unregistered A2P
10DLC traffic is filtered/blocked by carriers and can incur penalties. Concretely:
- Keep campaigns in **Personal Test Mode** (allowlisted numbers only) or mock mode.
- Do **not** run the "real SMS loopback" / scale-send verification steps live.
- The inbound webhook + signature verification are fine to wire (receiving costs nothing).
- Flip to live sending only after 10DLC is approved AND quiet-hours/opt-out/DNC are green.

---

## 7. Anthropic billing  — **BLOCKED-ON-OWNER**

The Anthropic key currently authenticates but has **$0 credit** (calls 400 with
"credit balance too low"). Add credits at console.anthropic.com → Plans & Billing,
or AI replies will dead-letter. No code change needed.

---

## 7b. AI provider — hosted Claude OR local Ollama (owner's choice)

The app's AI (classifier/negotiator) runs through one entry point (`callAI`) with a
selectable backend, set in **Settings → AI Provider** (persisted in `app_settings`,
no redeploy) or via env (`AI_PROVIDER=anthropic|ollama`):

- **Anthropic (default)** — best quality; needs `ANTHROPIC_API_KEY` + account credit (step 7).
- **Local (Ollama)** — free per message; run a 6–8 GB open model on a box with ≥8 GB RAM:
  ```bash
  ollama serve                 # server on :11434
  ollama pull llama3.1:8b      # ~4.7 GB (or qwen2.5:7b / mistral:7b)
  ```
  Then set provider = Local, `OLLAMA_BASE_URL` (default `http://localhost:11434`) and
  `OLLAMA_MODEL`, and click **Test connection**. For a Vercel prod deploy the model must
  run on a reachable always-on host (Ollama can't run inside a serverless function) —
  point `OLLAMA_BASE_URL` at that host. Settings → AI Provider → **Test connection** gives
  a live green/red for whichever backend is active.

## 7c. Hosting Ollama reachably for FREE prod AI SMS

Vercel functions can't reach `localhost:11434`, so for free AI in prod the model
must run on a machine you control, exposed over HTTPS **with auth** (raw Ollama has
no authentication — an open endpoint lets anyone burn your compute). The app sends
`Authorization: Bearer $OLLAMA_API_KEY`; enforce that token at the proxy.

**Option A — free, your own machine + Cloudflare Tunnel (recommended to start):**
Keep a machine on running Ollama; a named Cloudflare Tunnel gives a stable HTTPS
hostname with access control, at no cost.
```bash
ollama serve                                   # local model server on :11434
ollama pull qwen2.5:7b
# one-time: install cloudflared, auth, create a named tunnel bound to a hostname
cloudflared tunnel create dealswift-ollama
cloudflared tunnel route dns dealswift-ollama ollama.dealswiftautomation.com
# run it (map the hostname → localhost:11434), ideally as a service so it stays up:
cloudflared tunnel run --url http://localhost:11434 dealswift-ollama
```
Protect it with a **Cloudflare Access service token** (or an Nginx/Caddy bearer check)
and set the SAME token as `OLLAMA_API_KEY` in Vercel. Then in Vercel set
`OLLAMA_BASE_URL=https://ollama.dealswiftautomation.com`, `AI_PROVIDER=ollama` (or
toggle in Settings), `OLLAMA_MODEL=qwen2.5:7b`. Tradeoff: only up while that machine +
tunnel are running — if it's offline, AI replies fail (they don't fall back to
Anthropic automatically). For always-on, use Option B.

**Option B — small always-on box (not free, most reliable):** a VPS / Fly.io / Railway
instance with ≥8 GB RAM running `ollama serve` behind Caddy/Nginx that checks the
bearer. Same env wiring. ~$5–15/mo; survives your PC being off.

**Verify:** Settings → AI Provider → set Local (Ollama) + the URL → **Test connection**
(`/api/system/ai-status` sends the bearer and reports reachable + model present).

> ⚠️ Whatever you pick, the machine must stay on for AI to work. If you want
> zero-maintenance, fund Anthropic instead and set `AI_PROVIDER=anthropic`.

### What "host Ollama reachably" concretely requires to run a LIVE campaign
The prod job runner calls Ollama for **every AI reply**, so for a live campaign ALL of these
must hold for as long as the campaign is active:
1. **A machine that stays on** with ≥8 GB free RAM running `ollama serve` and the model pulled
   (`ollama pull qwen2.5:7b`). If it sleeps/reboots/loses power, AI replies dead-letter (no
   fallback). Your laptop works for testing; a small always-on VPS/Fly.io box is the reliable
   choice for a real campaign.
2. **A public HTTPS URL** reaching that machine's `:11434` — a named Cloudflare Tunnel
   (`https://ollama.dealswiftautomation.com`) or the VPS's own TLS. Vercel functions cannot reach
   `localhost`, so the URL must be internet-reachable from Vercel.
3. **Auth on that URL** — raw Ollama has none. Put a bearer check at the proxy/tunnel and set the
   SAME token as `OLLAMA_API_KEY` in Vercel. An open endpoint = anyone burns your compute.
4. **Vercel env set:** `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=<the https url>`,
   `OLLAMA_MODEL=qwen2.5:7b`, `OLLAMA_API_KEY=<token>` — then Settings → AI Provider →
   **Test connection** must be green before you launch.
5. **Throughput reality:** a 7–8B model on modest hardware answers in seconds, not milliseconds —
   fine for SMS cadence + quiet-hours pacing, but it will not match hosted-Claude latency or
   negotiation quality. For higher close rates on a real campaign, `AI_PROVIDER=anthropic`.

## 8. First-deploy checklist

1. [ ] Neon prod branch created; `DATABASE_URL` copied.
2. [ ] Schema + migrations applied (step 3); `psql` exits 0 on all migrations.
3. [ ] Vercel project imported (root `apps/web`), all step-2 env vars set.
4. [ ] Custom domain added in Vercel; DNS records from step 1 set at registrar; TLS green.
5. [ ] `vercel.json` cron committed (step 5); first cron run drains a test job.
6. [ ] Twilio inbound webhook → prod URL (step 6).
7. [ ] Anthropic account funded (step 7).
8. [ ] Smoke test: register `@dealswiftautomation.com` admin → dashboard loads; a
       non-allowed-domain email is rejected; send one test-mode SMS round trip.

## 9. Redeploy (one-liner)

Auto-deploy is on: **push to `main`** → the 4 CI jobs run → Vercel builds + deploys
the branch. No manual step.

```bash
git push origin main
```

---

_Not legal advice: confirm SMS/marketing compliance (10DLC registration, opt-in
language, quiet hours) and Lead Finder source terms with counsel before launch._
---

## 7. Toll-free verification — the legit higher-throughput path (Phase T)

There is **no legitimate cheap/high-limit bypass of A2P for cold traffic** —
unregistered routes get carrier-filtered and create compliance exposure. Two
supported paths:

1. **10DLC / A2P** (what you're registering) — for standard local-number
   business SMS. Required before any `twilio-live` cold send.
2. **Toll-free verification** — a genuinely higher-throughput lane, verified
   separately from A2P. Faster to approve than a fully-vetted 10DLC campaign and
   supports higher daily volumes. The `TollFreeStub` driver
   (`smsProvider` mode `toll-free`) is stubbed with `// LIVE:` markers and
   config fields (`TOLL_FREE_NUMBER`, `TOLL_FREE_VERIFICATION_STATUS`).

**To verify a toll-free number:** in the Twilio console, buy a toll-free number →
Messaging → Toll-Free Verification → submit business + use-case + opt-in proof.
Approval is typically days. Once `TOLL_FREE_VERIFICATION_STATUS=verified`, wire
the real send in `TollFreeStub.send` (replace the `// LIVE:` block) and select
the `toll-free` driver.

**`twilioDemo` (allowlist-only) is for exercising the real Twilio API TODAY,
safely** — it delivers ONLY to numbers you've verified in the Test Numbers page.
It is not a production path; it's how you prove the end-to-end pipeline before
A2P clears.
