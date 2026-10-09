import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "../global.css";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { siteOrigin, SOCIAL_IMAGE_PATH } from "@/lib/seo";

export const metadata: Metadata = {
  title: {
    default: "DealFlow AI — Real Estate Lead Intelligence",
    template: "%s — DealFlow AI",
  },
  description:
    "AI-powered lead engagement, approval workflows, and compliance for real estate wholesalers and brokers.",
  openGraph: {
    title: "DealFlow AI — Real Estate Lead Intelligence",
    description:
      "AI-powered lead engagement, approval workflows, and compliance for real estate wholesalers and brokers.",
    // siteOrigin(), not a literal: og:url used to hard-code `dealflow.ai` (a
    // domain this project does not own) and ignored NEXT_PUBLIC_APP_URL, so
    // social scrapers were told the canonical home of every marketing page was
    // a third party's site.
    url: siteOrigin(),
    siteName: "DealFlow AI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    // `summary_large_image` promises a large image. Without this the card
    // declared a format it could not fill: scrapers found no image at all
    // (og:image / twitter:image both NOT FOUND live 2026-10-09). The same
    // absolute path canonicalFor uses, so the two can never disagree.
    images: [`${siteOrigin()}${SOCIAL_IMAGE_PATH}`],
    title: "DealFlow AI — Real Estate Lead Intelligence",
    description:
      "AI-powered lead engagement, approval workflows, and compliance for real estate wholesalers and brokers.",
  },
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const legalEntityName = process.env.LEGAL_ENTITY_NAME || process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME;
  return (
    <div className="min-h-screen bg-[#0F172A]">
      <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#0F172A]/95 backdrop-blur-xl supports-[backdrop-filter]:bg-[#0F172A]/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3" prefetch={false}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
              <span className="text-white font-bold text-sm">DF</span>
            </div>
            <span className="text-lg font-semibold text-white">DealFlow AI</span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
            <Link href="/features" className="text-slate-400 hover:text-white transition-colors" prefetch={false}>Features</Link>
            <Link href="/pricing" className="text-slate-400 hover:text-white transition-colors" prefetch={false}>Pricing</Link>
            <Link href="/how-it-works" className="text-slate-400 hover:text-white transition-colors" prefetch={false}>How It Works</Link>
            <Link href="/trust" className="text-slate-400 hover:text-white transition-colors" prefetch={false}>Trust</Link>
            <Link href="/faq" className="text-slate-400 hover:text-white transition-colors" prefetch={false}>FAQ</Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link
              href="/account/signin"
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
             prefetch={false}>
              Sign In
            </Link>
            <Link
              href="/account/signup"
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
             prefetch={false}>
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <CookieConsentBanner />
      <footer className="border-t border-white/10 bg-[#0A0F1A]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
                  <span className="text-white font-bold text-sm">DF</span>
                </div>
                <span className="text-lg font-semibold text-white">DealFlow AI</span>
              </div>
              <p className="text-sm text-slate-500 max-w-xs">
                AI-powered lead intelligence for real estate wholesalers and brokers.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">Product</h3>
              <ul className="space-y-3">
                <li><Link href="/features" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Features</Link></li>
                <li><Link href="/pricing" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Pricing</Link></li>
                <li><Link href="/trust" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Trust Center</Link></li>
                <li><Link href="/reviews" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Reviews</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">Company</h3>
              <ul className="space-y-3">
                <li><Link href="/about" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>About</Link></li>
                <li><Link href="/contact" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Contact</Link></li>
                <li><Link href="/how-it-works" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>How It Works</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">Legal</h3>
              <ul className="space-y-3">
                <li><Link href="/legal/terms" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Terms of Service</Link></li>
                <li><Link href="/legal/privacy" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Privacy Policy</Link></li>
                <li><Link href="/legal/disclaimers" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Disclaimers</Link></li>
                <li><Link href="/legal/acceptable-use" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Acceptable Use</Link></li>
                <li><Link href="/legal/sms-terms" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>SMS Terms</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white mb-4">Compliance</h3>
              <ul className="space-y-3">
                <li><Link href="/trust" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Messaging Practices</Link></li>
                <li><Link href="/legal/refunds" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Refund Policy</Link></li>
                <li><Link href="/legal/cookies" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>Cookie Policy</Link></li>
                <li><Link href="/legal/dmca" className="text-sm text-slate-500 hover:text-white transition-colors" prefetch={false}>DMCA</Link></li>
              </ul>
            </div>
          </div>
          {/* Platform Disclaimer */}
          <div className="mt-8 pt-6 border-t border-white/10 text-center">
            <p className="text-xs text-slate-500 max-w-3xl mx-auto">
              DealFlow AI is a software platform, not a real estate brokerage.
              We do not provide legal, financial, or real estate advice.
              Contract templates are examples only. Always consult licensed professionals.{' '}
              <Link href="/legal/disclaimers" className="text-slate-400 hover:text-white transition-colors underline" prefetch={false}>
                View full disclaimers
              </Link>
            </p>
          </div>

          <div className="mt-6 pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} DealFlow AI. All rights reserved.
              {legalEntityName && (
                <span className="text-slate-600 ml-2">{legalEntityName}</span>
              )}
            </p>
            <div className="flex items-center gap-6">
              <Link href="/legal/disclaimers#fair-housing-statement" className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5" prefetch={false}>
                <span className="w-4 h-4 rounded bg-slate-700 flex items-center justify-center text-[10px]">EH</span>
                Equal Housing Opportunity
              </Link>
              <span className="text-xs text-slate-600 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                All systems operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
