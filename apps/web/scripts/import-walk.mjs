/**
 * Live proof for the lead-import journey step. Registers a fresh user, then
 * drives BOTH bulk-import paths in the real browser:
 *   1. PASTE: a 10-row mixed fixture (8 valid, 1 in-batch duplicate, 1 malformed)
 *   2. FILE:  a CSV uploaded via the file input
 * Verifies the on-screen result badge AND the persisted rows in the live DB.
 *
 * Run: node --env-file=.env scripts/import-walk.mjs
 */
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:4000';
const OUT = 'e2e/.proof';
mkdirSync(OUT, { recursive: true });
const sql = neon(process.env.DATABASE_URL);

// Unique run tag so re-runs never collide with prior DB rows.
const tag = String(Date.now()).slice(-6);
const pastePrefix = `+1502777${tag.slice(0, 3)}`; // 8 distinct paste phones share this prefix
const filePrefix = `+1502888${tag.slice(0, 3)}`;

// --- 10-row paste fixture: header + 8 valid + 1 dup + 1 malformed ---
const pasteRows = [
  'name,phone,email,type',
  `Alice Seller,${pastePrefix}0,alice${tag}@t.co,seller`,
  `Bob Buyer,${pastePrefix}1,bob${tag}@t.co,buyer`,
  `Carol Co,${pastePrefix}2,carol${tag}@t.co,seller`,
  `Dave Diaz,${pastePrefix}3,,seller`,
  `Erin Else,${pastePrefix}4,,buyer`,
  `Frank Fox,${pastePrefix}5,,seller`,
  `Gina Gray,${pastePrefix}6,,seller`,
  `Hal Hunt,${pastePrefix}7,,buyer`,
  `Alice Seller DUP,${pastePrefix}0,alice${tag}@t.co,seller`, // in-batch duplicate phone
  `Malformed NoContact,,,seller`,                             // missing phone+email → failed
].join('\n');
// expected: totalRows=10, inserted=8, duplicates=1, failed=1

const fileRows = [
  'name,phone,email,type',
  `File One,${filePrefix}0,,seller`,
  `File Two,${filePrefix}1,,buyer`,
  `File Three,${filePrefix}2,,seller`,
].join('\n');
const csvPath = `${OUT}/import-fixture-${tag}.csv`;
writeFileSync(csvPath, fileRows);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// register (allowed domain + ADMIN promotion — platform is domain/role locked)
const email = `import-${tag}@dealswiftautomation.com`;
await page.goto(`${BASE}/account/signup`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'Test1234!pass');
await Promise.all([page.waitForURL(`${BASE}/`, { timeout: 30000 }).catch(() => {}), page.getByRole('button', { name: /Sign Up/ }).click()]);
await sql`UPDATE "user" SET role = 'ADMIN' WHERE email = ${email}`;

// ---- PASTE path ----
await page.goto(`${BASE}/leads/import`, { waitUntil: 'networkidle' });
await page.fill('#pastebox', pasteRows);
await page.screenshot({ path: `${OUT}/import-02-paste-filled.png`, fullPage: true });
const [bulkResp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/leads/bulk') && r.request().method() === 'POST'),
  page.getByRole('button', { name: /Import Bulk Leads/ }).click(),
]);
const pasteJson = await bulkResp.json();
await page.getByText(/Imported/).first().waitFor({ timeout: 10000 });
await page.screenshot({ path: `${OUT}/import-03-paste-result.png`, fullPage: true });
const pasteBadge = await page.getByText(/Imported/).first().innerText();

// ---- FILE path ----
await page.reload({ waitUntil: 'networkidle' });
await page.setInputFiles('#csvfile', csvPath);
const [fileResp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/leads/bulk') && r.request().method() === 'POST'),
  page.getByRole('button', { name: /Import Bulk Leads/ }).click(),
]);
const fileJson = await fileResp.json();
await page.getByText(/Imported/).first().waitFor({ timeout: 10000 });
await page.screenshot({ path: `${OUT}/import-04-file-result.png`, fullPage: true });

await browser.close();

// ---- DB verification ----
const [{ count: pasteDb }] = await sql`SELECT COUNT(*)::int AS count FROM leads WHERE phone LIKE ${pastePrefix + '%'}`;
const [{ count: fileDb }] = await sql`SELECT COUNT(*)::int AS count FROM leads WHERE phone LIKE ${filePrefix + '%'}`;
const sampleRows = await sql`SELECT name, phone, type, source FROM leads WHERE phone LIKE ${pastePrefix + '%'} ORDER BY phone LIMIT 3`;

console.log('\n=== IMPORT PROOF ===');
console.log('PASTE result (API):', JSON.stringify(pasteJson));
console.log('PASTE badge (DOM) :', pasteBadge.replace(/\s+/g, ' '));
console.log('PASTE rows in DB  :', pasteDb, '(expected 8)');
console.log('FILE  result (API):', JSON.stringify(fileJson));
console.log('FILE  rows in DB  :', fileDb, '(expected 3)');
console.log('DB sample         :', JSON.stringify(sampleRows));
console.log('console errors    :', consoleErrors.length);
const ok = pasteJson.inserted === 8 && pasteJson.duplicates === 1 && pasteJson.failed === 1 && pasteDb === 8 && fileJson.inserted === 3 && fileDb === 3 && consoleErrors.length === 0;
console.log(ok ? '\nRESULT: PASS ✅' : '\nRESULT: FAIL ❌');
process.exit(ok ? 0 : 1);
