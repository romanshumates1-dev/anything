import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import "../global.css";

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
            <Link href="/compliance" className="hover:text-blue-700 transition-colors">Compliance</Link>
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
      <footer className="border-t bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Product</h3>
              <ul className="mt-4 space-y-3">
                <li><Link href="/features" className="text-sm text-gray-600 hover:text-blue-700">Features</Link></li>
                <li><Link href="/pricing" className="text-sm text-gray-600 hover:text-blue-700">Pricing</Link></li>
                <li><Link href="/faq" className="text-sm text-gray-600 hover:text-blue-700">FAQ</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Legal</h3>
              <ul className="mt-4 space-y-3">
                <li><Link href="/legal/terms" className="text-sm text-gray-600 hover:text-blue-700">Terms of Service</Link></li>
                <li><Link href="/legal/privacy" className="text-sm text-gray-600 hover:text-blue-700">Privacy Policy</Link></li>
                <li><Link href="/compliance" className="text-sm text-gray-600 hover:text-blue-700">Compliance</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Company</h3>
              <ul className="mt-4 space-y-3">
                <li><Link href="/contact" className="text-sm text-gray-600 hover:text-blue-700">Contact</Link></li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Compliance</h3>
              <ul className="mt-4 space-y-3">
                <li><span className="text-sm text-gray-600">SOC 2</span></li>
                <li><span className="text-sm text-gray-600">10DLC</span></li>
                <li><span className="text-sm text-gray-600">A2P</span></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t pt-8">
            <p className="text-sm text-gray-500">&copy; {new Date().getFullYear()} DealFlow AI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </>
  );
}