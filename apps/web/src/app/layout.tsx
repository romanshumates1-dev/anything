import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./global.css";
import { Providers } from "./providers";
import Shell from "@/components/Shell";
import {
	ACCESSIBILITY_ALLOWED as AccessibilityAllowedValues,
	ACCESSIBILITY_STORAGE_KEY as AccessibilityStorageKey,
	DEFAULT_ACCESSIBILITY as AccessibilityDefaults,
} from "@/components/AccessibilityProvider";

const inter = Inter({
	subsets: ["latin"],
	display: "swap",
	variable: "--font-inter",
	// Load weights used in typography scale: 400 (body), 500 (labels), 600 (h3-h4), 700 (h1-h2), 800 (display/stats)
	weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
	title: "DealFlow AI - Real Estate Wholesaling Automation",
	description: "AI-powered platform for real estate wholesaling. Automate outreach, manage leads, and close more deals.",
	icons: {
		icon: "/favicon.png",
	},
	// Without an absolute base, Next.js emits RELATIVE canonical and OpenGraph
	// URLs, which crawlers and social scrapers cannot resolve. Falls back to the
	// production domain so a missing env var degrades to a correct absolute URL
	// rather than a broken relative one.
	//
	// The fallback is the apex we actually serve from, in lockstep with
	// lib/seo.ts, robots.ts and sitemap.ts. It previously named `dealflow.ai` -a
	// domain this project does not own- so a missing env var told crawlers the
	// canonical copy of every page lived on a third party's site.
	metadataBase: new URL(
		(process.env.NEXT_PUBLIC_APP_URL || "https://dealswiftautomation.com").replace(/\/+$/, "")
	),
	// DENY BY DEFAULT (2026-09-27 SEO sweep).
	//
	// This app is overwhelmingly authenticated: dashboards, campaigns, leads,
	// payouts, contracts, settings, admin. Before this change only /admin opted
	// out, so every OTHER private route was indexable-by-default - and any
	// private route added in future would be too. Inverting the default makes a
	// newly added private page safe the moment it is created; only the
	// (marketing) group has to opt in, and it already does so explicitly.
	robots: {
		index: false,
		follow: false,
		nocache: true,
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className={inter.variable}>
			<head>
				{/*
				 * ACCESSIBILITY, APPLIED BEFORE FIRST PAINT (item 5).
				 *
				 * The saved accessibility choices are read from the localStorage
				 * cache and written onto <html> here, synchronously, before the
				 * browser paints. Without this, a user who selected the dyslexic
				 * font or larger text would see the default typography render
				 * first and then snap on hydration - which for a dyslexic reader
				 * is worse than the flash itself.
				 *
				 * WHY AN INLINE SCRIPT AND NOT React: <html>'s attributes are
				 * decided during hydration, which happens AFTER first paint. This
				 * has to be a blocking script in <head>.
				 *
				 * SAFETY: the values are validated against fixed literals BEFORE
				 * being written as attributes, so a tampered localStorage entry
				 * cannot inject anything into the markup. There is no innerHTML
				 * and no eval - only setAttribute with a known-good value.
				 *
				 * The values are re-applied by <AccessibilityProvider> after it
				 * confirms them against the server, so this cache never wins over
				 * the authoritative copy - it only prevents the flash.
				 */}
				<script
					dangerouslySetInnerHTML={{
						__html: `(function(){try{
var S=${JSON.stringify(AccessibilityStorageKey)};
var D=${JSON.stringify(AccessibilityDefaults)};
var V=${JSON.stringify(AccessibilityAllowedValues)};
var r=window.localStorage.getItem(S);if(!r)return;var c=JSON.parse(r)||{};
var e=document.documentElement;for(var k in V){var v=c[k];
if(typeof v==='string'&&V[k].indexOf(v)>-1){e.setAttribute('data-'+k,v);}}}catch(_){}})();`,
					}}
				/>
			</head>
			<body className={inter.className}>
				<Providers>
				<Shell>{children}</Shell>
				</Providers>
			</body>
		</html>
	);
}
