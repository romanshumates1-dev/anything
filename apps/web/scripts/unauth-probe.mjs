/**
 * Reproduce the REAL first-time visitor experience: a fresh browser with NO
 * saved session (the authenticated e2e storageState never exercises this).
 * Confirms "/" and the auth pages render actual content, not a white screen.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const OUT = 'e2e/.proof';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } }); // NO storageState
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
page.on('pageerror', (e) => errors.push('PAGEERR ' + String(e).slice(0, 160)));

async function probe(path, waitFor) {
  const p = await context.newPage();
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 120)));
  p.on('pageerror', (e) => errs.push('PAGEERR ' + String(e).slice(0, 120)));
  const resp = await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForTimeout(1500);
  let sawExpected = true;
  if (waitFor) sawExpected = await p.locator(waitFor).first().isVisible().catch(() => false);
  const text = (await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await p.screenshot({ path: `${OUT}/unauth-${path.replace(/\W+/g, '_') || 'root'}.png`, fullPage: true });
  console.log(`\n[${path}] HTTP ${resp?.status()} finalURL=${p.url()}`);
  console.log(`  expected("${waitFor}") visible: ${sawExpected}`);
  console.log(`  bodyTextLen: ${text.length}  →  "${text.slice(0, 140)}"`);
  console.log(`  consoleErrors: ${errs.length}${errs.length ? ' → ' + JSON.stringify(errs) : ''}`);
  await p.close();
  return { path, status: resp?.status(), finalURL: p.url(), sawExpected, textLen: text.length, errs };
}

// 1. Root as a first-time visitor (what the user opens).
await probe('/', 'input[type=email]');
// 2. Sign-in + sign-up pages directly.
await probe('/account/signin', 'input[type=email]');
await probe('/account/signup', 'input[type=email]');

await browser.close();
console.log('\n(screenshots in e2e/.proof/unauth-*.png)');
