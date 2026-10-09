import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { canonicalFor } from '@/lib/seo';
import { faqs } from '@/lib/faq-content';
import { buildFaqJsonLd, jsonLdForEmbed } from '@/lib/faq-schema';

export const metadata: Metadata = {
	...canonicalFor('/faq'),
  title: "FAQ",
  description:
    "Frequently asked questions about DealFlow AI: setup, pricing, AI capabilities, compliance, and integrations.",
};

/**
 * FAQPage structured data.
 *
 * The questions used to exist only as JSX in this file, so /faq published no
 * structured data at all and was ineligible for FAQ rich results. The content
 * now lives in lib/faq-content.ts, shared with buildFaqJsonLd(), so the markup
 * describes exactly what this page renders.
 *
 * `jsonLdForEmbed` escapes `<` so answer text containing `</script>` cannot
 * terminate the element early.
 */
const faqJsonLd = jsonLdForEmbed(buildFaqJsonLd());



export default function FAQPage() {
  return (
    <div className="bg-[#0F172A]">
      {/*
        FAQPage structured data. `dangerouslySetInnerHTML` is the only way to
        emit a raw JSON-LD blob from React; it is safe here because the payload
        is our own build-time constant and `jsonLdForEmbed` has already escaped
        every `<`. The regex in seo-surface.guard.test.ts pins that escape.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLd }}
      />
      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">FAQ</span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">
              Frequently asked questions
            </h1>
            <p className="text-xl text-slate-400">
              Everything you need to know about DealFlow AI.
            </p>
          </div>

          {/* FAQ Categories */}
          <div className="space-y-12">
            {faqs.map((category) => (
              <div key={category.category}>
                <h2 className="text-lg font-semibold text-white mb-6 pb-2 border-b border-white/10">
                  {category.category}
                </h2>
                <div className="space-y-4">
                  {category.questions.map((item) => (
                    <details key={item.q} className="group rounded-xl border border-white/10 bg-[#1E293B]/30">
                      <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                        <span className="font-medium text-white pr-4">{item.q}</span>
                        <span className="text-slate-400 group-open:rotate-180 transition-transform flex-shrink-0">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </summary>
                      <div className="px-6 pb-6 text-slate-400 leading-relaxed">{item.a}</div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Still Have Questions */}
          <div className="mt-20 text-center rounded-2xl border border-white/10 bg-[#1E293B]/30 p-12">
            <h2 className="text-2xl font-bold text-white mb-4">Still have questions?</h2>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              Can't find what you're looking for? Our team is here to help.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
            >
              Contact Support
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
