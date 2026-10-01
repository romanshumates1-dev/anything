# DealFlow AI Deployment Guide

Production deployment guide for the DealFlow AI real estate wholesaling platform.

## Prerequisites

### System Requirements
- **Node.js**: v20.x or later (LTS recommended)
- **Yarn**: v4+ with Corepack (`corepack enable`)
- **Memory**: 1GB+ for build, 512MB+ runtime

### External Services
- **PostgreSQL**: Neon serverless database (or compatible Postgres 14+)
- **AWS Account**: For SES (email), SNS (SMS), and optionally Bedrock (AI)
- **Twilio Account**: Optional, for 10DLC SMS compliance
- **Stripe Account**: For subscription billing and credit purchases

---

## Environment Variables

### Required (Application will not start without these)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string | `postgresql://user:pass@host.neon.tech/db?sslmode=require` |
| `BETTER_AUTH_SECRET` | Random 32+ character string for session signing | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Application URL (canonical, used for redirects) | `https://app.dealflow.ai` |

### Required for Payments (Production)

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe secret key | `sk_live_...` (production) or `sk_test_...` (sandbox) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe dashboard | `whsec_...` |
| `STRIPE_PROVIDER` | Provider mode: `live` for production, `mock` for development | `live` |

### Required for Messaging (At least one provider)

#### Option A: AWS SNS (Recommended - Lower cost)

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | AWS IAM access key | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key | (secret) |
| `AWS_REGION` | AWS region for SNS | `us-east-1` |
| `AWS_SNS_SMS_ENABLED` | Enable SNS SMS delivery | `true` |
| `AWS_SNS_VERIFY_SIGNATURES` | Verify inbound SNS signatures | `true` |

#### Option B: Twilio (10DLC Compliant)

| Variable | Description | Example |
|----------|-------------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID | `AC...` |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | (secret) |
| `TWILIO_MESSAGING_SERVICE_SID` | Messaging service for 10DLC | `MG...` |
| `TWILIO_FROM_NUMBER` | Fallback sender number | `+1555...` |
| `TWILIO_NUMBER_TYPE` | Number type for compliance | `10dlc` |
| `OWNER_NUMBER` | Your personal number for alerts | `+1555...` |

### Required for AI

| Variable | Description | Example |
|----------|-------------|---------|
| `AI_PROVIDER` | AI backend: `ollama` (free), `bedrock` (AWS), or `anthropic` | `bedrock` |

**For AWS Bedrock** (uses AWS credentials above):

| Variable | Description | Example |
|----------|-------------|---------|
| `BEDROCK_MODEL_NEGOTIATE` | Model ID for AI negotiation | `us.anthropic.claude-3-haiku-20240307-v1:0` |
| `BEDROCK_MODEL_CLASSIFY` | Model ID for lead classification | `us.anthropic.claude-3-haiku-20240307-v1:0` |
| `BEDROCK_MONTHLY_CEILING_USD` | Monthly spend limit | `50` |

**For Anthropic API**:

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | `sk-ant-...` |
| `ANTHROPIC_MODEL` | Model to use | `claude-sonnet-4-6` |

**For Ollama** (Free, self-hosted):

| Variable | Description | Example |
|----------|-------------|---------|
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Model name | `qwen2.5:7b` |

### Required for Email

| Variable | Description | Example |
|----------|-------------|---------|
| `EMAIL_PROVIDER` | Email backend: `ses`, `smtp`, or `gemini` | `ses` |
| `EMAIL_FROM_ADDRESS` | Verified sender address | `noreply@yourdomain.com` |

**For AWS SES** (uses AWS credentials above):

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_SES_REGION` | SES region (if different from `AWS_REGION`) | `us-east-1` |
| `AWS_SES_FROM_ADDRESS` | Verified sender for SES | `noreply@yourdomain.com` |

**For SMTP**:

| Variable | Description | Example |
|----------|-------------|---------|
| `SMTP_USER` | SMTP username | `user@smtp.example.com` |
| `SMTP_PASS` | SMTP password | (secret) |

### Background Jobs & Cron

| Variable | Description | Example |
|----------|-------------|---------|
| `JOB_RUNNER_SECRET` | Secret for job processor endpoint | `openssl rand -hex 16` |
| `CRON_SECRET` | Secret for cron endpoints | `openssl rand -hex 16` |
| `SMS_INBOUND_SECRET` | Secret for inbound SMS/email webhooks | `openssl rand -hex 16` |
| `JOB_POLL_INTERVAL_MS` | Job poll interval in ms (default 3000) | `3000` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Public app URL for links | `http://localhost:4000` |
| `APP_VERSION` | Version shown in health endpoint | `0.1.0` |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated allowed signup domains | (all allowed) |
| `MIN_ACCESS_ROLE` | Minimum role for access: `ADMIN`, `MEMBER` | `ADMIN` |
| `SEED_ADMIN_EMAILS` | Emails auto-promoted to ADMIN on signup | (none) |
| `LEGAL_ENTITY_NAME` | Company name for legal pages | (hidden if unset) |
| `LEGAL_ENTITY_STATE` | State of incorporation | (hidden if unset) |
| `SUPPORT_EMAIL` | Support contact email | (hidden if unset) |
| `POSTAL_ADDRESS` | Company postal address for CAN-SPAM | (required for email campaigns) |
| `ASSIGNMENT_FEE_CENTS` | Default wholesale fee estimate | `1000000` ($10,000) |
| `OWNER_TIMEZONE` | Timezone for business hours | `America/New_York` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | (disabled if unset) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | (disabled if unset) |
| `APPLE_CLIENT_ID` | Apple OAuth client ID | (disabled if unset) |
| `APPLE_CLIENT_SECRET` | Apple OAuth secret | (disabled if unset) |
| `TWILIO_10DLC_ASSIGNED_MPS` | 10DLC messages per second limit | `1` |
| `TWILIO_10DLC_TMOBILE_DAILY_CAP` | T-Mobile daily message cap | `2000` |

---

## Deployment Steps

### 1. Database Setup

1. Create a Neon project at [neon.tech](https://neon.tech)
2. Copy the connection string to `DATABASE_URL`
3. Run the schema bootstrap:

```bash
# Apply the schema (idempotent - safe to run multiple times)
psql $DATABASE_URL -f db/schema.sql
```

The schema includes all required tables: `user`, `session`, `leads`, `campaigns`, `jobs`, `ai_conversations`, `audit_logs`, etc.

### 2. Configure Environment

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Fill in required variables (minimum):
```bash
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=https://your-domain.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
JOB_RUNNER_SECRET=$(openssl rand -hex 16)
CRON_SECRET=$(openssl rand -hex 16)
```

3. Configure at least one messaging provider (AWS SNS or Twilio)
4. Configure at least one AI provider

### 3. Build the Application

```bash
# Install dependencies
yarn install

# Type check (optional but recommended)
yarn typecheck

# Build for production
yarn build
```

### 4. Deploy

#### Option A: Docker (Recommended for self-hosted)

```bash
# Build the image
docker build -t dealflow-ai .

# Run with environment file
docker run -d \
  --name dealflow \
  --env-file .env \
  -p 4000:4000 \
  dealflow-ai
```

#### Option B: Vercel

1. Connect your repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on push

Note: Vercel uses its own output format. The `VERCEL=1` environment variable is auto-set and disables standalone output.

#### Option C: Node.js (Direct)

```bash
# Start the production server
NODE_ENV=production yarn start
```

#### Option D: Cloudflare Workers (staged)

The same codebase deploys as a Cloudflare Worker via `@opennextjs/cloudflare`.
This is the target production runtime; it is currently STAGED on
`*.workers.dev` with the apex untouched. Full runbook:
[Cloudflare Workers deploy](#cloudflare-workers-deploy).

```bash
cd apps/web
yarn cf:deploy        # build + size gate + secret scan + wrangler deploy
```

### 5. Configure Background Jobs

The job processor must be triggered periodically. Options:

**A. External Cron (Recommended)**

Set up a cron job or external service (e.g., cron-job.org, AWS CloudWatch) to call:

```bash
# Every 3 seconds for near-realtime job processing
curl -X POST "https://your-domain.com/api/jobs/process" \
  -H "x-cron-secret: $JOB_RUNNER_SECRET"
```

**B. Worker Process**

Run the job worker alongside the web server:

```bash
node --env-file=.env scripts/jobs-dev.mjs
```

### 6. Configure Webhooks

#### Stripe Webhooks

1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://your-domain.com/api/payments/webhook`
3. Select events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.*`
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

#### Twilio Webhooks (if using Twilio)

1. Go to Twilio Console > Messaging > Services
2. Set webhook URL: `https://your-domain.com/api/sms/inbound`
   - Auth is Twilio's `x-twilio-signature`, validated against
     `TWILIO_AUTH_TOKEN` + `PUBLIC_WEBHOOK_URL`. This route does **not** read a
     `?secret=` query parameter.

#### AWS SNS Webhooks (if using SNS)

1. Create an SNS topic for delivery receipts
2. Subscribe your endpoint: `https://your-domain.com/api/sms/sns-inbound`
   - The SNS route verifies the SNS message signature. Subscribing
     `/api/sms/inbound` with `?secret=` would fail: that route's JSON branch
     authenticates with the `x-sms-secret` **header** and returns 401 without it.

### 7. Verify Deployment

```bash
# Check health (public)
curl https://your-domain.com/api/system/health

# Expected response:
# {"ok":true,"status":"healthy","services":{"db":true,"jobs":true,"ai":true,"sms":true},...}
```

---

## Health Checks

### Public Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/system/health` | GET | None | Liveness probe for load balancers |

Response:
```json
{
  "ok": true,
  "status": "healthy",
  "uptime": 3600,
  "version": "0.1.0",
  "services": {
    "db": true,
    "jobs": true,
    "ai": true,
    "sms": true
  },
  "timestamp": "2026-09-08T12:00:00.000Z"
}
```

- Returns `200` when `ok: true` (db + jobs reachable)
- Returns `503` when `ok: false` (degraded)

### Admin Endpoints (Require ADMIN role)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/system/readiness` | GET | ADMIN | Full readiness with table inventory, job stats |
| `/api/system/database` | GET | ADMIN | Database connection and table details |
| `/api/system/queue-status` | GET | ADMIN | Job queue statistics |
| `/api/system/metrics` | GET | ADMIN | Application metrics |
| `/api/system/ai-status` | GET | ADMIN | AI provider status |

---

## Troubleshooting

### Application Won't Start

**Error: "No database connection string was provided"**
- Ensure `DATABASE_URL` is set and valid
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`

**Error: "BETTER_AUTH_SECRET is required"**
- Generate a secret: `openssl rand -base64 32`

### Health Check Fails

**`db: false`**
- Check `DATABASE_URL` is correct
- Verify Neon project is active (not paused)
- Check network connectivity to `*.neon.tech`

**`jobs: false`**
- Run schema migration to create `jobs` table
- Check database permissions

**`ai: false`**
- Verify AI provider credentials
- For Ollama: ensure server is running (`ollama serve`)
- For Bedrock: check AWS credentials and permissions
- For Anthropic: verify `ANTHROPIC_API_KEY`

**`sms: false`**
- Configure Twilio credentials OR AWS SNS credentials
- At least one SMS provider must be configured

### Jobs Not Processing

1. Verify `JOB_RUNNER_SECRET` matches your cron configuration
2. Check cron is calling `/api/jobs/process` with correct header
3. Review job queue: `SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at LIMIT 10`

### Webhook Errors

**Stripe signature verification failed**
- Ensure `STRIPE_WEBHOOK_SECRET` matches your Stripe dashboard
- Verify the endpoint URL is correct

**Twilio signature verification failed**
- Check `TWILIO_AUTH_TOKEN` is correct
- Ensure webhook URL exactly matches Twilio console

### Email Not Sending

1. Verify sender address is verified in SES (if using AWS)
2. Check SES is not in sandbox mode (production requires request)
3. Verify SMTP credentials if using SMTP provider

### SMS Not Sending

**AWS SNS**
- Verify account is out of SMS sandbox
- Check spending limit in SNS console
- Ensure phone numbers are in E.164 format

**Twilio**
- Verify messaging service is properly configured
- Check 10DLC registration status
- Ensure phone numbers are verified (trial) or compliant (production)

---

## Security Checklist

Before going live, verify:

- [ ] `BETTER_AUTH_SECRET` is a strong random string (not example value)
- [ ] `JOB_RUNNER_SECRET`, `CRON_SECRET`, `SMS_INBOUND_SECRET` are unique random strings
- [ ] `STRIPE_PROVIDER=live` for production payments
- [ ] `ALLOWED_EMAIL_DOMAINS` is set if restricting signups
- [ ] All API secrets are stored securely (not in code)
- [ ] HTTPS is enforced (redirect HTTP to HTTPS)
- [ ] Database connection uses SSL (`?sslmode=require`)
- [ ] Webhook secrets are configured for Stripe, Twilio, SNS
- [ ] Rate limiting is configured at infrastructure level (CDN/proxy)

---

## Scaling Considerations

### Database
- Neon scales automatically for serverless workloads
- Consider connection pooling for high-traffic scenarios
- Monitor query performance in Neon dashboard

### Job Processing
- Increase cron frequency for higher throughput
- Run multiple job worker instances for parallel processing
- Monitor job queue depth: `SELECT status, count(*) FROM jobs GROUP BY status`

### Messaging
- 10DLC has carrier-specific rate limits (T-Mobile: 2000/day default)
- Request throughput increases from Twilio for higher volumes
- Consider toll-free for higher throughput (requires verification)

---

## Cloudflare Workers deploy

The web app builds and runs as a Cloudflare Worker via `@opennextjs/cloudflare`.
`wrangler.jsonc` and `.dev.vars.example` reference this section as the operator
runbook.

### Topology

| Piece | Location | Notes |
|-------|----------|-------|
| Worker | `dealswift-app` (`wrangler.jsonc`) | Staged URL: `https://dealswift-app.romanshumates1.workers.dev` |
| Entry point | `apps/web/custom-worker.ts` | Re-exports the OpenNext `fetch` handler and adds `scheduled` for Cron Triggers. |
| Static assets | `assets` → `.open-next/assets` (binding `ASSETS`) | Served by the assets binding — free and unmetered on every plan. |
| Compatibility | `nodejs_compat` | `enable_nodejs_tcp_sockets` is deliberately OFF (see Known constraints). |
| Cron Triggers | `triggers.crons` | 3 schedules, dispatched by `routeForCron()` in `custom-worker.ts`. |

Deploy is **staged**: no `routes` entry, so the Worker stays on `*.workers.dev`
and the live WordPress site on the apex is untouched. Adding an apex route
REPLACES the DNS records serving WordPress — that is the cutover moment (see
"Apex cutover" below).

### Prerequisites

- Workers **Paid** plan — the compiled script is ~8.5 MB gzip, above the Free
  3 MB cap (`cf:size` passes `10485760`, the Paid cap).
- `npx wrangler whoami` shows the target account (OAuth or `CLOUDFLARE_API_TOKEN`).
- Neon `DATABASE_URL` reachable from Workers (pooled endpoint).

### Commands (run from `apps/web`)

| Command | Effect |
|---------|--------|
| `yarn cf:build` | `opennextjs-cloudflare build` → `scrub-opennext-env.mjs` → `patch-opennext-instrumentation.mjs` |
| `yarn cf:size` | `wrangler deploy --dry-run --outdir .wrangler/dry-run-out`, then the gzip size gate |
| `yarn cf:gate` | `cf:build` + `cf:size` + secret scan of the dry-run output — the deploy gate |
| `yarn cf:deploy` | `cf:gate`, then `node scripts/wrangler-deploy.mjs` (sets `OPEN_NEXT_DEPLOY` portably — see below) |
| `yarn cf:preview` | Build + `opennextjs-cloudflare preview` (local workerd) |
| `yarn cf:typecheck` | Build + `tsc -p tsconfig.cloudflare.json` |
| `yarn cf:typegen` | Regenerate `cloudflare-env.d.ts` from the wrangler config |

Windows notes:

- Run wrangler commands with `apps/web` as cwd; wrangler refuses to run from the
  monorepo workspace root. `check-worker-size.mjs` re-roots itself when invoked
  from the repo root.
- `scripts/rebuild-and-deploy.mjs` is the one-shot orchestrator
  (build → gate → deploy) that passes `OPEN_NEXT_DEPLOY` as a real environment
  variable — the `VAR=x command` inline syntax is not portable to cmd. It logs
  to `D:\tmp\rebuild-deploy.log`.
- **`cf:deploy` was Windows-broken and is now fixed (2026-10-01).** It used to
  inline `OPEN_NEXT_DEPLOY=true wrangler deploy`, which is POSIX syntax. npm on
  Windows runs lifecycle scripts through cmd.exe, so it tried to execute the
  literal string `OPEN_NEXT_DEPLOY=true` as a program and failed with
  `'OPEN_NEXT_DEPLOY' is not recognized as an internal or external command`.
  Because the gate runs first, the operator paid a full ~4 min build + size
  gate + secret scan and then deployed nothing. `cf:deploy` now calls
  `scripts/wrangler-deploy.mjs`, which sets the variable in the child's
  `env` — the portable form that behaves identically on cmd.exe, PowerShell,
  bash and zsh.
- CI (`.github/workflows/ci.yml`) does not run the Cloudflare gates yet;
  `cf:gate` is an operator step. Add it to CI for deploy-parity on PRs.

### What the gates enforce

- **Script size** — Cloudflare meters the compiled Worker AFTER compression
  (3 MB Free / 10 MB Paid). `check-worker-size.mjs` gzips exactly the files
  `wrangler deploy --dry-run` would upload (static assets excluded) and fails
  closed. It prefers wrangler's own reported gzip figure; its local recount is
  the fallback, and a >5% divergence is printed.
- **No secrets in shipped artifacts** — `scrub-opennext-env.mjs` blanks
  `.open-next/cloudflare/next-env.mjs`, which the adapter fills with every
  value from `.env`; `check-secrets-in-bundle.mjs` then scans the client
  bundle, `.open-next` and the wrangler dry-run output for the configured
  secret VALUES and for secret-shaped literals (`sk_live_`, `whsec_`,
  `sk-ant-`, `AKIA…`, credential-bearing `postgres://` URLs). Both were added
  after a real leak.

### Secrets

- **Local / preview:** `cp .dev.vars.example .dev.vars`, fill in; used by
  `yarn cf:preview` and `wrangler dev`. `.dev.vars*` is gitignored except the
  `.example`.
- **Production:** `.dev.vars.prod` holds the production overrides (apex
  `BETTER_AUTH_URL` / `PUBLIC_WEBHOOK_URL`; `RUN_LIVE_FLOWS=0` and
  `AWS_SNS_SMS_ENABLED=false` for the first cutover so cron triggers cannot
  send real SMS/email until verified). Upload with:

  ```bash
  npx wrangler secret bulk .dev.vars.prod   # 32 keys as of 2026-09-19
  ```

- Rotate one key with `npx wrangler secret put NAME` — a secret change creates a
  new Worker version but does not rebuild the bundle.
- `NEXT_PUBLIC_*` values are inlined at BUILD time, not read at runtime — they
  must be present in the build environment, not (only) as Worker secrets.

### Cron Triggers

Three UTC schedules in `wrangler.jsonc`; `custom-worker.ts` maps each to an
internal route in `routeForCron()`. Keep both sides in sync — an unmapped
expression logs an error rather than doing nothing silently, and the internal
routes fail closed when their secrets are missing.

| Cron | Route | Purpose |
|------|-------|---------|
| `*/5 * * * *` | `POST /api/jobs/process` | job-queue drain (speed-to-lead SLA) |
| `*/15 * * * *` | `POST /api/pipeline/cron` | pipeline orchestration + digests |
| `0 8 * * *` | `POST /api/jobs/process` | end-of-day drain sweep |

Workers Free allows 5 cron triggers per account — this stays at 3.

### Known constraints

- **SMTP is not viable** (outbound ports 25/587 blocked). Email runs through the
  SES HTTPS API (`EMAIL_PROVIDER=ses`); `enable_nodejs_tcp_sockets` stays off.
- **Ollama is not viable** (localhost TCP + GPU). `AI_PROVIDER` must be
  `anthropic` or `bedrock`; the runtime refuses localhost providers on workerd.
- **Standalone output is Docker-only.** `next.config.js` disables it when
  `VERCEL`, `OPEN_NEXT` or `CLOUDFLARE` is set — a manual `CLOUDFLARE=1 yarn
  build` produces a Worker-oriented build that will NOT run under Docker.
- `www` must 301-redirect to the apex (Cloudflare Redirect Rule):
  `csrfProtection.ts` compares hosts and would reject www POSTs.

### Verify a deploy

Expect `200` and `"ok":true` with all services true:

```bash
curl -s https://dealswift-app.romanshumates1.workers.dev/api/system/health
```

Expect `401` — secret-gated routes fail closed without credentials:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://dealswift-app.romanshumates1.workers.dev/api/jobs/process
```

Also confirm the three cron schedules (dashboard → Workers & Pages →
`dealswift-app` → Settings → Triggers) and that `robots.txt` advertises the
apex sitemap (`NEXT_PUBLIC_APP_URL` is build-time).

Last staged verification (2026-09-19): health 200 with `db/jobs/ai/sms` all
true; homepage, pricing, account/signin 200; CSP and the other security headers
present; three cron schedules registered; `/api/jobs/process` 401 without
credentials; bundle ≈8.5 MB gzip of the 10 MB Paid cap.

### Apex cutover (staged → live)

⚠️ This REPLACES the DNS records currently serving the WordPress site on
`dealswiftautomation.com`.

1. Confirm the staged Worker is healthy and the verification above passes.
2. Add the `www` → apex 301 Redirect Rule in Cloudflare.
3. Add routes to `wrangler.jsonc`:

   ```jsonc
   "routes": [{ "pattern": "dealswiftautomation.com", "custom_domain": true }]
   ```

4. `yarn cf:gate && yarn cf:deploy` (or `scripts/rebuild-and-deploy.mjs`).
5. Enable live flows (`RUN_LIVE_FLOWS=1`, messaging flags) only after the flows
   are verified on the cutover host.

### Rollback

- Previous Worker version: `npx wrangler rollback`.
- Back to WordPress: remove the `routes` entry, redeploy, restore the DNS
  records.
- The bundle is environment-free (env file scrubbed at build time), so the same
  artifact can be rolled forward/back without a rebuild.

---

## Support

- **Documentation**: See `/docs` folder for detailed guides
- **Issues**: Report bugs via GitHub Issues
- **Email**: Contact support at the `SUPPORT_EMAIL` configured in your instance
