import type { Metadata } from "next";
import { LegalDocPage } from "@/components/LegalDocPage";
import { getLegalDoc } from "@/lib/legal";
import { canonicalFor } from '@/lib/seo';

const SLUG = "sms-terms";

export function generateMetadata(): Metadata {
  const doc = getLegalDoc(SLUG);
  return {
    ...canonicalFor('/legal/sms-terms'),
    title: doc?.title ?? "Legal",
    description: `${doc?.title ?? "Legal document"} for DealFlow AI. Template — requires attorney review before launch.`,
  };
}

export default function Page() {
  return <LegalDocPage slug={SLUG} />;
}
