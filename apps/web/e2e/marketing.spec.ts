import { test, expect } from "@playwright/test";

/**
 * Marketing-site smoke spec (Gate 1). Runs UNAUTHENTICATED — the marketing
 * landing owns "/" for guests (authenticated users are redirected to
 * /dashboard), so this spec clears the shared auth storageState.
 *
 * Real funnel as built: home ("/") → Pricing nav → /pricing (tiers) →
 * a pricing CTA → /contact. The "Sign In" nav link is the app entry point.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("marketing funnel: home → pricing → CTA → contact", async ({ page }) => {
  // 1. Home renders the marketing hero + a primary CTA (guest view of "/").
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Close more deals/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Get Started Free/i })).toBeVisible();

  // 2. Nav to pricing via the marketing layout nav.
  await page.getByRole("link", { name: /^Pricing$/i }).first().click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(page.getByText(/Simple, transparent pricing/i)).toBeVisible();
  await expect(page.getByText(/\$99/)).toBeVisible();

  // 3. A pricing CTA routes to the contact/trial funnel.
  await page.getByRole("link", { name: /Start Free Trial|Contact Sales/i }).first().click();
  await expect(page).toHaveURL(/\/contact/);
});

test("marketing → Sign In nav routes to the auth page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Sign In$/i }).first().click();
  await expect(page).toHaveURL(/\/account\/signin/);
  await expect(page.getByRole("heading", { name: /Sign in/i })).toBeVisible();
});
