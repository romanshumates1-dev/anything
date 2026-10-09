/**
 * Renders the FAQ page to real HTML so the JSON-LD block is proven to reach the
 * DOM as a scraper sees it - not merely to exist in a helper.
 *
 * The static ratchets in seo-surface.guard.test.ts read SOURCE TEXT. This does
 * not: it mounts the actual component and inspects the markup. That closes the
 * gap this repo has been bitten by twice (a passing API test while the page
 * never called the endpoint, and a "live 200" page rendering mock rows).
 *
 * Run: npx vitest run --config src/app/api/vitest.config.ts faq-jsonld.render
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FAQPage from '@/app/(marketing)/faq/page';
import { faqs } from '@/lib/faq-content';

describe('FAQ page renders its structured data', () => {
  const html = renderToStaticMarkup(FAQPage());

  it('emits an ld+json script element in the actual markup', () => {
    expect(html).toContain('application/ld+json');
  });

  it('the embedded JSON is parseable and covers every rendered question', () => {
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    expect(match, 'no ld+json script found in rendered HTML').not.toBeNull();

    const schema = JSON.parse(match![1]);
    expect(schema['@type']).toBe('FAQPage');

    const expected = faqs.flatMap((c) => c.questions.map((q) => q.q));
    expect(schema.mainEntity.map((q: { name: string }) => q.name)).toEqual(
      expected
    );
  });

  it('the script element cannot be broken out of by its own content', () => {
    // The escape must survive all the way into the emitted markup: a raw "<"
    // inside the script would let the payload terminate the element early.
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    const payload = match![1];
    expect(payload).not.toContain('</script');
    expect(payload).not.toContain('<');
  });

  it('the visible questions match the schema (no markup/content divergence)', () => {
    // Both sides are driven by the same array, so this pins that property.
    for (const category of faqs) {
      for (const q of category.questions) {
        // The question text appears in the rendered <summary>.
        expect(html).toContain(q.q.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
      }
    }
  });
});
