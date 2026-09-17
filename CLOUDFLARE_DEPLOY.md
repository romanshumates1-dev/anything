# Cloudflare deployment for DealSwift Automation

This repository is configured to deploy the Next.js web app to **Cloudflare
Workers** with the OpenNext adapter. The app keeps its existing server-rendered
pages, API routes, Better Auth sessions, and Neon database connection.

## Important plan limits

Cloudflare's free tier does not promise unlimited Worker execution. It provides
free CDN delivery for cached/static traffic, but the Workers Free plan has a
daily request quota and CPU/runtime limits. Cloudflare may still charge or
require an upgrade if the app exceeds the free Workers limits. Database, AI,
Twilio, and domain-registration costs are separate from Cloudflare.

## One-time Cloudflare setup

1. Create or log in to a Cloudflare account.
2. Add `dealswiftautomation.com` as a website.
3. At the domain registrar, replace the current nameservers with the two
   Cloudflare nameservers shown in the Cloudflare dashboard. Do not add guessed
   A records while the zone is still pending.
4. In **Workers & Pages**, create/import the GitHub repository
   `romanshumates1-dev/anything`.
5. Configure the Worker project:
   - Root directory: `apps/web`
   - Build command: `yarn deploy`
   - Production branch: the branch containing this configuration
6. Add the custom domain `dealswiftautomation.com` and `www.dealswiftautomation.com`
   to the Worker. Cloudflare will create the required proxied DNS records.
7. Add every production variable from
   [`apps/web/.env.production.template`](apps/web/.env.production.template) as
   encrypted Worker secrets/variables. Never commit their values.

## Local deploy

From the repository root:

```powershell
corepack enable
yarn install
yarn workspace web cf-typegen
yarn workspace web deploy
```

Authenticate once with `wrangler login` if Wrangler opens an authentication
prompt. For CI, use Cloudflare's Git integration or set
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as CI secrets.

To preview the Worker runtime locally:

```powershell
yarn workspace web preview
```

## Database and scheduled work

Cloudflare Workers can serve the app, but the existing
`/api/jobs/process` endpoint is not an always-on queue worker. Keep the
production job runner on a separately scheduled service, or configure a
Cloudflare Cron Trigger to call the endpoint with the `JOB_RUNNER_SECRET`.
Apply the Neon schema and migrations before allowing authenticated traffic;
the commands are documented in [`DEPLOY.md`](DEPLOY.md).

## Verification

After deployment, verify:

```powershell
curl.exe -I https://dealswiftautomation.com
curl.exe https://dealswiftautomation.com/api/system/health
```

Then complete the sign-in flow and confirm that the app can reach the
production Neon database. A successful Worker deployment alone does not prove
that production secrets, migrations, AI credentials, or Twilio webhooks are
configured.
