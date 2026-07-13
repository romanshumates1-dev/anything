// Screenshot the Settings → AI Provider card (Ollama option). Signs in as the
// seeded AI admin, expands the Ollama guide, shoots.
//   node --env-file=.env scripts/ai-provider-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
const r = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, {
  data: { email: 'ai.admin@dealswiftautomation.com', password: 'Str0ngPass!234' },
  headers: { 'content-type': 'application/json' },
});
console.log('sign-in:', r.status());
const page = await ctx.newPage();
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
// click the Local (Ollama) option + expand the guide for a fuller shot
await page.getByText('Local (Ollama)').first().click().catch(() => {});
await page.getByText('How to launch a local model with Ollama').click().catch(() => {});
await page.waitForTimeout(500);
mkdirSync('e2e/.proof', { recursive: true });
await page.screenshot({ path: 'e2e/.proof/ai-provider.png', clip: { x: 0, y: 0, width: 1100, height: 720 } });
console.log('screenshot: e2e/.proof/ai-provider.png');
await browser.close();
