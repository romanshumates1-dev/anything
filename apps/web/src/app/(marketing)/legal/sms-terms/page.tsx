// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import { LegalDocRenderer } from "@/components/LegalDocRenderer";

export const metadata: Metadata = {
  title: "SMS Terms",
  description: "DealFlow AI SMS program terms. Message frequency, HELP/STOP instructions, carrier disclaimer.",
  openGraph: {
    title: "SMS Terms",
    description: "SMS program terms and conditions.",
  },
};

export default function SMSTermsPage() {
  return (
    <LegalDocRenderer docType="sms_terms" title="SMS Program Terms" />
  );
}