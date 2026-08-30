import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import { loadEnv } from './env';
import { twilioSignature } from './twilioSign';
import { db } from './db';
import { TEST_PHONE } from './global-setup';

const env = loadEnv();
// NOTE: the org is NOT a module constant. It used to be
//   const ORG = 'default'; // better-auth users carry no organizationId → app uses 'default'
// which was wrong: getOrganization() resolves a membership row, else falls back
// to 'org_default' — it never yields the bare string 'default'. That phantom
// 'default' is the same value that left 375 rows across 10 tables orphaned and
// permanently invisible (BREAKAGE_TABLE #35 / session (t)'s backfill); that
// backfill repaired DB rows, not this constant. It is now read back from the
// campaign the app actually created, below, so it cannot drift again.

/**
 * Full campaign → inbox → approvals journey (the sprint's 10 steps):
 *   login → wizard Step 1..4 → Test Mode → launch → campaign shows a TEST badge
 *   on /campaigns → signed inbound reply → /inbox shows the lead → thread renders
 *   the reply → seed an owner-range approval → approve from /approvals → assert
 *   the negotiation is unblocked (AWAITING_OWNER_RANGE → NEGOTIATING) in the DB.
 */
test('full journey: wizard → launch → inbox/thread → approve range → negotiation unblocked', async ({ page }) => {
  const sql = db();
  const campaignName = `E2E Journey ${Date.now()}`;

  // --- Wizard Step 1 ---
  await page.goto('/campaigns/wizard');
  await expect(page.locator('#name')).toBeVisible();
  await page.fill('#name', campaignName);
  await page.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'Paste Numbers' }).click();
  await page.fill('#paste', `Alice ${TEST_PHONE}\nBob +15025550002\nCarol +15025550003`);
  await page.fill('#opening', 'Hi, are you open to a cash offer on your property this month?');
  await page.getByRole('button', { name: /Customize.*Sending/ }).click();

  // --- Steps 2 & 3: defaults ---
  await page.getByRole('button', { name: /Next: Follow-ups/ }).click();
  await page.getByRole('button', { name: /Next: Compliance/ }).click();

  // --- Step 4: enable Test Mode + launch ---
  await page.getByRole('switch').nth(2).click();
  const [createRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/outreach/campaigns') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /Launch Campaign/ }).click(),
  ]);
  expect(createRes.status()).toBe(200);
  const created = await createRes.json();
  expect(created.id).toBeTruthy();

  // --- Campaign appears on /campaigns with a TEST badge ---
  // The wizard's client-side redirect is unreliable; navigate explicitly and
  // wait for the campaigns list fetch to resolve before asserting.
  const listRespP = page.waitForResponse(
    (r) => r.url().includes('/api/outreach/campaigns') && r.request().method() === 'GET',
    { timeout: 20000 }
  );
  await page.goto('/campaigns', { waitUntil: 'domcontentloaded' });
  await listRespP.catch(() => {});
  await expect(page.getByText(campaignName).first()).toBeVisible({ timeout: 20000 });
  const card = page.locator('div').filter({ hasText: campaignName }).first();
  await expect(card.getByText('TEST').first()).toBeVisible();

  // --- "Launch Campaign" must ACTIVATE the campaign (DRAFT → ACTIVE) ---
  // Regression guard: launch() used to be identical to saveDraft() and left the
  // campaign in DRAFT. It now calls /start, so the launched campaign is ACTIVE.
  await expect
    .poll(
      async () => {
        const [row] = await sql`SELECT status FROM outreach_campaigns WHERE id = ${created.id}`;
        return row?.status;
      },
      { timeout: 15000 }
    )
    .toBe('ACTIVE');

  // --- Simulate an inbound reply via the signed Twilio webhook ---
  // Twilio signs the PUBLIC-facing URL it POSTs to, and the inbound route
  // validates against PUBLIC_WEBHOOK_URL when set (falling back to the request
  // URL otherwise). Sign over the SAME URL the route validates, so this holds
  // both in CI (no PUBLIC_WEBHOOK_URL → localhost) and locally (ngrok URL set).
  const webhookUrl = env.PUBLIC_WEBHOOK_URL || 'http://localhost:4000/api/sms/inbound';
  const params = { From: TEST_PHONE, Body: 'Yes, what is your offer?' };
  const signature = twilioSignature(webhookUrl, params, env.TWILIO_AUTH_TOKEN);
  const inbound = await page.request.post('/api/sms/inbound', {
    headers: {
      'x-sms-secret': env.SMS_INBOUND_SECRET,
      'x-twilio-signature': signature,
      'content-type': 'application/x-www-form-urlencoded',
    },
    form: params,
  });
  expect(inbound.status()).toBe(200);

  // --- /inbox shows the lead; open the thread; the reply renders ---
  await page.goto('/inbox');
  await expect(page.getByText('Alice Seller').first()).toBeVisible();
  await page.getByText('Alice Seller').first().click();
  await expect(page).toHaveURL(/\/inbox\/\d+/);
  await expect(page.getByText('Yes, what is your offer?').first()).toBeVisible();

  // --- Seed an owner-range approval tied to a contact of this campaign ---
  // Authoritative org: whatever the app stamped on the campaign it just
  // created. See the note at the top of this file — hardcoding 'default' here
  // made this query match nothing, so `contact?.id` came back undefined.
  const [campRow] = await sql`
    SELECT organization_id FROM outreach_campaigns WHERE id = ${created.id}
  `;
  const ORG = (campRow as { organization_id: string } | undefined)?.organization_id;
  expect(ORG, 'campaign should carry an organization_id').toBeTruthy();

  const [contact] = await sql`
    SELECT id FROM campaign_contacts WHERE campaign_id = ${created.id} AND organization_id = ${ORG} LIMIT 1
  `;
  expect(contact?.id).toBeTruthy();
  const contactId = contact.id as string;
  await sql`UPDATE campaign_contacts SET status = 'AWAITING_OWNER_RANGE' WHERE id = ${contactId}`;
  const address = `12 Oak St #${Date.now()}`;
  // exactly one pending owner-range approval visible at click time
  await sql`DELETE FROM owner_range_requests WHERE organization_id = ${ORG}`;
  await sql`
    INSERT INTO owner_range_requests (id, organization_id, negotiation_id, direction, property_context, status, expires_at)
    VALUES (${randomUUID()}, ${ORG}, ${contactId}, 'SELLER', ${JSON.stringify({ address, ai_min: 100000, ai_max: 120000 })}, 'PENDING', ${new Date(Date.now() + 24 * 3600_000)})
  `;

  // --- Approve from /approvals ---
  await page.goto('/approvals');
  await expect(page.getByText(address)).toBeVisible();
  const [approveRes] = await Promise.all([
    page.waitForResponse((r) => /\/api\/approvals\//.test(r.url()) && r.request().method() === 'POST'),
    page.getByRole('button', { name: /Accept Suggestion/ }).first().click(),
  ]);
  expect(approveRes.status()).toBe(200);

  // --- Assert the negotiation is unblocked in the DB ---
  const [after] = await sql`SELECT status FROM campaign_contacts WHERE id = ${contactId}`;
  expect(after.status).toBe('NEGOTIATING');
  // and the price ladder was written
  const [range] = await sql`SELECT max_price FROM negotiation_price_ranges WHERE negotiation_id = ${contactId}`;
  expect(Number(range.max_price)).toBe(120000);
});
