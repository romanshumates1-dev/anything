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
2. Set webhook URL: `https://your-domain.com/api/sms/inbound?secret=$SMS_INBOUND_SECRET`

#### AWS SNS Webhooks (if using SNS)

1. Create an SNS topic for delivery receipts
2. Subscribe your endpoint: `https://your-domain.com/api/sms/inbound?secret=$SMS_INBOUND_SECRET`

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

## Support

- **Documentation**: See `/docs` folder for detailed guides
- **Issues**: Report bugs via GitHub Issues
- **Email**: Contact support at the `SUPPORT_EMAIL` configured in your instance
