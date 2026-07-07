import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact DealFlow AI for a demo, pricing questions, or enterprise inquiries.",
};

export default function ContactPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Get in touch</h1>
          <p className="mt-4 text-lg text-gray-600">
            Have a question or want a demo? Email us and we&rsquo;ll respond within 1 business day.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-8 shadow-sm">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <p className="mt-1 text-sm text-gray-900">support@dealflow.ai</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone</label>
              <p className="mt-1 text-sm text-gray-900">(555) 123-4567</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Address</label>
              <p className="mt-1 text-sm text-gray-900">DealFlow AI Inc.<br />123 Market Street<br />Suite 400<br />San Francisco, CA 94105</p>
            </div>
            <div className="pt-4 border-t">
              <p className="text-xs text-gray-500">
                For form submissions, use <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">POST /api/contact</code>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}