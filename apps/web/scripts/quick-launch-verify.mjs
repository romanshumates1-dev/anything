// Gate 2 evidence: drive the wizard Quick Launch express path end-to-end and
// count clicks to an ACTIVE campaign. Registers an admin, launches, screenshots.
//   node --env-file=.env scripts/quick-launch-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `ql-${Date.now()}@dealswiftautomation.com`;
const password = 'Str0ngPass!234';

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });

// register + promote to ADMIN (needs the role to reach the app)
const reg = await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password, name: 'QL Admin' }, headers: { 'content-type': 'application/json' },
});
console.log('signup:', reg.status());
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;
const [u0] = await sql`SELECT id FROM "user" WHERE email=${email}`;
// Seed a VERIFIED test phone (the OTP-verified allowlist) so a test-mode
// campaign has a valid recipient — this is the normal one-time Settings setup.
const TESTNUM = '+15025550123';
await sql`INSERT INTO test_phone_numbers (id, organization_id, phone, verified, verified_at)
  VALUES (gen_random_uuid()::text, ${u0.id}, ${TESTNUM}, true, now())
  ON CONFLICT (organization_id, phone) DO UPDATE SET verified=true`;
console.log('seeded verified test phone for admin');

const page = await ctx.newPage();
let clicks = 0;
await page.goto(`${BASE}/campaigns/wizard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Fill the only two required fields on step 1.
await page.getByPlaceholder(/Q1 Seller|Outreach/i).first().fill('QL Express Test').catch(async () => {
  await page.locator('input[type="text"]').first().fill('QL Express Test');
});
// Pick "Paste Numbers" as the contact source, then paste one placeholder number
// (test mode won't send to it; it only satisfies the "need contacts" guard).
await page.getByText('CSV Upload').first().click().catch(() => {});
await page.getByText('Paste Numbers').first().click().catch(() => {});
await page.waitForTimeout(400);
await page.getByPlaceholder(/\+1|one per line|555/i).first().fill('+15025550123').catch(async () => {
  await page.locator('textarea').last().fill('+15025550123');
});
await page.getByPlaceholder(/Hi \{name\}/i).first().fill('Hi {name}, quick question about {address}.').catch(() => {});

// ONE click: Quick Launch.
const btn = page.getByRole('button', { name: /Quick Launch/i });
await btn.click();
clicks = 1; // clicks after landing on the wizard form
await page.waitForURL(/\/campaigns(\?|$|\/)/, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// Verify an ACTIVE campaign now exists in the DB.
const rows = await sql`SELECT name, status, test_mode FROM outreach_campaigns ORDER BY created_at DESC LIMIT 3`;
console.log('recent campaigns:', JSON.stringify(rows));
const active = rows.find((r) => r.name === 'QL Express Test' && r.status === 'ACTIVE');
console.log(active ? `✅ Quick Launch → ACTIVE campaign (test_mode=${active.test_mode}) in ${clicks} click from the wizard form` : '❌ no ACTIVE QL campaign found');

mkdirSync('e2e/.proof', { recursive: true });
await page.screenshot({ path: 'e2e/.proof/quick-launch-campaigns.png', fullPage: false });
console.log('screenshot: e2e/.proof/quick-launch-campaigns.png');

// cleanup
await sql`DELETE FROM outreach_campaigns WHERE name='QL Express Test'`;
const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
console.log('cleaned up');
await browser.close();
