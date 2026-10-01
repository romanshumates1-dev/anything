/**
 * Blank-page guard (2026-09-26, found by real-browser QA).
 *
 * CLASS OF DEFECT
 * Seven authenticated pages gated themselves with
 *
 *     if (!session) return null;
 *
 * A client component returning `null` renders NOTHING, so an unauthenticated
 * visitor got HTTP 200, a fully-formed RSC payload, and a blank white screen -
 * no sign-in page, no message, no error. `/crm`, `/reports`, `/buyers` and
 * `/funnel` were caught this way in the browser; `analytics/advanced`,
 * `campaigns/planner` and `campaigns/wizard` were found by the static sweep
 * below, which is the better signal - the browser harness only probes the
 * routes it happens to know about.
 *
 * The established convention in this codebase is `redirect('/account/signin')`,
 * used by 32 other pages. This guard enforces it so the class cannot regress.
 *
 * The check is deliberately precise. `return null` is still legitimate for DATA
 * guards (`if (!res.ok) return null`), so only a null-return that is bound to
 * the SESSION is a violation.
 *
 * SIBLING SUITE: `static-metadata.guard.test.ts` covers the production-only
 * 404 that `generateMetadata()` caused on the public legal pages.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const APP_ROOT = join(SRC_ROOT, 'app');

/** `if (!session...)` / `if (!user...)` / `if (!authSession...)` bound to null. */
const BLANK_ON_UNAUTH = /if\s*\(\s*!\s*(?:session|user|authSession|userSession)\w*\s*\)\s*(?:\{\s*)?return\s+null\s*;/;

/**
 * A page is SAFE if it navigates the visitor away by EITHER mechanism:
 *   - server redirect:  redirect('/account/signin')
 *   - client router:    router.push|replace('.../account/signin...')
 *
 * `/welcome` uses the client form from a useEffect, where `return null` is the
 * correct "will redirect" transient rather than a blank page. Flagging it would
 * be a false positive that trains people to ignore the guard.
 */
const REDIRECTS_TO_SIGNIN =
  /redirect\(\s*['"`][^'"`]*account\/signin|router\.(?:push|replace)\(\s*['"`][^'"`]*account\/signin/;

describe('blank-page guard', () => {
  const pages = scanSource(APP_ROOT, { onlyFile: 'page.tsx' });

  it('scans a meaningful number of pages', () => {
    // A ratchet that scans nothing passes vacuously.
    expect(pages.length, 'page scan collapsed').toBeGreaterThan(60);
  });

  it('no page returns null without redirecting an unauthenticated visitor', () => {
    const offenders: string[] = [];
    for (const file of pages) {
      const src = readSource(file);
      if (!BLANK_ON_UNAUTH.test(src)) continue;
      if (REDIRECTS_TO_SIGNIN.test(src)) continue;
      offenders.push(file.replace(APP_ROOT, 'app'));
    }
    expect(
      offenders,
      `Pages render a blank screen for unauthenticated visitors (use redirect('/account/signin')):\n` +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('the redirect convention is importable from next/navigation where used', () => {
    // A redirect call without its import is a build error, so this confirms the
    // pages that were repaired are well-formed rather than accidentally broken.
    const guarded = ['app/crm', 'app/reports', 'app/buyers', 'app/funnel'].map((rel) =>
      join(SRC_ROOT, rel, 'page.tsx')
    );
    for (const file of guarded) {
      const src = readSource(file);
      expect(src, `${file} lost its redirect`).toContain("redirect('/account/signin')");
      expect(src, `${file} lost its import`).toContain(
        "import { redirect } from 'next/navigation'"
      );
    }
  });
});
