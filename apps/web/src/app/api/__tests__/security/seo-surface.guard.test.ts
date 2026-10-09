/**
 * SEO-SURFACE ratchet (2026-10-09, found by a live production audit).
 *
 * The canonical/robots ratchet (seo-ratchet.test.ts) proves the RELATIVE
 * metadata is right; this file pins the surface that a live audit found
 * broken on https://dealswiftautomation.com while the older guards were
 * green (all verified live 2026-10-09):
 *
 *   1. SITEMAP DUPLICATES THE HOMEPAGE. sitemap.ts emitted `{ url: BASE_URL }`
 *      and `` { url: `${BASE_URL}` } `` - two spellings of the SAME string -
 *      so /sitemap.xml listed the home URL twice. Repeated <loc> entries make
 *      a sitemap malformed.
 *
 *   2. TITLE BRAND-DOUBLING. The marketing layout declares the template
 *      "%s — DealFlow AI" but /pricing set `title: "Pricing - DealFlow AI"`,
 *      so production renders "Pricing - DealFlow AI — DealFlow AI" as both
 *      <title> and og:title. Page-level title literals must be brand-free.
 *
 *   3. NO og:image ANYWHERE while twitter:card is summary_large_image - social
 *      scrapers get a large-image card with zero image. `canonicalFor` is the
 *      single choke point every marketing page spreads, so that is where the
 *      image must live: page-level openGraph REPLACES the layout's openGraph
 *      wholesale in Next's metadata merge (which is why og:siteName/locale
 *      were already missing on live /pricing).
 *
 *   4. PLACEHOLDER META DESCRIPTIONS SHIPPING TO PRODUCTION. All nine /legal/*
 *      pages describe themselves as "... Template — requires attorney review
 *      before launch." - internal process text served as the search snippet.
 *
 *   5. NO FAQ STRUCTURED DATA. roman.agent.md's SEO section asks for
 *      "structured data where appropriate"; /faq renders 15 Q&As with no
 *      FAQPage JSON-LD, while /reviews already ships AggregateRating.
 *
 * Every assertion here failed against the tree as of commit 2b33606.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const MARKETING = join(SRC_ROOT, 'app', '(marketing)');
/** Runner cwd is apps/web (yarn test); public/ sits beside src/. */
const WEB_ROOT = process.cwd();

/** Extract the `export const metadata` object literal from a page source. */
function metadataBlock(src: string): string {
  const start = src.indexOf('export const metadata');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.search(/^\};?\s*$/m);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('sitemap integrity', () => {
  it('emits every URL exactly once (the homepage used to appear twice)', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const urls = sitemap().map((e) => e.url);

    expect(urls.length, 'sitemap collapsed').toBeGreaterThanOrEqual(19);

    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const u of urls) {
      if (seen.has(u)) dupes.push(u);
      seen.add(u);
    }
    expect(dupes, `duplicate <loc> entries: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every sitemap URL is absolute and on our own origin', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const { siteOrigin } = await import('@/lib/seo');
    const origin = siteOrigin();
    for (const { url } of sitemap()) {
      expect(url.startsWith(origin), `${url} is not on ${origin}`).toBe(true);
    }
  });

  it('lists the indexable cash-offer landing page', async () => {
    // /cash-offer carries a canonical and renders inside the indexable
    // (marketing) group, but was absent from the sitemap - an indexable page
    // no crawler was told about.
    const { default: sitemap } = await import('@/app/sitemap');
    const { siteOrigin } = await import('@/lib/seo');
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(`${siteOrigin()}/cash-offer`);
  });
});

describe('title template discipline', () => {
  it('no marketing page title literal repeats the brand (the template appends it)', () => {
    const pages = scanSource(MARKETING, { onlyFile: 'page.tsx' });
    expect(pages.length, 'marketing page scan collapsed').toBeGreaterThan(15);

    const offenders: string[] = [];
    for (const page of pages) {
      const block = metadataBlock(readSource(page));
      if (!block) continue;
      // Only TOP-LEVEL title keys: nested openGraph.title (deeper indent)
      // legitimately carries the brand because no template applies there.
      const m = block.match(/^ {2}title:\s*"([^"]*)"/m);
      if (m && m[1].includes('DealFlow AI')) {
        offenders.push(
          `${page.replace(MARKETING, 'app/(marketing)')}: title: "${m[1]}" → renders "${m[1]} — DealFlow AI"`
        );
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('social image wiring', () => {
  it('canonicalFor attaches an og:image that exists on disk', async () => {
    const { canonicalFor } = await import('@/lib/seo');
    const og = canonicalFor('/pricing').openGraph as { images?: unknown };

    expect(
      og.images,
      'canonicalFor emits no openGraph.images - every marketing page is ' +
        'an imageless social card (live og:image: NOT FOUND 2026-10-09)'
    ).toBeDefined();

    const list = Array.isArray(og.images) ? og.images : [og.images];
    expect(list.length).toBeGreaterThan(0);
    for (const img of list) {
      const path = String(img);
      // Absolute (resolved against metadataBase) or root-relative both OK;
      // the file itself must exist under public/.
      const rel = path.startsWith('http') ? new URL(path).pathname : path;
      expect(
        existsSync(join(WEB_ROOT, 'public', rel)),
        `og:image ${path} does not exist in public/`
      ).toBe(true);
    }
  });

  it('the marketing layout declares a twitter:image for the large card', () => {
    const src = readSource(join(MARKETING, 'layout.tsx'));
    expect(
      src,
      'twitter:card is summary_large_image but no twitter:image is declared'
    ).toMatch(/twitter:\s*\{[^}]*images:/);
  });
});

describe('meta description hygiene', () => {
  it('no marketing metadata ships internal placeholder text', () => {
    const pages = scanSource(MARKETING, { onlyFile: 'page.tsx' });
    const offenders: string[] = [];
    for (const page of pages) {
      const block = metadataBlock(readSource(page));
      if (!block) continue;
      if (/requires attorney review|TBD|FIXME|lorem ipsum/i.test(block)) {
        offenders.push(page.replace(MARKETING, 'app/(marketing)'));
      }
    }
    expect(
      offenders,
      'placeholder text served as the live search snippet (seen on all ' +
        `nine /legal/* pages 2026-10-09):\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});

describe('FAQ structured data', () => {
  it('the FAQ page renders an FAQPage JSON-LD script', () => {
    const src = readSource(join(MARKETING, 'faq', 'page.tsx'));
    expect(src, '/faq ships no structured data').toMatch(
      /application\/ld\+json/
    );
    expect(src).toMatch(/FAQPage/);
  });

  it('the schema object is well-formed and covers every published question', async () => {
    // Behavioral, not textual: the builder lives in lib so it can be imported
    // and structurally validated rather than grepped.
    const { buildFaqJsonLd } = await import('@/lib/faq-schema');
    const { faqs } = await import('@/lib/faq-content');
    const schema = buildFaqJsonLd() as {
      '@context': string;
      '@type': string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };

    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('FAQPage');

    const total = faqs.reduce((n, c) => n + c.questions.length, 0);
    expect(total, 'fixture collapsed').toBeGreaterThanOrEqual(15);
    expect(schema.mainEntity.length).toBe(total);
    for (const item of schema.mainEntity) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  it('the JSON embedded in the page escapes "</" so markup cannot break out', async () => {
    // BEHAVIOURAL, not a regex over the page source.
    //
    // An earlier version of this assertion grepped faq/page.tsx for an inline
    // `JSON.stringify(...).replace(/</`. That forced the escaping to happen in
    // the page, which duplicated it away from the helper that produces the
    // payload - so the test could pass while the embedded string was still
    // built unsafely. The escape now lives in ONE place (jsonLdForEmbed) and is
    // asserted by calling it, per the same reasoning as the test above.
    const { jsonLdForEmbed } = await import('@/lib/faq-schema');

    // The exact break-out attempt: a </script> inside a string value.
    const embedded = jsonLdForEmbed({
      '@type': 'Question',
      name: 'What if a question contains </script><img src=x onerror=alert(1)>?',
      acceptedAnswer: { text: 'It must not terminate the script element.' },
    });

    // No raw '<' survives anywhere in the embedded payload.
    expect(embedded, 'raw "<" survives in the embedded JSON-LD').not.toContain('<');
    expect(embedded).toContain('\\u003c');
    // Still valid JSON that round-trips to the original text.
    expect(JSON.parse(embedded).name).toBe(
      'What if a question contains </script><img src=x onerror=alert(1)>?'
    );

    // And the page must actually USE the escaping helper. Without this the test
    // above would pass for a page that embeds raw JSON.stringify output.
    const src = readSource(join(MARKETING, 'faq', 'page.tsx'));
    expect(
      src,
      'faq/page.tsx embeds JSON-LD without the escaping helper'
    ).toMatch(/jsonLdForEmbed/);
    expect(
      src,
      'faq/page.tsx must embed via dangerouslySetInnerHTML, not a JSX child'
    ).toMatch(/dangerouslySetInnerHTML/);
  });
});

