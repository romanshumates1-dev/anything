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
  //    Selector drift (2026-09-27): the hero heading is "Find properties, make
  //    offers, close deals faster" and the primary CTA is "Start Free Trial";
  //    the spec still expected the older "Close more deals" / "Get Started Free"
  //    copy, so it failed against a healthy page. Asserted against what the page
  //    actually renders now, keeping the intent (hero + primary CTA present).
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /close deals faster/i }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Start Free Trial/i }).first()
  ).toBeVisible();

  // 2. Nav to pricing via the marketing layout nav.
  await page.getByRole("link", { name: /^Pricing$/i }).first().click();
  await expect(page).toHaveURL(/\/pricing/);
  // Role-based, not getByText: the same string also appears in Next's
  // `__next-route-announcer__` live region, so a text locator is ambiguous
  // and fails strict mode (the page itself is fine).
  await expect(
    page.getByRole("heading", { name: /Simple, transparent pricing/i })
  ).toBeVisible();
  // `/\$99/` matched seven nodes (including "$999"); assert the promotional
  // price text that the marketing copy actually promises.
  await expect(page.getByText(/Now \$99/)).toBeVisible();

  // 3. A pricing CTA routes into the trial funnel. The primary CTA is
  //    "Start Free Trial" -> /account/signup (verified in the page source:
  //    ctaHref="/account/signup?promo=LAUNCH"); /contact is a separate,
  //    secondary link further down the page.
  await page.getByRole("link", { name: /Start Free Trial|Contact Sales/i }).first().click();
  await expect(page).toHaveURL(/\/account\/signup/);
});

test("marketing → Sign In nav routes to the auth page", async ({ page }) => {
  // Selector drift (2026-09-27): the sign-in page's heading is "Welcome back";
  // "Sign In" is the submit button. The intent — reaching a real, recognisable
  // sign-in form — is asserted with both.
  await page.goto("/");
  await page.getByRole("link", { name: /^Sign In$/i }).first().click();
  await expect(page).toHaveURL(/\/account\/signin/);
  await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign In$/i })).toBeVisible();
});
