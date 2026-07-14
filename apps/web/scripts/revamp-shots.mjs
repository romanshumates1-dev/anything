// Gate 2 evidence: screenshot the revamped web UI (dashboard onboarding, wizard
// Quick Launch, Lead Finder). Registers a throwaway admin, shoots, cleans up.
//   node --env-file=.env scripts/revamp-shots.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `shot-${Date.now()}@dealswiftautomation.com`;
const password = 'Str0ngPass!234';

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const reg = await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password, name: 'Shot Admin' }, headers: { 'content-type': 'application/json' },
});
console.log('signup:', reg.status());
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

const page = await ctx.newPage();
mkdirSync('e2e/.proof', { recursive: true });
const shots = [
  ['/dashboard', 'revamp-dashboard.png'],
  ['/lead-finder', 'revamp-lead-finder.png'],
  ['/campaigns/wizard', 'revamp-wizard.png'],
];
for (const [path, file] of shots) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `e2e/.proof/${file}`, fullPage: false });
  console.log('shot:', file);
}

const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
console.log('cleaned up');
await browser.close();
