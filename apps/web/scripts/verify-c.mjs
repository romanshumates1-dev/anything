/**
 * Verify Mission C live: register a user (org 'default'), then confirm the
 * analytics + CRM endpoints return the deeper metrics and the pages render.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const OUT = 'e2e/.proof';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 140)));
page.on('pageerror', (e) => errs.push('PAGEERR ' + String(e).slice(0, 140)));

// register (allowed domain + ADMIN promotion — platform is domain/role locked)
const email = `verifyc-${Date.now()}@dealswiftautomation.com`;
await page.goto(`${BASE}/account/signup`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'Test1234!pass');
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/account'), { timeout: 30000 }).catch(() => {}), page.getByRole('button', { name: /Sign Up/ }).click()]);
await page.waitForTimeout(1000);
{
  const { neon } = await import('@neondatabase/serverless');
  const sqlAdmin = neon(process.env.DATABASE_URL);
  await sqlAdmin`UPDATE "user" SET role = 'ADMIN' WHERE email = ${email}`;
}

// analytics API
const a = await page.request.get('/api/analytics');
const aj = await a.json().catch(() => ({}));
console.log('\n=== /api/analytics ===  HTTP', a.status());
console.log('funnel:', JSON.stringify(aj.funnel));
console.log('conversion:', JSON.stringify(aj.conversion));
console.log('rates:', JSON.stringify(aj.rates));
console.log('costs:', JSON.stringify(aj.costs));
console.log('margin:', JSON.stringify({ ...aj.margin, note: undefined }));
console.log('perCampaign rows:', (aj.perCampaign || []).length, ' timeseries points:', (aj.timeseries || []).length);

// crm API
const c = await page.request.get('/api/crm/contacts');
const cj = await c.json().catch(() => ({}));
console.log('\n=== /api/crm/contacts ===  HTTP', c.status());
console.log('contacts:', (cj.contacts || []).length, ' statuses:', JSON.stringify(cj.statuses), ' campaigns:', (cj.campaigns || []).length);
const firstId = cj.contacts?.[0]?.id;
if (firstId) {
  const d = await page.request.get(`/api/crm/contacts/${firstId}`);
  const dj = await d.json().catch(() => ({}));
  console.log('detail HTTP', d.status(), '→ conversation msgs:', (dj.conversation || []).length, ' negotiation:', dj.negotiation ? 'yes' : 'no');
}

// screenshots of the pages
await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/c-analytics.png`, fullPage: true });
await page.goto(`${BASE}/crm`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/c-crm.png`, fullPage: true });

console.log('\nconsole errors:', errs.length, errs.length ? JSON.stringify(errs.slice(0, 6)) : '');
await browser.close();
