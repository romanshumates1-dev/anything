// Gate 3 evidence: seed varied-area-code contacts on existing campaigns, load
// /analytics, verify the globe renders with multi-region + multi-campaign dots,
// no console errors. Cleans up. Marker name 'GLOBE_TEST_' for safe deletion.
//   node --env-file=.env scripts/globe-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `globe-${Date.now()}@dealswiftautomation.com`;

// Two existing campaigns to color-code; fall back to whatever exists.
const camps = await sql`SELECT id, organization_id FROM campaign_contacts GROUP BY id, organization_id LIMIT 1`;
const distinct = await sql`SELECT DISTINCT campaign_id, organization_id FROM campaign_contacts LIMIT 2`;
if (distinct.length === 0) { console.log('no existing campaigns to attach to'); process.exit(0); }

// Area codes across regions to prove the multi-region map.
const AC_A = ['502', '704', '404', '314', '212', '206']; // campaign A spread
const AC_B = ['859', '919', '470', '816', '415', '617']; // campaign B spread
async function seed(campaign, acs) {
  for (let i = 0; i < acs.length; i++) {
    const phone = `+1${acs[i]}555${String(1000 + i)}`;
    const recent = i % 2 === 0; // half "active" (recent message → pulse)
    await sql`INSERT INTO campaign_contacts (id, campaign_id, organization_id, name, phone, status, last_message_at)
      VALUES (gen_random_uuid()::text, ${campaign.campaign_id}, ${campaign.organization_id}, ${'GLOBE_TEST_' + acs[i]}, ${phone}, 'QUEUED', ${recent ? new Date().toISOString() : null})
      ON CONFLICT (campaign_id, phone) DO NOTHING`;
  }
}
await seed(distinct[0], AC_A);
if (distinct[1]) await seed(distinct[1], AC_B);
console.log('seeded varied-area-code test contacts');

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, { data: { email, password: 'Str0ngPass!234', name: 'Globe Admin' }, headers: { 'content-type': 'application/json' } });
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
await page.waitForTimeout(4000); // globe lazy-loads + geo query + a few animation frames
const canvasVisible = await page.locator('canvas[aria-label*="globe" i]').isVisible().catch(() => false);
const legendItems = await page.locator('text=/GLOBE_TEST|region/i').count().catch(() => 0);
console.log('globe canvas visible:', canvasVisible, '| legend/region mentions:', legendItems);
console.log('console errors:', errors.length, errors.slice(0, 3));

mkdirSync('e2e/.proof', { recursive: true });
await page.screenshot({ path: 'e2e/.proof/analytics-globe.png', fullPage: false });
console.log('screenshot: e2e/.proof/analytics-globe.png');

// cleanup
await sql`DELETE FROM campaign_contacts WHERE name LIKE 'GLOBE_TEST_%'`;
const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
console.log('cleaned up');
await browser.close();
