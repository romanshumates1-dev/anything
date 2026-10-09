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
import type { Metadata } from 'next';

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
 * The single social card, root-relative so it is valid under public/.
 *
 * 1200x630 - the Open Graph / Twitter summary_large_image ratio. Kept as a
 * constant because the same path is needed by `canonicalFor`, the marketing
 * layout's twitter block and the favicon/asset guard test, and a third
 * spelling of it is exactly how the icon rot went unnoticed.
 */
export const SOCIAL_IMAGE_PATH = '/og-image.png';


/**
 * Self-referencing canonical for a public path.
 *
 * The query string and fragment are deliberately excluded: they do not identify
 * a different document, and including a tracking parameter would tell a crawler
 * the tagged URL is canonical.
 *
 * TYPING NOTE — do NOT add `as const` back. `OpenGraph.images` is typed
 * `OGImage | OGImage[]`, a MUTABLE array, so a `readonly` tuple is rejected.
 * It was `as const` from 2026-10-09 and produced 13 TS2322 errors across every
 * page that spreads this helper; `next build` skips type validation so the
 * build stayed green while `tsc -p tsconfig.typecheck.json` failed.
 */
export function canonicalFor(path: string): Metadata {
  // The root keeps its trailing slash: `https://site/` is the conventional form
  // and avoids emitting two spellings of the homepage across pages.
  const clean = path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}`;
  const url = `${siteOrigin()}${clean}`;
  return {
    alternates: { canonical: url },
    openGraph: {
      url,
      // The social image lives HERE, in the one helper every marketing page
      // spreads, rather than on each page. Next.js REPLACES a parent's
      // `openGraph` wholesale with the child's when the child declares one -
      // it does not deep-merge - so a page-level `openGraph` silently dropped
      // the layout's og:siteName and og:locale, and nothing supplied an image.
      // The result shipped as `og:image: NOT FOUND` on every marketing page
      // while `twitter:card` promised a large image (verified live 2026-10-09).
      //
      // Absolute, because scrapers do not resolve relative og:image URLs.
      images: [`${siteOrigin()}${SOCIAL_IMAGE_PATH}`],
    },
  };
}

