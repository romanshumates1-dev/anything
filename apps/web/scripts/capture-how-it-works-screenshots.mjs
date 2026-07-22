#!/usr/bin/env node
// Captures the 5 real screenshots referenced in public/screenshots/README.md,
// using Playwright against the running dev server (localhost:4000). Signs up
// a disposable admin test account (not a real user), promotes it via direct
// SQL (same pattern documented in BREAKAGE_TABLE.md's Phase 1/2 test runs),
// then walks the pages that already carry real seeded data.
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4000';
const OUT_DIR = new URL('../public/screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sql = neon(process.env.DATABASE_URL);

const email = `screenshots-${Date.now()}@dealswiftautomation.com`;
const password = 'Screenshot-Capture-1!';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // --- Sign up a disposable admin test account ---
  await page.goto(`${BASE}/account/signup`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('input[type="checkbox"]').check();
  await Promise.all([
    page.waitForURL(BASE + '/', { timeout: 15000 }).catch(() => {}),
    page.locator('button[type="submit"]').click(),
  ]);

  const [row] = await sql`UPDATE "user" SET role = 'ADMIN' WHERE email = ${email} RETURNING id, email, role`;
  if (!row) throw new Error(`FATAL: signup did not create a user row for ${email}`);
  console.log('Promoted to ADMIN:', JSON.stringify(row));

  const conversations = await sql`SELECT lead_id FROM ai_conversations LIMIT 1`;
  const leadId = conversations[0]?.lead_id;
  console.log('Using lead_id for negotiation panel:', leadId);

  const shots = [
    { url: '/leads/import', file: 'lead-import.png' },
    { url: '/campaigns/wizard', file: 'campaign-wizard.png' },
    ...(leadId ? [{ url: `/inbox/${leadId}`, file: 'negotiation-panel.png' }] : []),
    { url: '/approvals', file: 'notification.png' },
    { url: '/contracts', file: 'contract-preview.png' },
  ];

  for (const shot of shots) {
    await page.goto(`${BASE}${shot.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500); // let queries settle post-navigation
    const path = `${OUT_DIR}${shot.file}`;
    // Clip out the top health/session-email banner (a fixed-height bar in
    // every page of this shell) - marketing screenshots shouldn't show a
    // disposable test-account email address. Role-based detection was
    // flaky across pages (some pages have a second, page-local <header>
    // that also gets an implicit banner role), so use a fixed offset
    // measured directly from the shell's own banner row height.
    const CLIP_TOP = 65;
    await page.screenshot({ path, clip: { x: 0, y: CLIP_TOP, width: 1280, height: 720 - CLIP_TOP } });
    console.log(`Captured ${shot.url} -> ${shot.file}`);
  }

  if (!leadId) {
    console.warn('WARNING: no ai_conversations row found; negotiation-panel.png NOT captured.');
  }

  await browser.close();

  // Clean up the disposable test account (mirrors "all test users torn down after" convention).
  await sql`DELETE FROM "session" WHERE "userId" = ${row.id}`;
  await sql`DELETE FROM "account" WHERE "userId" = ${row.id}`;
  await sql`DELETE FROM "user" WHERE id = ${row.id}`;
  console.log('Torn down disposable test user', email);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
