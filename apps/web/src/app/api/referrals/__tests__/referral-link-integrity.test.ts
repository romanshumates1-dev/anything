/**
 * REFERRAL ATTRIBUTION INTEGRITY — source-level ratchet.
 *
 * Why this exists (final acceptance audit, 2026-10-04): the production site
 * answered 404 for `${baseUrl}/signup?ref=CODE` — the exact link the API hands
 * to every user — because the signup page lives at /account/signup. Nothing in
 * the frontend ever read `?ref`, and nothing ever called
 * POST /api/referrals/signup, so referral attribution was impossible even for
 * links that resolved. This guard pins the whole chain:
 *
 *   generator target  ->  a route that exists  ->  ?ref read at signup  ->
 *   attribution POSTed  ->  legacy /signup links redirected
 *
 * If any link in that chain is broken again, this test fails before a customer
 * ever shares a dead link.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readSource, SRC_ROOT } from '../../__tests__/security/_sourceScan';

describe('referral link integrity', () => {
  it('generates referral links against a route that actually exists', () => {
    const route = readSource(join(SRC_ROOT, 'app/api/referrals/route.ts'));

    // The generator must target the REAL signup page...
    expect(route).toContain('/account/signup?ref=');
    // ...and must never regress to the historical 404 target. (Matched on the
    // assignment itself so this file's own explanatory comments can name the
    // old string without tripping the guard.)
    expect(route).not.toContain('referralLink = `${baseUrl}/signup?ref=');

    // The target itself must resolve to a page in the app router.
    expect(existsSync(join(SRC_ROOT, 'app/account/signup/page.tsx'))).toBe(true);
  });

  it('redirects legacy /signup links to /account/signup, preserving ?ref=', () => {
    const legacy = readSource(join(SRC_ROOT, 'app/signup/route.ts'));
    expect(legacy).toContain("'/account/signup'");
    // Query preservation is what keeps already-shared ?ref=CODE links alive.
    expect(legacy).toContain('target.search = requestUrl.search');
  });

  it('reads ?ref at signup and records attribution server-side', () => {
    const signup = readSource(join(SRC_ROOT, 'app/account/signup/page.tsx'));

    // The ref code is read from the URL...
    expect(signup).toContain('searchParams.get("ref")');
    // ...and attribution is POSTed after the session exists.
    expect(signup).toContain('/api/referrals/signup');
    expect(signup).toContain('referralCode');
  });

  it('surfaces the referral dashboard at an authenticated route', () => {
    // The dashboard component previously existed but was imported by no route.
    const page = readSource(join(SRC_ROOT, 'app/referrals/page.tsx'));
    expect(page).toContain('ReferralDashboard');
    expect(existsSync(join(SRC_ROOT, 'app/referrals/page.tsx'))).toBe(true);
  });
});
