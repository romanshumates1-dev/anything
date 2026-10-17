/**
 * `/api/user/preferences` must be READ in exactly one place.
 *
 * THE DEFECT THIS GUARDS (measured 2026-10-03, deployed /dashboard)
 * ----------------------------------------------------------------
 * One authenticated dashboard load issued FOUR requests for the same object:
 * three in the same millisecond (372, 372, 372) and one at 819ms.
 *
 *   Shell                  useQuery(['user-preferences'])
 *   AccessibilityProvider  raw fetch() inside an effect
 *   OnboardingTutorial     raw fetch(..., { cache: 'no-store' })
 *   OnboardingChecklist    PATCH (a write - legitimate, different verb)
 *
 * React Query dedupes by key, and only the Shell was using a key at all. The
 * duplication lived BETWEEN components, which is why no component's own test
 * caught it: `Shell.test.tsx` asserts the Shell does not fetch this endpoint for
 * an anonymous visitor, which was true, and it mocks `AccessibilityProvider`
 * away so the second reader is invisible to it.
 *
 * So the guard is a source-level rule, like the onboarding link-integrity test:
 * any GET of this endpoint must live in the shared fetcher, and every other
 * reference must be a PATCH (a write, which is not a duplicate read).
 */
import { describe, it, expect } from 'vitest';
import { join, relative } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from '../../app/api/__tests__/security/_sourceScan';

const SHARED_FETCHER = 'lib/userPreferences.ts';

/**
 * Strips comments. Several files DISCUSS this endpoint in prose (why anonymous
 * visitors must not ask for it, which routes the middleware excludes). That prose
 * is worth keeping and is not a request.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('user preferences are read from exactly one place', () => {
  const files = scanSource(SRC_ROOT);

  it('found the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no component reads /api/user/preferences outside the shared fetcher', { timeout: 30_000 }, () => {
    const offenders: string[] = [];

    for (const file of files) {
      const text = stripComments(readSource(file));
      // Normalised: on Windows the path separators are backslashes, so a raw
      // endsWith('lib/userPreferences.ts') would never match.
      const relPath = relative(SRC_ROOT, file).replace(/\\/g, '/');
      const needle = '/api/user/preferences';
      let index = text.indexOf(needle);
      while (index !== -1) {
        // The fetcher itself is the one allowed reader.
        if (relPath !== SHARED_FETCHER) {
          // A PATCH is a write, not a duplicate read.
          const window = text.slice(index, index + 220);
          const isWrite = /method:\s*['"]PATCH['"]/.test(window);
          if (!isWrite) offenders.push(relPath);
        }
        index = text.indexOf(needle, index + needle.length);
      }
    }

    expect(
      [...new Set(offenders)],
      'a component issues its own GET of /api/user/preferences; route reads through lib/userPreferences.ts so they share one cache entry'
    ).toEqual([]);
  });

  it('the shared fetcher exists and owns the one key', () => {
    const fetcher = join(SRC_ROOT, ...SHARED_FETCHER.split('/'));
    const text = readSource(fetcher);
    expect(text).toContain('/api/user/preferences');
    expect(text).toContain("['user-preferences']");
  });
});
