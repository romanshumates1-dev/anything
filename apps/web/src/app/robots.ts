import type { MetadataRoute } from "next";

// The sitemap lives at the deployed origin. NEXT_PUBLIC_APP_URL is inlined at
// build time (set it in the build environment); the fallback is the production
// apex. robots.ts previously pointed at dealflow.ai — a domain we do not own —
// which would break search-engine sitemap discovery in production.
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://dealswiftautomation.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}