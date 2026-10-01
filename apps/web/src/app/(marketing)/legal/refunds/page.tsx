import type { Metadata } from "next";
import { LegalDocPage } from "@/components/LegalDocPage";
import { getLegalDoc } from "@/lib/legal";
import { canonicalFor } from '@/lib/seo';

const SLUG = "refunds";

/**
 * STATIC metadata, deliberately NOT `generateMetadata()`.
 *
 * `generateMetadata()` opts a route out of static prerendering. On
 * OpenNext/Cloudflare Workers these legal pages then rendered as a Next error
 * document and were served as 404 IN PRODUCTION while returning 200 locally
 * — so `/privacy` and `/terms` 308-redirected visitors into a dead page
 * (verified live 2026-10-01; guarded by static-metadata.guard.test.ts).
 *
 * The title is derived from markdown frontmatter, but the SLUG is a
 * compile-time constant and `content/legal/*.md` ships inside the Worker
 * bundle, so the value is fully static at build time and nothing is lost by
 * evaluating it here instead of per request.
 */
const doc = getLegalDoc(SLUG);

export const metadata: Metadata = {
  ...canonicalFor('/legal/refunds'),
  title: doc?.title ?? "Legal",
  description: `${doc?.title ?? "Legal document"} for DealFlow AI. Template — requires attorney review before launch.`,
};

export default function Page() {
  return <LegalDocPage slug={SLUG} />;
}
