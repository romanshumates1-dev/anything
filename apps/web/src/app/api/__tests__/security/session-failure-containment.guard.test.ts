/**
 * SESSION-FAILURE CONTAINMENT RATCHET (2026-10-02).
 *
 * Companion to `src/lib/session.test.ts`, which proves the `getSessionOrNull`
 * helper actually contains a failing lookup. This guard covers the other half:
 * that the PAGE-LEVEL callers actually use it.
 *
 * WHY A SOURCE GUARD AND NOT A RENDER TEST
 * ----------------------------------------
 * The failure the real-browser crawl reproduced took ~12 SECONDS of
 * `application-code` before it 500'd. A unit render test cannot hold that
 * condition open; a source guard can prove it is *impossible* to reintroduce,
 * which is what a ratchet is for. The prompt's own instruction is that a fix is
 * not done until it "cannot silently regress" (REGRESSION PROTECTION).
 *
 * WHAT COUNTS AS PAGE-LEVEL
 * -------------------------
 * A `page.tsx` / `layout.tsx` / `adminGuard.ts` under `src/app`. These render
 * FOR A USER, so a thrown error becomes a 500 HTML page. API `route.ts` files
 * are deliberately out of scope: a throw there returns a JSON 500 for one
 * endpoint and cannot take out a public page.
 *
 * THE OBSERVED DEFECT (kept here so a future reader knows the guard is not
 * theoretical):
 *
 *   GET /api/auth/get-session 500 in 11.9s (application-code: 11.8s)
 *   GET / 500                    in 12.6s (application-code: 12.5s)
 *
 * `/` is PUBLIC. It 500'd because it awaited a session lookup with no error
 * handling.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readSource, scanSource, SRC_ROOT } from './_sourceScan';

const APP_ROOT = join(SRC_ROOT, 'app');

/** A raw, uncontained better-auth session read. */
const BARE_SESSION_READ = 'auth.api.getSession(';

/** The contained replacement every page-level reader must use. */
const CONTAINED_READ = 'getSessionOrNull';

function isPageLevel(file: string): boolean {
  return /(?:^|[\\/])(page|layout)\.tsx$/.test(file) || /adminGuard\.ts$/.test(file);
}

function rel(file: string): string {
  return file.slice(SRC_ROOT.length + 1).replace(/\\/g, '/');
}

describe('page-level session reads are contained against auth failure', () => {
  const pageLevel = scanSource(APP_ROOT, {
    extensions: ['ts', 'tsx'],
    excludeTests: true,
  }).filter(isPageLevel);

  it('discovers page-level files to police (guards against a silent empty scan)', () => {
    // A scan that quietly returns nothing is the exact failure mode this guard
    // exists to prevent: green because it checked nothing.
    expect(pageLevel.length).toBeGreaterThan(50);
  });

  it('never lets a bare auth.api.getSession read throw out of a page render', () => {
    const offenders = pageLevel.filter((f) => readSource(f).includes(BARE_SESSION_READ));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('routes every page-level session read through getSessionOrNull', () => {
    // Any page-level file that mentions a session at all must go through the
    // contained helper. Files that never touch auth are legitimately exempt.
    const readers = pageLevel.filter((f) => {
      const src = readSource(f);
      return src.includes('getSession') && !src.includes(CONTAINED_READ);
    });
    expect(readers.map(rel)).toEqual([]);
  });

  it('pins the regression on the public homepage that actually 500d', () => {
    const home = join(APP_ROOT, '(marketing)', 'page.tsx');
    const src = readSource(home);

    expect(src).toContain(CONTAINED_READ);
    expect(src).not.toContain(BARE_SESSION_READ);
    // A public landing page must fail OPEN (render for a guest), never closed.
    expect(src).not.toContain('access-restricted');
  });
});
