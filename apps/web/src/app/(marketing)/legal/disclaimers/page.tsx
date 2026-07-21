// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import { LegalDocRenderer } from "@/components/LegalDocRenderer";

export const metadata: Metadata = {
  title: "Disclaimers",
  description: "DealFlow AI disclaimers including results-not-typical, no-guarantee, and not-a-brokerage statements.",
  openGraph: {
    title: "Disclaimers",
    description: "Important disclaimers for DealFlow AI users.",
  },
};

export default function DisclaimersPage() {
  return (
    <LegalDocRenderer docType="disclaimers" title="Disclaimers" />
  );
}