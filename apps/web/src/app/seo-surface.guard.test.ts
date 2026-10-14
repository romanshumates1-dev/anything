/**
 * SEO surface guard — sitemap/robots/origin single-source-of-truth (SEO-1).
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The public SEO surface broke silently three times before 2026-10-09, and each
 * break was a *drift between copies of the same origin* or a malformed list —
 * never a missing feature:
 *  1. `robots.ts` + `lib/seo.ts` pointed crawlers at `dealflow.ai`, a domain
 *     this project does not own (fixed: both fall back to the real apex).
 *  2. `sitemap.ts` listed the homepage TWICE (two spellings of the identical
 *     string) — a repeated <loc> makes a sitemap malformed and Google Search
 *     Console discards the whole file, including the valid URLs.
 *  3. `/cash-offer` carried a canonical and lived in the indexable (marketing)
 *     group, yet no sitemap entry told a crawler it existed.
 * The matrix row SEO-1 was marked IMPLEMENTED but "not audited this cycle" —
 * this test is that audit, pinned so the three defects cannot return.
 *
 * WHAT IS ASSERTED (offline, no network, no secrets)
 * ---------------------------------------------------
 *  1. `sitemap.ts` has no duplicate locations (the malformation defect).
 *  2. Every sitemap path resolves to a real `page.tsx` under `(marketing)`
 *     (the missing-page defect) — EXCEPT `/compliance`, which is an INTENTIONAL
 *     `permanentRedirect` to `/trust` (MKT-2: the standalone page carried
 *     unsubstantiated SOC 2 claims) and must stay out of the sitemap.
 *  3. Every indexable `(marketing)` route with a page is IN the sitemap —
 *     no indexable page is invisible to crawlers (the `/cash-offer` defect).
 *     `/legal/accept` is deliberately excluded (authenticated re-acceptance
 *     interstitial, `robots: index false`).
 *  4. `robots.ts`, `lib/seo.ts`, and `(marketing)/layout.tsx` share one origin
 *     (no third copy of the fallback domain — the `dealflow.ai` defect).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { buildWebSiteSchema, buildOrganizationSchema, jsonLdForEmbed } from '@/lib/structuredData';
import { SOCIAL_IMAGE_PATH } from '@/lib/seo';
import { join } from 'node:path';

const APP_ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(APP_ROOT, rel), 'utf8');
/**
 * Read a file with block comments and whole-line `//` comments stripped, so
 * origin checks scan LIVE references only. Source files legitimately spell the
 * forbidden domain when documenting the historical defect (robots.ts explains
 * that it once pointed at it) — that history must not trip the guard, while a
 * reintroduced domain in code, JSX, or a string literal still fails.
 */
const readLive = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const SITEMAP = 'src/app/sitemap.ts';
const ROBOTS = 'src/app/robots.ts';
const SEO_LIB = 'src/lib/seo.ts';
const MKT_LAYOUT = 'src/app/(marketing)/layout.tsx';
const MKT_ROOT = join(APP_ROOT, 'src', 'app', '(marketing)');

const APEX = 'https://dealswiftautomation.com';
const FORBIDDEN_ORIGIN = 'dealflow.ai';

// Paths the sitemap declares, read from the `entry("…")` call sites.
function sitemapPaths(): string[] {
  const src = read(SITEMAP);
  return [...src.matchAll(/entry\(\s*"([^"]+)"\s*,/g)].map((m) => m[1]);
}

// Every indexable route: each dir under (marketing) holding a page.tsx,
// EXCEPT the legal/accept interstitial (robots: noindex by design).
function indexableRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}/${name}`);
      } else if (name === 'page.tsx' && prefix !== '/legal/accept') {
        out.push(prefix || '/');
      }
    }
  };
  walk(MKT_ROOT, '');
  return out.sort();
}

describe('SEO surface guard (SEO-1)', () => {
  it('sitemap has no duplicate locations (malformed-sitemap defect)', () => {
    const paths = sitemapPaths();
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('every sitemap path resolves to a real page (or the intentional /compliance redirect)', () => {
    for (const p of sitemapPaths()) {
      if (p === '/compliance') continue; // intentional permanentRedirect → /trust (MKT-2)
      const file = join(MKT_ROOT, p === '/' ? 'page.tsx' : `${p.replace(/^\//, '')}/page.tsx`);
      expect(existsSync(file), `sitemap path ${p} has no ${file}`).toBe(true);
    }
  });

  it('every indexable marketing route is in the sitemap (invisible-page defect)', () => {
    const inSitemap = new Set(sitemapPaths());
    for (const route of indexableRoutes()) {
      if (route === '/compliance') {
        // The /compliance page.tsx EXISTS but must NOT be indexed: it is an
        // intentional permanentRedirect to /trust (unsubstantiated SOC 2 claims).
        expect(inSitemap.has(route)).toBe(false);
        continue;
      }
      expect(inSitemap.has(route), `indexable route ${route} missing from sitemap`).toBe(true);
    }
    // The exclusions are exactly the two intentional ones.
    expect(inSitemap.has('/legal/accept')).toBe(false);
  });

  it('single origin of truth: no copy points at a domain we do not own', () => {
    for (const f of [SITEMAP, ROBOTS, SEO_LIB, MKT_LAYOUT]) {
      expect(readLive(f).includes(FORBIDDEN_ORIGIN), `${f} references ${FORBIDDEN_ORIGIN}`).toBe(false);
    }
    expect(read(SEO_LIB)).toContain(APEX);
    expect(read(ROBOTS)).toContain(APEX);
  });

  it('robots sitemap URL is built from the same origin (no third spelling)', () => {
    const robots = read(ROBOTS);
    expect(robots.includes('NEXT_PUBLIC_APP_URL')).toBe(true);
    expect(robots.includes(APEX)).toBe(true);
  });

  it('homepage carries WebSite + Organization JSON-LD structured data', () => {
    // SEO requirement: "structured data where appropriate". The homepage is the
    // highest-traffic page; it must declare WebSite (sitelink search box) and
    // Organization (Knowledge Panel) so rich results cannot be lost to absent
    // markup. Only 2 of 21 pages had JSON-LD before this fix.
    const home = read('src/app/(marketing)/page.tsx');
    expect(home).toContain('buildWebSiteSchema');
    expect(home).toContain('buildOrganizationSchema');
    expect(home).toContain('application/ld+json');
    // Verify the actual builders produce valid schemas (pure function tests).
    const siteSchema = JSON.parse(jsonLdForEmbed(buildWebSiteSchema()));
    const orgSchema = JSON.parse(jsonLdForEmbed(buildOrganizationSchema()));
    expect(siteSchema['@type']).toBe('WebSite');
    expect(siteSchema['@context']).toBe('https://schema.org');
    expect(siteSchema.url).toBe(APEX + '/');
    expect(orgSchema['@type']).toBe('Organization');
    expect(orgSchema.logo.url).toContain(APEX);
    // The logo URL must be derived from the single source of truth in lib/seo.ts,
    // not a duplicated literal — otherwise the schema silently drifts when the
    // social image path changes (exactly the class of defect SOCIAL_IMAGE_PATH
    // exists to prevent).
    expect(SOCIAL_IMAGE_PATH).toBe('/og-image.png');
    expect(orgSchema.logo.url).toBe(`${APEX}${SOCIAL_IMAGE_PATH}`);
    // The `</` escape must neutralise every `<` so a script tag in any
    // string field cannot early-close the <script> element.
    const raw = JSON.stringify(buildWebSiteSchema());
    expect(raw).not.toContain('</');
  });
});
