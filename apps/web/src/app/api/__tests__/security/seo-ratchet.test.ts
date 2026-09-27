/**
 * SEO ratchet (2026-09-27).
 *
 * A live sweep of the production build found that NONE of the 13 public
 * marketing pages emitted a `rel="canonical"` link, while the app declared
 * `robots: index, follow` on them. That combination is actively harmful for
 * search: the same content is reachable at `/pricing`, `/pricing/`,
 * `/pricing?utm_source=x` and `/pricing#faq`, each a candidate for indexing, so
 * ranking signal is split and a scraper can mirror the site.
 *
 * The same sweep found the inverse problem on the private side: only `/admin`
 * opted out of indexing, so every other authenticated route was indexable BY
 * DEFAULT - and any private route added later would be too. The root layout now
 * denies by default and the marketing group opts in.
 *
 * These ratchets keep both properties from regressing silently. They are static
 * checks because that is what runs in CI on every commit; the live HTTP
 * behaviour was verified separately against a production build.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const APP = join(SRC_ROOT, 'app');
const MARKETING = join(APP, '(marketing)');

describe('SEO ratchet', () => {
  it('the public marketing group opts IN to indexing explicitly', () => {
    const src = readSource(join(MARKETING, 'layout.tsx'));
    expect(src).toMatch(/robots:\s*\{\s*index:\s*true/);
  });

  it('the root layout denies indexing BY DEFAULT', () => {
    // Deny-by-default is what makes a newly added private page safe without
    // anyone remembering to protect it.
    const src = readSource(join(APP, 'layout.tsx'));
    expect(src, 'root layout must deny indexing by default').toMatch(
      /robots:\s*\{[\s\S]{0,200}?index:\s*false/
    );
    expect(src, 'an absolute metadataBase is required for resolvable canonicals').toContain(
      'metadataBase'
    );
  });

  it('every public marketing page EMITS a canonical, not merely imports the helper', () => {
    // Strengthened after a real miss. The first version of this check only
    // grepped for the STRING `canonicalFor`, and passed on 9 legal pages whose
    // import was present but never used - `generateMetadata` builds its object
    // after a `const doc = getLegalDoc(SLUG)` statement, so a naive injection
    // silently no-opped and left an unused import. The build stayed green, the
    // tests stayed green, and NO canonical was emitted. Only the live HTTP check
    // caught it.
    //
    // So the assertion is now on the CALL SITE, not the import.
    const pages = scanSource(MARKETING, { onlyFile: 'page.tsx' });
    expect(pages.length, 'marketing page scan collapsed').toBeGreaterThan(10);

    const notEmitted = pages
      .filter((f) => {
        const src = readSource(f);
        // A real call site, i.e. `...canonicalFor('...')` in a position that
        // can actually affect the returned metadata - not the import line.
        const calls = src.match(/\.\.\.canonicalFor\(/g) ?? [];
        return calls.length === 0;
      })
      .map((f) => f.replace(MARKETING, 'app/(marketing)'));

    expect(
      notEmitted,
      `pages that import but never call canonicalFor - no canonical is emitted:\n${notEmitted.join('\n')}`
    ).toEqual([]);
  });

  it('no page declares metadata in a way the App Router rejects', () => {
    // This assertion exists because the first pass of this feature BROKE THE
    // BUILD while this very file stayed green. `export const metadata` is a
    // SERVER-only export: putting it in a 'use client' module is a build
    // error, and declaring it alongside `generateMetadata` is a conflict. A
    // ratchet that only greps for the string `canonicalFor` cannot see either,
    // so the rule is enforced structurally here.
    //
    // /cash-offer is the worked example: it is interactive, so the component
    // is 'use client' and cannot own metadata. The fix was a thin server page
    // that owns the canonical and renders the client child.
    const pages = scanSource(MARKETING, { onlyFile: 'page.tsx' });
    const offenders: string[] = [];

    for (const file of pages) {
      const rel = file.replace(MARKETING, 'app/(marketing)');
      const src = readSource(file);

      if (/^\s*'use client'/m.test(src) && /export const metadata/.test(src)) {
        offenders.push(`${rel}: 'use client' module exports metadata (server-only export)`);
      }
      if (/export const metadata/.test(src) && /export (async )?function generateMetadata/.test(src)) {
        offenders.push(`${rel}: declares both metadata and generateMetadata`);
      }
      if (
        /export (async )?function generateMetadata/.test(src) &&
        !/canonicalFor/.test(src)
      ) {
        offenders.push(`${rel}: generateMetadata omits the canonical`);
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('canonicalFor emits an absolute, self-referencing, normalized URL', async () => {
    // A BEHAVIOURAL test of the helper, not a regex over its source. Asserting
    // on implementation text breaks on any refactor while proving nothing; a
    // wrong canonical is worse than none, because pointing it at a tracking URL
    // tells crawlers the tagged URL is authoritative.
    const { canonicalFor, siteOrigin } = await import('@/lib/seo');

    expect(canonicalFor('/').alternates.canonical).toBe(`${siteOrigin()}/`);
    expect(canonicalFor('/pricing').alternates.canonical).toBe(`${siteOrigin()}/pricing`);

    // Trailing/leading slashes normalize rather than producing '//pricing'.
    expect(canonicalFor('pricing').alternates.canonical).toBe(`${siteOrigin()}/pricing`);
    expect(canonicalFor('/pricing/').alternates.canonical).toBe(`${siteOrigin()}/pricing`);

    // The canonical is absolute, and OpenGraph agrees with it.
    for (const p of ['/', '/pricing', '/legal/terms']) {
      const c = canonicalFor(p).alternates.canonical as string;
      expect(c.startsWith('http'), `${p} canonical must be absolute`).toBe(true);
      expect(canonicalFor(p).openGraph.url).toBe(c);
    }

    // The helper must never introduce a query string or fragment of its own.
    for (const p of ['/', '/pricing']) {
      const c = canonicalFor(p).alternates.canonical as string;
      expect(c).not.toContain('?');
      expect(c).not.toContain('#');
    }
  });
});
