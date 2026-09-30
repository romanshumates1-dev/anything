import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./global.css";
import { Providers } from "./providers";
import Shell from "@/components/Shell";

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
			<body className={inter.className}>
				<Providers>
				<Shell>{children}</Shell>
				</Providers>
			</body>
		</html>
	);
}
