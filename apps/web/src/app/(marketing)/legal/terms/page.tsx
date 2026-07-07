import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "DealFlow AI terms of service. Standard SaaS agreement — FOR ATTORNEY REVIEW before publication.",
};

export default function TermsPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Terms of Service</h1>
          <p className="mt-4 text-sm text-amber-700 font-medium">[FOR ATTORNEY REVIEW]</p>
        </div>
        <div className="prose prose-gray max-w-none space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-gray-900">1. Agreement to Terms</h2>
            <p className="text-gray-600">By accessing or using DealFlow AI, you agree to be bound by these terms.</p>
          </section>
          <section>
            <h2 className="text-2xl font-bold text-gray-900">2. Use License</h2>
            <p className="text-gray-600">Permission is granted to use DealFlow AI for internal business purposes subject to restrictions.</p>
          </section>
          <section>
            <h2 className="text-2xl font-bold text-gray-900">3. Disclaimer</h2>
            <p className="text-gray-600">The materials on DealFlow AI are provided on an &lsquo;as is&rsquo; basis. DealFlow AI makes no warranties, expressed or implied.</p>
          </section>
          <section>
            <h2 className="text-2xl font-bold text-gray-900">4. Limitations</h2>
            <p className="text-gray-600">In no event shall DealFlow AI or its suppliers be liable for any damages arising out of the use or inability to use the materials.</p>
          </section>
        </div>
      </div>
    </div>
  );
}