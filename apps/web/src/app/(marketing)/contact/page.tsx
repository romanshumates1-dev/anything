import type { Metadata } from "next";
import { ContactForm } from "./ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact DealFlow AI for a demo, pricing questions, or enterprise inquiries. We'll respond within 1 business day.",
  openGraph: {
    title: "Contact DealFlow AI",
    description: "Get in touch for a demo, pricing questions, or enterprise inquiries.",
  },
};

export default function ContactPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Get in touch</h1>
          <p className="mt-4 text-lg text-gray-600">
            Have a question or want a demo? Fill out the form below and we'll respond within 1 business day.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-8 shadow-sm">
          <ContactForm />
        </div>
      </div>
    </div>
  );
}