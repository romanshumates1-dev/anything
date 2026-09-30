/**
 * SEO metadata helpers.
 *
 * CANONICAL
 * A canonical URL tells a search engine which URL is authoritative for a page.
 * Without one, the SAME content is reachable at `/`, `/pricing`, `/pricing/`,
 * `/pricing?utm_source=x`, `/pricing#faq` and so on, each a candidate for
 * indexing - which splits ranking signal and lets a scraper mirror the site.
 *
 * Next.js does NOT emit a canonical on its own. It must be declared per page.
 * `canonicalFor` builds a self-referencing absolute canonical, resolved against
 * the `metadataBase` set in the root layout, so the helper stays correct if the
 * production domain changes.
 *
 * USAGE
 *   export const metadata: Metadata = {
 *     ...canonicalFor('/pricing'),
 *     title: 'Pricing',
 *   };
 */

/**
 * Absolute site origin, matching the root layout's metadataBase fallback.
 *
 * The fallback must be the production apex we actually serve from. It used to
 * be `dealflow.ai` — a domain this project does not own — so with
 * NEXT_PUBLIC_APP_URL unset every canonical and og:url pointed crawlers at
 * someone else's site (the same defect robots.ts documents having fixed).
 * Keep this in lockstep with robots.ts and sitemap.ts, which already fall back
 * to the real apex.
 */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://dealswiftautomation.com').replace(/\/+$/, '');
}

/**
 * Self-referencing canonical for a public path.
 *
 * The query string and fragment are deliberately excluded: they do not identify
 * a different document, and including a tracking parameter would tell a crawler
 * the tagged URL is canonical.
 */
export function canonicalFor(path: string) {
  // The root keeps its trailing slash: `https://site/` is the conventional form
  // and avoids emitting two spellings of the homepage across pages.
  const clean = path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}`;
  return {
    alternates: { canonical: `${siteOrigin()}${clean}` },
    openGraph: { url: `${siteOrigin()}${clean}` },
  } as const;
}
