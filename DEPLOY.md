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

Against the **prod** `DATABASE_URL`, apply in order (all statements are idempotent —
`IF NOT EXISTS` / `ON CONFLICT`, proven on a fresh DB by the CI e2e bootstrap):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/campaign-pipeline-schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/migrations/001_add_missing_tables.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/migrations/002_pause_ai.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/migrations/003_auth_tables.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/migrations/004_assignment_fee.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/migrations/005_user_roles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/web/db/migrations/006_lead_finder.sql
```

The owner (`roman.shumate@dealswiftautomation.com`) becomes ADMIN automatically:
migration 005 upgrades the row if it exists, and the better-auth `user.create` hook
grants ADMIN on first signup for any `SEED_ADMIN_EMAILS` address.

---

## 4. Build + start (host does this automatically on Vercel)

- **Root directory:** `apps/web`
- **Build command:** `yarn build`  (→ `next build`)
- **Start command:** `yarn start`  (→ `next start`)  — Vercel handles this itself.

**BLOCKED-ON-OWNER:** in the Vercel project **`anything-web`**, import the GitHub repo,
set root dir `apps/web`, add the env vars from step 2 (use `apps/web/.env.production.template`
as the checklist), then add the custom domain `dealswiftautomation.com` (+ `www`) —
Vercel then shows the exact DNS records for step 1.

---

## 5. Background job runner in prod (NOT `yarn jobs:dev`)

`yarn jobs:dev` is dev-only. In prod the queue is drained by **Vercel Cron**, already
wired: `apps/web/vercel.json` is committed with

```json
{ "crons": [ { "path": "/api/jobs/process", "schedule": "* * * * *" } ] }
```

Vercel Cron issues a **GET** every minute with `Authorization: Bearer $CRON_SECRET`.
The `/api/jobs/process` route accepts BOTH that bearer (cron) and the
`x-job-runner-secret: $JOB_RUNNER_SECRET` header (the dev poller / docker), and
handles GET + POST — so just set `CRON_SECRET` in Vercel and it works with no extra
config. (Minute-level cron needs Vercel **Pro**; on Hobby, either accept the reduced
frequency or run a GitHub Actions scheduled workflow that `curl`s the prod URL with
the `x-job-runner-secret` header from a repo secret. A small Fly.io/Railway worker
running the `scripts/jobs-dev.mjs` poll loop against the prod URL also works.)

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

## 8. First-deploy checklist

1. [ ] Neon prod branch created; `DATABASE_URL` copied.
2. [ ] Schema + migrations applied (step 3); `psql` exits 0 on all 8.
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
