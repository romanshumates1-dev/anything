// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReferralGiveawayBanner } from './ReferralGiveawayBanner';

/**
 * REFERRAL / FIRST 1,000 USERS BANNER contract (roman.agent.md).
 *
 * The requirement is explicit: use the exact approved promotional facts
 * ("First 1,000 users", "Referral-based cash-prize giveaway"), do NOT invent
 * legal terms or odds, and keep referral attribution non-trivial to manipulate
 * (the attribution side is pinned by referral-link-integrity.test.ts).
 *
 * So this test pins BOTH directions: the approved facts must be present, and
 * no fabricated prize amount, percentage, deadline or "terms apply" legal
 * claim may appear.
 */
afterEach(cleanup);

describe('ReferralGiveawayBanner', () => {
  it('states the approved promotional facts', () => {
    render(<ReferralGiveawayBanner />);
    const banner = screen.getByTestId('referral-giveaway-banner');
    expect(banner.textContent).toContain('First 1,000 users');
    expect(banner.textContent).toContain('Referral-based cash-prize giveaway');
  });

  it('links to the real signup route, not the 404 /signup', () => {
    render(<ReferralGiveawayBanner />);
    const cta = screen.getByRole('link', { name: /claim your spot/i });
    expect(cta.getAttribute('href')).toBe('/account/signup');
  });

  it('does not invent prize amounts, odds, or deadlines', () => {
    render(<ReferralGiveawayBanner />);
    const text = screen.getByTestId('referral-giveaway-banner').textContent ?? '';

    // No dollar amounts (e.g. "$5,000 cash prize").
    expect(text).not.toMatch(/\$\s?\d/);
    // No odds / probabilities expressed numerically.
    expect(text).not.toMatch(/\d+\s?%/);
    // No fabricated end dates.
    expect(text).not.toMatch(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i);
    // It must say official terms come later, because none exist yet.
    expect(text).toContain('terms');
    expect(text.toLowerCase()).toContain('will be published');
  });

  it('is an accessible labelled region', () => {
    render(<ReferralGiveawayBanner />);
    expect(screen.getByRole('region', { name: /giveaway/i })).toBeTruthy();
  });
});
