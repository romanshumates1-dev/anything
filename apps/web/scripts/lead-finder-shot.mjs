// Gate 5 evidence: screenshot the live Lead Finder tool with real sourced+scored
// data. Signs in as the seeded LF admin, navigates, waits for hydration, shoots.
//   node --env-file=.env scripts/lead-finder-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const EMAIL = 'lf.admin@dealswiftautomation.com';
const PASSWORD = 'Str0ngPass!234';

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });

// Sign in via the API against this context so the session cookie is set.
const res = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, {
  data: { email: EMAIL, password: PASSWORD },
  headers: { 'content-type': 'application/json' },
});
console.log('sign-in:', res.status());

const page = await ctx.newPage();
await page.goto(`${BASE}/lead-finder`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // react-query fetch + hydrate
mkdirSync('e2e/.proof', { recursive: true });
await page.screenshot({ path: 'e2e/.proof/lead-finder.png', fullPage: true });
const heading = await page.locator('h1').first().textContent().catch(() => null);
const rows = await page.locator('table tbody tr').count();
console.log('heading:', heading, '| table rows visible:', rows);
console.log('screenshot: e2e/.proof/lead-finder.png');
await browser.close();
