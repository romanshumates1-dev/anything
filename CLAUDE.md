# DealFlow AI - Claude Code Configuration

## Project Overview
Real estate wholesaling automation platform with AI-powered outreach, CRM, lead finder, and contract management.

## Tech Stack
- **Frontend**: Next.js 14 (App Router), React 18, TailwindCSS
- **Backend**: Next.js API routes, PostgreSQL (Neon serverless)
- **AI**: AWS Bedrock (Claude Haiku 4.5), Ollama fallback
- **Messaging**: AWS SES (email), AWS SNS (SMS), Twilio (10DLC)
- **Auth**: Better Auth with RBAC (ADMIN/MEMBER roles)

## MCP Servers (Configured)
The `.claude/mcp.json` file configures these MCP servers:

| Server | Purpose | Setup Required |
|--------|---------|----------------|
| **postgres** | Direct DB queries, schema inspection | Auto (uses DATABASE_URL) |
| **github** | PRs, issues, actions | Set `GITHUB_TOKEN` env var |
| **filesystem** | Project file access | None |
| **fetch** | HTTP requests, API testing | None |
| **puppeteer** | Browser automation, screenshots | None |
| **aws** | SES, SNS, Bedrock, CloudWatch | Set AWS credentials in env |
| **brave-search** | Web search for docs/research | Set `BRAVE_API_KEY` env var |
| **memory** | Persistent context | None |
| **sequential-thinking** | Complex reasoning | None |
| **time** | Timezone utilities | None |

### Activating MCP Servers
1. Restart Claude Code after creating `.claude/mcp.json`
2. Set environment variables for servers that need them:
   ```bash
   export GITHUB_TOKEN="ghp_..."
   export BRAVE_API_KEY="BSA..."
   export AWS_ACCESS_KEY_ID="AKIA..."
   export AWS_SECRET_ACCESS_KEY="..."
   ```
3. MCP tools will appear in Claude Code's tool list

## Key Directories
```
apps/web/                    # Main Next.js application
  src/app/api/               # API routes
    utils/                   # AI providers, auth, jobs
    services/                # Email, SMS, contract notifications
    campaigns/               # Campaign management
    lead-finder/             # Lead discovery
  src/components/            # React components
  db/                        # Schema and migrations
  scripts/                   # CLI tools, workers, verification
  e2e/                       # Playwright tests
apps/desktop/                # Electron desktop app
```

## Common Commands
```bash
# Start dev server
cd apps/web && yarn dev

# Run job worker
node --env-file=.env scripts/jobs-dev.mjs

# Run E2E verification
node --env-file=.env scripts/verify-pipeline-e2e.mjs

# Type checking
yarn typecheck

# Tests
yarn vitest run

# Linting
npx oxlint --no-ignore apps/web/src
```

## Environment Variables
Required in `apps/web/.env`:
- `DATABASE_URL` - Neon PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Auth secret
- `AWS_*` - AWS credentials for SES/SNS/Bedrock
- `TWILIO_*` - Twilio for 10DLC SMS
- `AI_PROVIDER` - "bedrock" or "ollama"
- `BEDROCK_MODEL_*` - Model IDs for AI tasks

## Conventions
- Use Neon serverless client (`@neondatabase/serverless`)
- All API routes require session auth via `requireSession()`
- ADMIN role required for: API key management, user management, AI settings
- Jobs use `apps/web/src/app/api/utils/jobs.ts` queue system
- Campaigns follow multi-touch sequence with compliance footers

## Database
- Host: Neon serverless PostgreSQL
- Migrations: `apps/web/db/migrations/`
- Schema: `apps/web/db/schema.sql`
- Use `sql` tagged template from `@neondatabase/serverless`

## Testing
- Unit: Vitest
- E2E: Playwright with Edge browser (`PW_CHANNEL=msedge`)
- Auth state stored in `e2e/.auth/state.json`
