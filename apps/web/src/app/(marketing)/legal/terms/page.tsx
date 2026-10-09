import type { Metadata } from "next";
import { LegalDocPage } from "@/components/LegalDocPage";
import { getLegalDoc, legalMetaDescription } from "@/lib/legal";
import { canonicalFor } from '@/lib/seo';

const SLUG = "terms";

/**
 * STATIC metadata, deliberately NOT `generateMetadata()`.
 *
 * `generateMetadata()` opts a route out of static prerendering. On
 * OpenNext/Cloudflare Workers these legal pages then rendered as a Next error
 * document and were served as 404 IN PRODUCTION while returning 200 locally
 * â€” so `/privacy` and `/terms` 308-redirected visitors into a dead page
 * (verified live 2026-10-01; guarded by static-metadata.guard.test.ts).
 *
 * The title is derived from markdown frontmatter, but the SLUG is a
 * compile-time constant and `content/legal/*.md` ships inside the Worker
 * bundle, so the value is fully static at build time and nothing is lost by
 * evaluating it here instead of per request.
 */
const doc = getLegalDoc(SLUG);

export const metadata: Metadata = {
  ...canonicalFor('/legal/terms'),
  title: doc?.title ?? "Legal",
  // Derived from the document's own opening text (legalMetaDescription), not
  // internal process copy. This line used to read ... Template - requires
  // attorney review before launch. on all nine legal pages, which shipped as
  // the live search snippet for every one of them (verified 2026-10-09).
  description: legalMetaDescription(doc),
};

export default function Page() {
  return <LegalDocPage slug={SLUG} />;
}
