// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import { LegalDocRenderer } from "@/components/LegalDocRenderer";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description:
    "DealFlow AI Acceptable Use & Messaging Policy. SHAFT content prohibited, TCPA compliance required, STOP/HELP must be honored.",
  openGraph: {
    title: "Acceptable Use Policy",
    description: "Messaging guidelines and prohibited content policies.",
  },
};

export default function AcceptableUsePage() {
  return (
    <LegalDocRenderer docType="acceptable_use" title="Acceptable Use & Messaging Policy" />
  );
}