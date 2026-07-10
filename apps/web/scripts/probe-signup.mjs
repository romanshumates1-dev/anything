import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4000';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();

page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text().slice(0, 400)}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 400)}`));
page.on('response', (r) => {
  if (r.url().includes('/api/auth')) console.log(`[net] ${r.status()} ${r.request().method()} ${r.url()}`);
});

const resp = await page.goto(`${BASE}/account/signup`, { waitUntil: 'domcontentloaded' });
console.log(`\nDOC STATUS: ${resp?.status()}`);

const appeared = await page
  .locator('input[type=email]')
  .waitFor({ state: 'visible', timeout: 15000 })
  .then(() => true)
  .catch(() => false);
console.log(`EMAIL INPUT VISIBLE: ${appeared}`);
console.log(`BODY TEXT: ${JSON.stringify((await page.locator('body').innerText().catch(() => '')).slice(0, 300))}`);

await browser.close();
