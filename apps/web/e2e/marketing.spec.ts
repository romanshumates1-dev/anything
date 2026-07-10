import { test, expect } from "@playwright/test";

/**
 * Marketing-site smoke spec.
 * home → pricing → CTA → /account/signin (register)
 * This is the Gate 1 marketing verification: the public funnel renders and
 * the CTA routes to the auth page. Runs against the local `yarn dev` server.
 */
test("marketing funnel: home → pricing → CTA → /account/signin", async ({ page }) => {
  // 1. Home page renders hero + nav.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /DealFlow AI/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Get Started Free/i })).toBeVisible();

  // 2. Navigate to pricing.
  await page.getByRole("link", { name: /Pricing/i }).first().click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(page.getByText(/Simple, transparent pricing/i)).toBeVisible();
  await expect(page.getByText(/\$99/)).toBeVisible();

  // 3. Click a pricing CTA (Start Free Trial / Contact Sales).
  await page.getByRole("link", { name: /Start Free Trial|Contact Sales/i }).first().click();

  // 4. Lands on the register/sign-in page.
  await expect(page).toHaveURL(/\/account\/(signin|signup)/);
  await expect(page.getByText(/Sign (In|Up)|Create (your )?account/i)).toBeVisible();
});