import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./global.css";
import { Providers } from "./providers";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
	title: "Anything App",
	description: "Created with Anything",
	icons: {
		icon: "/favicon.png",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>
				<Providers>
				<Shell>{children}</Shell>
				</Providers>
			</body>
		</html>
	);
}
