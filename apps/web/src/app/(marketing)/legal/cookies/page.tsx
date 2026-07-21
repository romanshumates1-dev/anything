// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import { LegalDocRenderer } from "@/components/LegalDocRenderer";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "DealFlow AI cookie policy. Information about essential and optional cookies used on our platform.",
  openGraph: {
    title: "Cookie Policy",
    description: "Website cookie usage information.",
  },
};

export default function CookiesPage() {
  return (
    <LegalDocRenderer docType="cookies" title="Cookie Policy" />
  );
}