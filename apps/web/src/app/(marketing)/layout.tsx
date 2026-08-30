import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "../global.css";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";

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
    url: "https://dealflow.ai",
    siteName: "DealFlow AI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DealFlow AI — Real Estate Lead Intelligence",
    description:
      "AI-powered lead engagement, approval workflows, and compliance for real estate wholesalers and brokers.",
  },
  robots: { index: true, follow: true },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const legalEntityName = process.env.LEGAL_ENTITY_NAME || process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME;
  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-blue-700">
            DealFlow AI
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <Link href="/features" className="hover:text-blue-700 transition-colors">Features</Link>
            <Link href="/pricing" className="hover:text-blue-700 transition-colors">Pricing</Link>
            <Link href="/trust" className="hover:text-blue-700 transition-colors">Trust</Link>
            <Link href="/faq" className="hover:text-blue-700 transition-colors">FAQ</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/account/signin"
              className="text-sm font-medium text-gray-600 hover:text-blue-700 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <CookieConsentBanner />
      <footer className="border-t bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Product</h3>
              <ul className="mt-4 space-y-3">
                <li><Link href="/features" className="text-sm text-gray-600 hover:text-blue-700">Features</Link></li>
                <li><Link href="/pricing" className="text-sm text-gray-600 hover:text-blue-700">Pricing</Link></li>
                <li><Link href="/trust" className="text-sm text-gray-600 hover:text-blue-700">Trust Center</Link></li>
                <li><Link href="/reviews" className="text-sm text-gray-600 hover:text-blue-700">Reviews</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Legal</h3>
              <ul className="mt-4 space-y-3">
                <li><Link href="/legal/terms" className="text-sm text-gray-600 hover:text-blue-700">Terms of Service</Link></li>
                <li><Link href="/legal/privacy" className="text-sm text-gray-600 hover:text-blue-700">Privacy Policy</Link></li>
                <li><Link href="/legal/acceptable-use" className="text-sm text-gray-600 hover:text-blue-700">Acceptable Use</Link></li>
                <li><Link href="/legal/sms-terms" className="text-sm text-gray-600 hover:text-blue-700">SMS Terms</Link></li>
                <li><Link href="/legal/refunds" className="text-sm text-gray-600 hover:text-blue-700">Refund Policy</Link></li>
                <li><Link href="/legal/cookies" className="text-sm text-gray-600 hover:text-blue-700">Cookie Policy</Link></li>
                <li><Link href="/legal/esign" className="text-sm text-gray-600 hover:text-blue-700">E-SIGN Consent</Link></li>
                <li><Link href="/legal/dmca" className="text-sm text-gray-600 hover:text-blue-700">DMCA</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Company</h3>
              <ul className="mt-4 space-y-3">
                <li><Link href="/about" className="text-sm text-gray-600 hover:text-blue-700">About</Link></li>
                <li><Link href="/contact" className="text-sm text-gray-600 hover:text-blue-700">Contact</Link></li>
                <li><Link href="/how-it-works" className="text-sm text-gray-600 hover:text-blue-700">How It Works</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Compliance</h3>
              {/* Only practices we enforce in code — never certification claims
                  we don't hold (SOC 2 / 10DLC / A2P badges removed, bug #31). */}
              <ul className="mt-4 space-y-3">
                <li><Link href="/trust" className="text-sm text-gray-600 hover:text-blue-700">Messaging Practices</Link></li>
                <li><Link href="/legal/sms-terms" className="text-sm text-gray-600 hover:text-blue-700">SMS Terms</Link></li>
                <li><Link href="/legal/disclaimers" className="text-sm text-gray-600 hover:text-blue-700">Disclaimers</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t pt-8">
            <p className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} DealFlow AI. All rights reserved.
              {legalEntityName && (
                <>
                  <br />
                  <span className="text-gray-400">{legalEntityName}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}