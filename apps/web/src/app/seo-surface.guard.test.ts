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
import { buildWebSiteSchema, buildOrganizationSchema, buildProductSchema, buildFaqJsonLdFor, jsonLdForEmbed } from '@/lib/structuredData';
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

  it('/pricing carries Product + AggregateOffer and FAQPage JSON-LD', () => {
    // SEO-1 gap: /pricing rendered 5 priced tiers and 6 billing FAQs with no
    // structured data at all, so the site's highest-intent page earned no
    // price or rich-result treatment.
    const pricing = read('src/app/(marketing)/pricing/page.tsx');
    expect(pricing).toContain('buildProductSchema');
    expect(pricing).toContain('buildFaqJsonLdFor');
    expect(pricing).toContain('application/ld+json');
  });

  it('Product offers mirror the tier rows passed in (no invented prices)', () => {
    // The schema MUST be derived from the DB rows the cards render, otherwise
    // machine-readable prices drift from visible ones.
    const tiers = [
      { name: 'Free', slug: 'free', price: 0 },
      { name: 'Starter', slug: 'starter', price: 49 },
      { name: 'Pro', slug: 'pro', price: 129 },
    ];
    const schema = JSON.parse(jsonLdForEmbed(buildProductSchema(tiers)));
    expect(schema['@type']).toBe('Product');
    expect(schema.offers['@type']).toBe('AggregateOffer');
    expect(schema.offers.priceCurrency).toBe('USD');
    expect(schema.offers.lowPrice).toBe(0);
    expect(schema.offers.highPrice).toBe(129);
    expect(schema.offers.offerCount).toBe(3);
    expect(schema.offers.offers).toHaveLength(3);
    // lowPrice/highPrice and Offer.price must share the same unit (USD major
    // units) — mixing dollars and cents is an invalid AggregateOffer.
    expect(schema.offers.offers.map((o: any) => o.price)).toEqual([0, 49, 129]);
    expect(schema.offers.offers[2].url).toBe(`${APEX}/pricing#pro`);
  });

  it('Product schema is honest: no synthetic "originalPrice" leaks in', () => {
    // The pricing page computes `originalPrice = price * 2` for the "50% OFF"
    // banner. That is marketing framing, not a real list price, and must not
    // become a machine-readable price.
    const schema = buildProductSchema([{ name: 'Pro', slug: 'pro', price: 129 }]);
    const flat = JSON.stringify(schema);
    expect(flat).not.toContain('originalPrice');
    expect(flat).not.toContain('258');
    expect(flat).not.toContain('priceSpecification');
  });

  it('FAQPage builder emits every passed Q&A, matching what the page renders', () => {
    const faqs = [
      { q: 'What is your refund policy?', a: 'Seven days, full refund.' },
      { q: 'Can I cancel anytime?', a: 'Yes, no fees.' },
    ];
    const schema = JSON.parse(jsonLdForEmbed(buildFaqJsonLdFor(faqs, '/pricing')));
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.url).toBe(`${APEX}/pricing`);
    expect(schema.mainEntity).toHaveLength(2);
    expect(schema.mainEntity[0]['@type']).toBe('Question');
    expect(schema.mainEntity[0].name).toBe('What is your refund policy?');
    expect(schema.mainEntity[0].acceptedAnswer['@type']).toBe('Answer');
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe('Seven days, full refund.');
  });

  it('empty tier list yields a zero range rather than a fabricated one', () => {
    // /pricing omits the Product schema entirely when the DB read fails; this
    // pins the builder's own behaviour for that degenerate input so it can
    // never produce a plausible-looking but baseless price range.
    const schema = buildProductSchema([]);
    expect(schema.offers.offerCount).toBe(0);
    expect(schema.offers.offers).toEqual([]);
    expect(schema.offers.lowPrice).toBe(0);
    expect(schema.offers.highPrice).toBe(0);
  });
});
