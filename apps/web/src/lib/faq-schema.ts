import { faqs } from './faq-content';
import { siteOrigin } from './seo';

/**
 * FAQPage JSON-LD for /faq.
 *
 * Built from `lib/faq-content.ts` - the same array the page renders - so the
 * structured data and the visible content cannot diverge. Google requires the
 * markup to match what a user sees; a schema describing unrendered questions is
 * a manual-action risk, and one that omits rendered questions loses the
 * eligibility.
 *
 * Category headings are intentionally NOT emitted: FAQPage has no notion of
 * grouping, and each Q&A must be a flat mainEntity entry.
 */
export function buildFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    // Absolute, for the same reason canonicals are.
    url: `${siteOrigin()}/faq`,
    mainEntity: faqs.flatMap((category) =>
      category.questions.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.a,
        },
      }))
    ),
  };
}

/**
 * Serialize JSON-LD for embedding in a <script type="application/ld+json">.
 *
 * The `</` escape is REQUIRED, not stylistic. Inside a <script> element the
 * HTML parser does not understand JavaScript string literals, so a literal
 * `</script>` anywhere in the payload ends the element early and the remainder
 * is parsed as markup. Answer text is user-facing prose that could contain
 * `</script>` (or `<!--`), so every `<` is neutralised. This is the standard
 * Next.js/json-next recommended sanitisation.
 */
export function jsonLdForEmbed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
