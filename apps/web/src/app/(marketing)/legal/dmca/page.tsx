// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import { LegalDocRenderer } from "@/components/LegalDocRenderer";

export const metadata: Metadata = {
  title: "DMCA Agent",
  description: "DealFlow AI DMCA agent information for copyright takedown notices.",
  openGraph: {
    title: "DMCA Agent",
    description: "Copyright infringement takedown process.",
  },
};

export default function DmcaPage() {
  return (
    <LegalDocRenderer docType="dmca" title="DMCA Agent Information" />
  );
}