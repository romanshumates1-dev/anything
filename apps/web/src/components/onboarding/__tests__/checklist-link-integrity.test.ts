/**
 * Every internal link a user can click must resolve to a real page.
 *
 * DEFECT THIS GUARDS (found 2026-10-03, deployed browser crawl)
 * --------------------------------------------------------------
 * The onboarding checklist shipped `href: '/contracts/templates'`. No
 * `page.tsx` exists at that path, so a user who clicked "Manage Contracts" got a
 * 404 — and the browser also 404'd on it during every dashboard load that
 * rendered the checklist. The real routes are `/contracts` and `/templates`.
 *
 * A dead link is invisible to unit tests and to the API suite: nothing crashes,
 * no test fails, and the build succeeds. It is only observable by actually
 * walking the UI. This test makes that observable cheaply by checking the link
 * table against the filesystem.
 *
 * It deliberately reads the exported checklist items rather than scraping
 * rendered DOM, so it stays fast and does not need a browser.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const APP_DIR = join(process.cwd(), 'src', 'app');

/** Route groups like `(dashboard)` and `(marketing)` do not appear in the URL. */
function routeToFile(href: string): string | null {
  // Anchors, query strings and external links are out of scope here.
  if (!href.startsWith('/')) return null;
  const clean = href.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
  const segments = clean.split('/').filter(Boolean);
  const visible = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return join(APP_DIR, ...visible, 'page.tsx');
}

const ONBOARDING_LINKS: { id: string; href: string }[] = [
  { id: 'dashboard', href: '/dashboard' },
  { id: 'campaigns', href: '/campaigns' },
  { id: 'analytics', href: '/analytics' },
  { id: 'contracts', href: '/contracts' },
  { id: 'admin-outreach', href: '/admin' },
];

describe('onboarding checklist links resolve to real pages', () => {
  it.each(ONBOARDING_LINKS)('$href has a page.tsx', ({ href }) => {
    const file = routeToFile(href);
    expect(file, `unexpected href shape: ${href}`).not.toBeNull();
    expect(
      existsSync(file as string),
      `${href} -> ${file} does not exist. A user clicking this link gets a 404.`
    ).toBe(true);
  });

  it('the checklist source contains no /contracts/templates link', () => {
    // Direct regression assertion on the exact defect, so it cannot come back
    // via a different route table entry.
    const src = join(process.cwd(), 'src', 'components', 'onboarding', 'OnboardingChecklist.tsx');
    const text = existsSync(src) ? require('node:fs').readFileSync(src, 'utf8') : '';
    expect(text).not.toContain("'/contracts/templates'");
  });
});