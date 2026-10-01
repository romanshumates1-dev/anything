/**
 * STATIC-METADATA ratchet (2026-10-01, found in PRODUCTION after the C4 deploy).
 *
 * THE DEFECT, AS OBSERVED
 * ----------------------
 * After the C4 SSR fix was deployed to Cloudflare Workers, every public
 * marketing route started server-rendering its real content EXCEPT the whole
 * `/legal/*` family, which returned 404 in production while returning 200
 * locally:
 *
 *   production  /legal/privacy        -> 404  (body: <html id="__next_error__">)
 *   production  /legal/terms          -> 404
 *   production  /legal/cookies        -> 404
 *   production  /legal/dmca           -> 404
 *   production  /legal/refunds        -> 404
 *   production  /legal/sms-terms      -> 404
 *   production  /legal/esign          -> 404
 *   production  /legal/disclaimers    -> 404
 *   production  /legal/acceptable-use -> 404
 *   production  /legal/accept         -> 200   <-- the only working one
 *   local next start: /legal/privacy -> 200 (74,739 bytes)
 *
 * That is the worst kind of bug: it passes every local gate (unit tests,
 * `next start`, and the whole browser-QA suite, none of which had ever
 * requested /legal/*), and is invisible until it is deployed.
 *
 * ROOT CAUSE
 * ----------
 * `generateMetadata()` opts a route out of static prerendering. Under
 * OpenNext-on-Workers the dynamic render for these pages resolves to a Next
 * error document, which the Worker serves as 404. The evidence that isolates
 * it to that one construct:
 *
 *   - every 404ing page uses `export function generateMetadata()`;
 *   - every WORKING marketing page (`/about`, `/trust`, `/reviews`, `/faq`,
 *     `/features`, `/pricing`) uses a plain `export const metadata` object;
 *   - `/legal/accept` also calls `getLegalDoc()` at render time yet serves
 *     200 - it differs only in exporting `const metadata` instead of
 *     `generateMetadata`;
 *   - the app-paths manifest lists the legal pages identically to the working
 *     ones, and `content/legal/*.md` IS present in the deployed bundle, so this
 *     is not a missing-file or missing-route problem.
 *
 * The legal titles are STATIC (they come from markdown frontmatter, and the
 * slugs are compile-time constants), so `generateMetadata()` buys nothing
 * here - it only opts the pages out of prerendering.
 *
 * WHY A STATIC SWEEP AND NOT A RUNTIME PROBE
 * ------------------------------------------
 * A browser probe would have to be taught about all ten legal routes, and the
 * existing harness only walks a hand-maintained list - which is exactly how
 * this reached production in the first place. This sweep reads the app tree,
 * so a newly added `generateMetadata` page is caught automatically.
 *
 * `generateMetadata()` remains legal for a page that genuinely needs
 * per-request metadata (params, cookies, remote fetch). Such a page must set
 * `export const dynamic = 'force-dynamic'` so the intent is explicit and this
 * ratchet stays meaningful.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const APP_ROOT = join(SRC_ROOT, 'app');

/** Opts the route out of static prerendering. */
const USES_GENERATE_METADATA = /export\s+(?:async\s+)?function\s+generateMetadata/;

/** An explicit acknowledgement that dynamic rendering is intended. */
const FORCE_DYNAMIC = /export\s+const\s+dynamic\s*(?::[^=]+)?=\s*['"]force-dynamic['"]/;

describe('static-metadata ratchet (production 404 guard)', () => {
  const pages = scanSource(APP_ROOT, { onlyFile: 'page.tsx' });

  it('scans a meaningful number of pages', () => {
    // A ratchet that scans nothing passes vacuously.
    expect(pages.length, 'page scan collapsed').toBeGreaterThan(60);
  });

  it('no public/prerenderable page uses generateMetadata without declaring force-dynamic', () => {
    const offenders: string[] = [];

    for (const page of pages) {
      // API routes and auth-gated app pages are not part of the public
      // prerendered surface that regressed; the defect was specific to the
      // indexable marketing/legal tree.
      const rel = page.replace(SRC_ROOT, '').replace(/\\/g, '/');
      if (!rel.startsWith('/app/(marketing)/')) continue;

      const src = readSource(page);
      if (!USES_GENERATE_METADATA.test(src)) continue;
      if (FORCE_DYNAMIC.test(src)) continue;

      offenders.push(rel);
    }

    expect(
      offenders,
      'these prerendered marketing pages use generateMetadata() with no ' +
        'force-dynamic declaration; on OpenNext/Workers they 404 in production ' +
        '(seen live 2026-10-01). Use `export const metadata` when the metadata is ' +
        'static, or add `export const dynamic = "force-dynamic"` if it is not.'
    ).toEqual([]);
  });

  it('the specific production 404 routes are now covered by the guard', () => {
    // If the legal pages were ever moved out of (marketing) the sweep above
    // would silently stop covering them, so pin the exact set that broke.
    const legal = pages.filter((p) => p.replace(/\\/g, '/').includes('/(marketing)/legal/'));
    expect(legal.length, 'legal page tree changed - re-check the sweep scope').toBeGreaterThanOrEqual(9);
  });
});
