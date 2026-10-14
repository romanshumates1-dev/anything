/**
 * Structured data (JSON-LD) for public marketing pages.
 *
 * WHY THIS EXISTS
 * ---------------
 * Google's rich-results system reads JSON-LD to understand a page's
 * purpose beyond raw HTML.  Without it, search snippets fall back to
 * plain-title extraction and the site loses sitelinks, the Knowledge
 * Panel, and search-box suggestions.
 *
 * Only 2 of 21 public pages emitted structured data as of 2026-10-09
 * (FAQ via lib/faq-schema.ts, Reviews inline).  This module provides
 * a single, testable builder for the homepage's two most important
 * schemas — WebSite and Organization — following the exact pattern
 * established by faq-schema.ts:
 *
 *   1. build*Schema()  → plain object (pure, unit-testable)
 *   2. jsonLdForEmbed() → serialized + `<` escaped (imported from faq-schema)
 *
 * The escape is REQUIRED: inside <script> the HTML parser does not
 * understand JS string literals, so a literal `</script>` in any
 * string field ends the element early.  Every `<` is neutralised
 * to \u003c (the standard Next.js / json-next recommendation).
 *
 * All URLs are absolute (built from siteOrigin()) for the same reason
 * canonicalFor uses absolute URLs: scrapers must resolve them
 * correctly regardless of where the JSON-LD is consumed.
 */
import { siteOrigin, SOCIAL_IMAGE_PATH } from './seo';
import { jsonLdForEmbed } from './faq-schema';

/**
 * The site-level name and description used by every schema that needs
 * them.  Kept in one place so the homepage markup cannot drift from
 * the marketing-layout metadata (layout.tsx title/description).
 */
export const SITE_NAME = 'DealFlow AI';
export const SITE_DESCRIPTION =
  'AI-powered real estate lead engagement automation for wholesalers and brokers.';

/**
 * WebSite schema (homepage).
 *
 * Enables a sitelink search box in Google results and tells crawlers
 * the authoritative home URL.  Maps to the `potentialAction` /
 * SearchAction object in schema.org.
 */
export function buildWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: `${siteOrigin()}/`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    // Sitelink search box: points at the lead-finder, the most
    // common entry task on the site.
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteOrigin()}/lead-finder?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * Organization schema (homepage).
 *
 * Surfaces the company name, logo, and sameAs social links so Google
 * can populate the Knowledge Panel and rich-result headers.  `sameAs`
 * is an empty array until verified social URLs exist — omitting the
 * property entirely is fine, but an empty array is explicit and
 * cannot accidentally surface a stale handle.
 */
export function buildOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    url: `${siteOrigin()}/`,
    name: SITE_NAME,
    logo: {
      '@type': 'ImageObject',
      url: `${siteOrigin()}${SOCIAL_IMAGE_PATH}`,
    },
    sameAs: [],
  };
}

/**
 * FAQPage JSON-LD for any page that renders Q&A pairs as a parameter.
 *
 * /pricing renders six billing FAQs as <details> elements. Those are
 * exactly the kind of question users type into Google ("does DealFlow
 * refund?", "what are AI credits?"), and the page earned nothing for
 * them because only /faq had markup.
 *
 * Google's requirement is that the markup matches what a user sees on
 * the page, so the builder takes the SAME array the JSX maps over.
 * Passing a different list here would be a manual-action risk.
 */
export function buildFaqJsonLdFor(
  items: ReadonlyArray<{ q: string; a: string }>,
  pagePath: string
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url: `${siteOrigin()}${pagePath}`,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  };
}

/**
 * Product + Offer schema for /pricing.
 *
 * WHY THE OFFERS COME FROM A PARAMETER
 * ------------------------------------
 * /pricing reads `subscription_plans` from the database at render time
 * ("single source of truth"), so the schema MUST be built from those same
 * rows. A hardcoded price list here would drift from the page on the next
 * plan change — and a schema that disagrees with the visible price is a
 * structured-data violation, not just a cosmetic bug.
 *
 * HONESTY CONSTRAINT
 * ------------------
 * Only the real `price` is emitted. The page also computes a synthetic
 * `originalPrice` (`price * 2`) for the "50% OFF" banner; that figure is
 * marketing framing, not a genuine list price, so it is deliberately NOT
 * put into `Offer.price`/`priceSpecification`. Emitting it would be
 * fabricated pricing in machine-readable form.
 *
 * A $0 (free) tier is emitted as a valid Offer with price 0 — Google
 * supports zero-cost Offers and the free tier is genuinely advertised.
 */
export function buildProductSchema(
  tiers: ReadonlyArray<{ name: string; slug: string; price: number; description?: string }>
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'DealFlow AI',
    description: SITE_DESCRIPTION,
    url: `${siteOrigin()}/pricing`,
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: tiers.length ? Math.min(...tiers.map((t) => t.price)) : 0,
      highPrice: tiers.length ? Math.max(...tiers.map((t) => t.price)) : 0,
      offerCount: tiers.length,
      offers: tiers.map((tier) => ({
        '@type': 'Offer',
        name: tier.name,
        url: `${siteOrigin()}/pricing#${tier.slug}`,
        // USD major units (e.g. 129, not 12900), matching lowPrice/highPrice.
        // A number is what Google expects; the page displays the same
        // figure, so schema and UI cannot disagree.
        price: Number(tier.price.toFixed(2)),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        ...(tier.description ? { description: tier.description } : {}),
      })),
    },
  };
}

/**
 * Serialize any schema object into a script-safe JSON-LD string.
 * Re-exports jsonLdForEmbed from faq-schema so callers have a single
 * import surface regardless of which module they build from.
 */
export { jsonLdForEmbed };
