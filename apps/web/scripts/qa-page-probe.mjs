/**
 * Page-route HTTP baseline probe for authenticated QA.
 *
 * PURPOSE
 * -------
 * Before (and alongside) a real browser pass, establish which routes are
 * reachable for the controlled QA account and which are not, WITH the reason.
 * This distinguishes four outcomes that a bare "did it 200" check conflates:
 *
 *   200          route served
 *   3xx -> X     redirected somewhere; `X` tells us WHICH gate
 *   401/403      rejected (session or authorization)
 *   5xx          server fault — a real defect, not a pass
 *
 * A route that merely returns 200 is NOT counted as passing here; this is a
 * routing/authorization baseline that tells the browser pass where to look.
 *
 * CREDENTIALS
 * -----------
 * Read from the environment or `<temp>/qa-cred.json`. Nothing is stored in the
 * repository. See `qa-accept.mjs` for the same convention.
 *
 * USAGE
 *   node scripts/qa-page-probe.mjs
 *   QA_BASE=https://dealswift-loadtest.<acct>.workers.dev node scripts/qa-page-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function loadCredentials() {
  const credFile = process.env.QA_CRED_FILE || join(tmpdir(), 'qa-cred.json');
  let fromFile = {};
  try {
    fromFile = JSON.parse(readFileSync(credFile, 'utf8'));
  } catch {
    /* env-only is fine */
  }
  const email = process.env.QA_EMAIL || fromFile.email;
  const password = process.env.QA_PASSWORD || fromFile.password;
  const base = (process.env.QA_BASE || fromFile.base || '').replace(/\/+$/, '');
  if (!email || !password || !base) {
    console.error('Set QA_EMAIL + QA_PASSWORD (or QA_CRED_FILE / QA_BASE).');
    process.exit(2);
  }
  return { email, password, base };
}

/**
 * Route lists are taken from the BUILD MANIFEST, not guessed.
 *
 * A first pass of this script hand-wrote plausible paths and reported eleven
 * 404s — `/campaigns/new`, `/billing`, `/onboarding`, `/support`,
 * `/admin/stats`, `/contacts` — every one of which was simply the wrong name.
 * The real routes are `/campaigns/wizard`, `/settings/billing`, `/welcome`,
 * `/admin`, and `/crm` + `/leads`. That is the documented false-negative trap
 * in this project, so the list below mirrors `.next/server/app-paths-manifest.json`
 * rather than being invented.
 */
const PAGE_ROUTES = [
  // marketing / public
  '/', '/pricing', '/features', '/trust', '/faq', '/how-it-works', '/contact',
  '/reviews', '/about', '/compliance', '/templates',
  // legal
  '/legal/terms', '/legal/privacy', '/legal/cookies', '/legal/refunds',
  '/legal/acceptable-use', '/legal/disclaimers', '/legal/dmca', '/legal/esign',
  '/legal/sms-terms', '/legal/accept', '/terms', '/privacy',
  // auth
  '/account/signin', '/account/signup', '/account/forgot-password',
  // product
  '/dashboard', '/dashboard/actions', '/dashboard/pipeline', '/dashboard/readiness',
  '/campaigns', '/campaigns/wizard', '/campaigns/launcher', '/campaigns/planner',
  '/automation', '/crm', '/leads', '/leads/import', '/lead-finder', '/inbox',
  '/contracts', '/buyers', '/approvals', '/profile', '/referrals', '/reports',
  '/analytics', '/analytics/advanced', '/funnel',
  '/payouts', '/settings/billing', '/settings', '/settings/users',
  '/settings/accessibility', '/settings/outreach',
  '/settings/outreach/sms', '/settings/outreach/email',
  '/achievements', '/leaderboard', '/rewards', '/feedback', '/system-health',
  '/templates', '/welcome',
  '/optimization/dashboard',
  // monitor (public calculator surfaces)
  '/monitor', '/monitor/analytics', '/monitor/pipeline', '/monitor/profit',
  '/monitor/calculator',
  // admin
  '/admin', '/admin/users', '/admin/audience', '/admin/audit', '/admin/billing',
  '/admin/compliance', '/admin/reviews', '/admin/feedback',
  // gate pages
  '/access-restricted', '/pending-access',
];

const API_ROUTES = [
  '/api/dashboard/summary', '/api/usage', '/api/credits', '/api/rewards',
  '/api/achievements', '/api/campaigns', '/api/leads', '/api/contracts',
  '/api/earnings', '/api/system/health', '/api/funnel', '/api/analytics',
  '/api/analytics/crm', '/api/optimization/pipeline-analytics',
  '/api/legal', '/api/user/profile', '/api/legal/messaging-acceptance',
];

function createJar() {
  const jar = new Map();
  return {
    absorb(res) {
      const raw =
        typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : [res.headers.get('set-cookie')].filter(Boolean);
      for (const line of raw) {
        const [pair] = String(line).split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function main() {
  const { email, password, base } = loadCredentials();
  const jar = createJar();

  const request = async (path, init = {}) => {
    const cookie = jar.header();
    const res = await fetch(base + path, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.headers || {}),
        origin: base,
        ...(cookie ? { cookie } : {}),
      },
    });
    jar.absorb(res);
    return res;
  };

  const signin = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signin.ok) {
    console.error(`FAIL sign-in ${signin.status}: ${await signin.text().catch(() => '')}`);
    process.exit(1);
  }
  console.log(`signed in as ${email} against ${base}\n`);

  const rows = [];
  for (const [kind, routes] of [
    ['PAGE', PAGE_ROUTES],
    ['API', API_ROUTES],
  ]) {
    for (const path of routes) {
      const t0 = Date.now();
      let res = null;
      try {
        res = await request(path);
        const ms = Date.now() - t0;
        const location = res.headers.get('location');
        let outcome;
        if (res.status >= 500) outcome = 'SERVER_FAULT';
        else if (res.status >= 300 && res.status < 400)
          outcome = `REDIRECT -> ${location || '?'}`;
        else if (res.status === 401) outcome = 'UNAUTHENTICATED';
        else if (res.status === 403) outcome = 'FORBIDDEN';
        else if (res.status === 404) outcome = 'NOT_FOUND';
        else outcome = 'OK';
        rows.push({ kind, path, status: res.status, ms, outcome });
      } catch (error) {
        rows.push({ kind, path, status: 'THROW', ms: Date.now() - t0, outcome: error.message });
      }
      // Drain the body so the connection can be reused. Done outside the try so
      // a thrown request cannot skip it.
      if (res) await res.text().catch(() => '');
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('KIND', 5)}${pad('ROUTE', 28)}${pad('STATUS', 8)}${pad('MS', 7)}OUTCOME`);
  console.log('-'.repeat(96));
  for (const r of rows) {
    console.log(`${pad(r.kind, 5)}${pad(r.path, 28)}${pad(r.status, 8)}${pad(r.ms, 7)}${r.outcome}`);
  }

  const faults = rows.filter((r) => r.outcome === 'SERVER_FAULT');
  const redirects = rows.filter((r) => r.outcome.startsWith('REDIRECT'));
  const missing = rows.filter((r) => r.outcome === 'NOT_FOUND');
  console.log(`\nSUMMARY total=${rows.length} ok=${rows.filter((r) => r.outcome === 'OK').length} redirects=${redirects.length} notFound=${missing.length} serverFaults=${faults.length}`);
  if (redirects.length) {
    console.log('redirected to:', [...new Set(redirects.map((r) => r.outcome))].join(', '));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});