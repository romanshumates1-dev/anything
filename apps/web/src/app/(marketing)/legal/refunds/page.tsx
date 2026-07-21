// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import { LegalDocRenderer } from "@/components/LegalDocRenderer";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "DealFlow AI refund and billing policy. 30-day money-back guarantee, prorated refunds, and chargeback procedures.",
  openGraph: {
    title: "Refund Policy",
    description: "Billing and refund terms.",
  },
};

export default function RefundsPage() {
  return (
    <LegalDocRenderer docType="refunds" title="Refund & Billing Policy" />
  );
}