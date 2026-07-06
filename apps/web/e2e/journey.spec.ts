import { test, expect } from '@playwright/test';
import { loadEnv } from './env';
import { twilioSignature } from './twilioSign';
import { TEST_PHONE } from './global-setup';

const env = loadEnv();

/**
 * STEP A — the verified-working slice of the journey, run to a hard checkpoint
 * before the inbox/approvals tail is repaired:
 *   login (storageState) → wizard Step 1..4 → enable Test Mode → launch →
 *   assert the campaign persisted in test mode → simulate a signed inbound
 *   reply → /inbox shows the lead.
 *
 * Campaign persistence is asserted via /api/outreach/campaigns (the endpoint
 * the wizard writes to). The /campaigns list PAGE reads a different, legacy
 * table and is repaired in the tail work; this slice does not depend on it.
 */
test('journey slice: wizard → launch (test mode) → inbound → inbox shows lead', async ({ page }) => {
  const campaignName = `E2E Journey ${Date.now()}`;

  await page.goto('/campaigns/wizard');
  await expect(page.locator('#name')).toBeVisible();

  // --- Step 1: Basics (direction defaults to SELLER) ---
  await page.fill('#name', campaignName);
  // Contact Source is the 2nd Select on this step → choose "Paste Numbers"
  await page.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: 'Paste Numbers' }).click();
  await page.fill('#paste', `Alice ${TEST_PHONE}\nBob +15025550002\nCarol +15025550003`);
  await page.fill('#opening', 'Hi, are you open to a cash offer on your property this month?');
  await page.getByRole('button', { name: /Next: Sending/ }).click();

  // --- Step 2 & 3: accept defaults ---
  await page.getByRole('button', { name: /Next: Follow-ups/ }).click();
  await page.getByRole('button', { name: /Next: Compliance/ }).click();

  // --- Step 4: enable Personal Test Mode (3rd switch: DNC, Litigator, TestMode) ---
  await page.getByRole('switch').nth(2).click();

  // --- Launch and capture the create call ---
  const [createRes] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/outreach/campaigns') && r.request().method() === 'POST'
    ),
    page.getByRole('button', { name: /Launch Campaign/ }).click(),
  ]);
  expect(createRes.status()).toBe(200);
  const created = await createRes.json();
  expect(created.id).toBeTruthy();

  // --- Assert the campaign persisted in TEST mode ---
  const listRes = await page.request.get('/api/outreach/campaigns');
  expect(listRes.ok()).toBeTruthy();
  const campaigns = await listRes.json();
  const mine = campaigns.find((c: any) => c.id === created.id);
  expect(mine, 'launched campaign should be persisted').toBeTruthy();
  expect(mine.test_mode).toBe(true);
  expect(mine.name).toBe(campaignName);

  // --- Simulate an inbound reply via the signed Twilio webhook (test path) ---
  const webhookUrl = 'http://localhost:4000/api/sms/inbound';
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

  // --- /inbox shows the lead ---
  await page.goto('/inbox');
  await expect(page.getByText('Alice Seller')).toBeVisible();
});
