// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import { LegalDocRenderer } from "@/components/LegalDocRenderer";

export const metadata: Metadata = {
  title: "E-SIGN Consent",
  description: "DealFlow AI E-SIGN/UETA consent disclosure. Electronic signature agreement terms.",
  openGraph: {
    title: "E-SIGN Consent",
    description: "Electronic signature consent disclosure.",
  },
};

export default function EsignPage() {
  return (
    <LegalDocRenderer docType="esign" title="E-SIGN/UETA Consent" />
  );
}