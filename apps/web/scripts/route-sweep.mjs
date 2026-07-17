// Phase Q.2 evidence — route-by-route console/render matrix.
// For EVERY authenticated app route: navigate as an admin, capture console
// errors + pageerrors, and confirm the page renders real content (a heading —
// not a blank pane). Also checks the branded 404 (bogus route → not-found).
//   node --env-file=.env scripts/route-sweep.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `qsweep-${Date.now()}@dealswiftautomation.com`;

const ROUTES = [
  '/dashboard', '/dashboard/readiness', '/analytics', '/leads', '/leads/import',
  '/crm', '/inbox', '/campaigns', '/campaigns/wizard', '/approvals', '/contracts',
  '/lead-finder', '/settings', '/settings/users',
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'Q Sweep' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

const rows = [];
let totalErrors = 0;
const page = await ctx.newPage();

for (const route of ROUTES) {
  const errors = [];
  const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text()); };
  const onPageErr = (e) => errors.push('pageerror: ' + String(e));
  page.on('console', onConsole);
  page.on('pageerror', onPageErr);

  let heading = '';
  let status = 'ok';
  try {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    status = resp ? String(resp.status()) : 'no-response';
    heading = await page.locator('h1, h2, [role="heading"]').first().textContent({ timeout: 3000 }).catch(() => '');
  } catch (e) {
    status = 'nav-error';
    errors.push('nav: ' + (e?.message || e));
  }

  page.off('console', onConsole);
  page.off('pageerror', onPageErr);

  // Filter noise: favicon 404s and the known dev fontawesome rewrite are not app bugs.
  const appErrors = errors.filter((e) => !/favicon|fontawesome|ka-p\.fontawesome/i.test(e));
  totalErrors += appErrors.length;
  rows.push({ route, status, rendered: (heading || '').trim().slice(0, 40) || '(no heading)', errors: appErrors });
}

// Branded 404
const err404 = [];
page.on('console', (m) => { if (m.type() === 'error') err404.push(m.text()); });
const r404 = await page.goto(`${BASE}/this-route-does-not-exist-xyz`, { waitUntil: 'networkidle' }).catch(() => null);
await page.waitForTimeout(1000);
const has404 = await page.getByText(/not found|404|doesn.t exist/i).first().isVisible().catch(() => false);

console.log('\n=== Q.2 ROUTE CONSOLE MATRIX ===');
console.log('route'.padEnd(26), 'status'.padEnd(8), 'errors', ' rendered');
for (const r of rows) {
  console.log(r.route.padEnd(26), String(r.status).padEnd(8), String(r.errors.length).padEnd(6), r.rendered);
  for (const e of r.errors.slice(0, 3)) console.log('     ! ' + e.slice(0, 140));
}
console.log(`\n404 page: status=${r404?.status()} brandedNotFound=${has404}`);
console.log(`\nTOTAL app console errors across ${ROUTES.length} routes: ${totalErrors}`);
const blank = rows.filter((r) => r.rendered === '(no heading)');
console.log(`Blank panes (no heading): ${blank.length} ${blank.map((b) => b.route).join(', ')}`);

// cleanup
const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
await browser.close();

const pass = totalErrors === 0 && blank.length === 0 && has404;
console.log(`\nROUTE SWEEP: ${pass ? 'ALL CLEAN' : 'ISSUES FOUND (see above)'}`);
process.exit(pass ? 0 : 1);
