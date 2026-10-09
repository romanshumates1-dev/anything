import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/seo";

/**
 * Sitemap of the public, indexable surface.
 *
 * Two properties are load-bearing and were both violated before 2026-10-09:
 *
 *  1. NO DUPLICATES. This file used to list the homepage twice - once as
 *     `{ url: BASE_URL }` and once as `{ url: `${BASE_URL}` }`, two spellings of
 *     the identical string. A repeated <loc> makes a sitemap malformed, and
 *     Google Search Console rejects it outright, so the whole file (including
 *     the 18 valid URLs) was discarded.
 *
 *  2. NOTHING INDEXABLE IS MISSING. `/cash-offer` carries a canonical and lives
 *     inside the indexable (marketing) group, yet no sitemap entry told a
 *     crawler it existed.
 *
 * The origin comes from `siteOrigin()` (single source of truth, shared with
 * lib/seo.ts, robots.ts and the root layout) rather than a fourth copy of the
 * env-var fallback, so the three files cannot drift again.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteOrigin();

  /** Build an entry from a PATH so the origin is only spelled once. */
  const entry = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: path === "/" ? `${base}/` : `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority,
  });

  return [
    entry("/", 1.0),
    entry("/how-it-works", 0.9),
    entry("/features", 0.9),
    entry("/pricing", 0.9),
    entry("/cash-offer", 0.9),
    entry("/trust", 0.8),
    entry("/reviews", 0.8),
    entry("/faq", 0.8),
    entry("/contact", 0.8),
    entry("/about", 0.7),
    // Legal pages. /legal/accept is deliberately absent: it is an
    // authenticated re-acceptance interstitial that sets `robots: index false`.
    entry("/legal/terms", 0.5),
    entry("/legal/privacy", 0.5),
    entry("/legal/acceptable-use", 0.5),
    entry("/legal/sms-terms", 0.5),
    entry("/legal/refunds", 0.5),
    entry("/legal/cookies", 0.5),
    entry("/legal/disclaimers", 0.5),
    entry("/legal/esign", 0.5),
    entry("/legal/dmca", 0.5),
  ];
}
