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
