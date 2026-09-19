/**
 * ANYTHING PLATFORM - DO NOT REWRITE THIS FILE
 *
 * Shipped v2 auth scaffolding. The <form onSubmit>, e.preventDefault(), and
 * window.location.href redirect are load-bearing for the mobile WebView auth
 * flow (AuthWebView intercepts the navigation to capture the session). A
 * prior AI rewrite replaced <form onSubmit> with <button onClick> and broke
 * signup platform-wide - "credentials cleared" / "button does nothing" for
 * every user until a human reverted it. DO NOT repeat that mistake.
 *
 *   Safe:   restyle, rewrite copy, add form fields (pass `name` explicitly).
 *   Unsafe: replacing <form>, removing preventDefault, bypassing
 *           authClient.signUp.email, changing the callbackUrl redirect.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { SocialSignInButtons } from "@/components/SocialSignInButtons";
import { authClient } from "@/lib/auth-client";
import { CheckCircle, Clock, Shield, Zap, Users, Star, TrendingUp } from "lucide-react";

function SignUpForm() {
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("callbackUrl") || "/";
	const plan = searchParams.get("plan");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [acceptedLegal, setAcceptedLegal] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		// The server backfills `name` from the email local-part when it's missing,
		// so email + password is enough.
		const { error: signUpError } = await authClient.signUp.email({
			email,
			password,
			name: "",
		});

		if (signUpError) {
			setError(signUpError.message ?? "Sign up failed");
			setLoading(false);
			return;
		}

		// Record ToS + Privacy acceptance now that the user has a session. The
		// checkbox is required client-side; the server-side wall is the
		// middleware re-accept gate, which redirects to /legal/accept if this
		// row is missing - so a bypass can't actually use the app unaccepted.
		try {
			await fetch("/api/legal", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ keys: ["tos", "privacy"] }),
			});
		} catch {
			// Non-fatal: the middleware gate will catch a missing acceptance.
		}

		if (typeof window !== "undefined") {
			window.location.href = callbackUrl;
		} else {
			console.warn(
				"signup: window is undefined; cannot redirect to callbackUrl",
			);
		}
	};

	return (
		<main className="flex min-h-screen w-full bg-[#0F172A]">
			{/* Background effects */}
			<div className="fixed inset-0 overflow-hidden pointer-events-none">
				<div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-[#3B82F6]/5 blur-3xl" />
				<div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-[#8B5CF6]/5 blur-3xl" />
			</div>

			{/* Left side - Benefits (hidden on mobile) */}
			<div className="hidden lg:flex lg:w-1/2 relative items-center justify-center p-12">
				<div className="max-w-md">
					<div className="flex items-center gap-3 mb-8">
						<div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
							<span className="text-white font-bold text-lg">DF</span>
						</div>
						<span className="text-2xl font-bold text-white">DealFlow AI</span>
					</div>

					<h2 className="text-3xl font-bold text-white mb-4">
						Start closing more deals with AI
					</h2>
					<p className="text-slate-400 mb-8 leading-relaxed">
						Join 800+ wholesalers using AI to automate lead engagement, negotiate better, and close more deals.
					</p>

					<ul className="space-y-5">
						{[
							{ icon: Zap, text: "AI-powered outreach that works 24/7" },
							{ icon: Shield, text: "Stay in control with approval workflows" },
							{ icon: Clock, text: "Setup in under an hour" },
							{ icon: CheckCircle, text: "14-day free trial, no credit card" },
						].map((item, i) => (
							<li key={i} className="flex items-center gap-4">
								<div className="w-10 h-10 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center">
									<item.icon className="h-5 w-5 text-[#3B82F6]" />
								</div>
								<span className="text-slate-300">{item.text}</span>
							</li>
						))}
					</ul>

					{/* Social Proof Stats */}
					<div className="mt-8 grid grid-cols-3 gap-4">
						<div className="text-center p-3 rounded-lg bg-white/5">
							<div className="flex items-center justify-center gap-1.5 mb-1">
								<Users className="h-4 w-4 text-[#3B82F6]" />
								<span className="text-lg font-bold text-white">800+</span>
							</div>
							<p className="text-xs text-slate-500">Active Users</p>
						</div>
						<div className="text-center p-3 rounded-lg bg-white/5">
							<div className="flex items-center justify-center gap-1.5 mb-1">
								<Star className="h-4 w-4 text-amber-400" />
								<span className="text-lg font-bold text-white">4.9/5</span>
							</div>
							<p className="text-xs text-slate-500">Rating</p>
						</div>
						<div className="text-center p-3 rounded-lg bg-white/5">
							<div className="flex items-center justify-center gap-1.5 mb-1">
								<TrendingUp className="h-4 w-4 text-emerald-400" />
								<span className="text-lg font-bold text-white">$2.4M+</span>
							</div>
							<p className="text-xs text-slate-500">Deal Volume</p>
						</div>
					</div>

					{/* Testimonial */}
					<div className="mt-8 p-6 rounded-2xl border border-white/10 bg-[#1E293B]/30">
						<div className="flex gap-1 mb-3">
							{[...Array(5)].map((_, i) => (
								<Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
							))}
						</div>
						<p className="text-slate-300 italic mb-4">
							"Closed my first $32K assignment fee in 6 weeks. The AI negotiation handled 80% of my seller conversations."
						</p>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
								<span className="text-white text-sm font-medium">MJ</span>
							</div>
							<div>
								<p className="text-sm font-medium text-white">Marcus Johnson</p>
								<p className="text-xs text-slate-500">Wholesaler, Atlanta</p>
							</div>
							<div className="ml-auto text-right">
								<p className="text-lg font-bold text-emerald-400">$32K</p>
								<p className="text-xs text-slate-500">First Deal</p>
							</div>
						</div>
					</div>

					{/* Industry Fact */}
					<div className="mt-6 p-4 rounded-xl bg-[#3B82F6]/5 border border-[#3B82F6]/20">
						<p className="text-sm text-slate-300">
							<span className="font-semibold text-[#3B82F6]">Did you know?</span> Responding within 5 minutes makes you{" "}
							<span className="font-semibold text-white">7x more likely</span> to qualify the lead.
						</p>
						<p className="text-xs text-slate-500 mt-1">Source: InsideSales.com</p>
					</div>
				</div>
			</div>

			{/* Right side - Form */}
			<div className="flex-1 flex items-center justify-center p-4 lg:p-12">
				<div className="w-full max-w-md">
					{/* Mobile logo */}
					<div className="flex justify-center mb-8 lg:hidden">
						<Link href="/" className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
								<span className="text-white font-bold">DF</span>
							</div>
							<span className="text-xl font-semibold text-white">DealFlow AI</span>
						</Link>
					</div>

					{plan && (
						<div className="mb-6 text-center">
							<span className="inline-flex items-center gap-2 bg-[#3B82F6]/10 text-[#3B82F6] px-4 py-2 rounded-full text-sm font-medium">
								<CheckCircle className="h-4 w-4" />
								Selected: {plan.charAt(0).toUpperCase() + plan.slice(1)} Plan
							</span>
						</div>
					)}

					<form
						onSubmit={(e) => {
							void onSubmit(e);
						}}
						className="flex w-full flex-col gap-5 rounded-2xl border border-white/10 bg-[#1E293B]/80 backdrop-blur-sm p-8 shadow-2xl"
					>
						<div className="text-center mb-2">
							<h1 className="text-2xl font-bold text-white">Create your account</h1>
							<p className="text-slate-400 text-sm mt-1">Start your 14-day free trial</p>
						</div>

						<label className="flex flex-col gap-2">
							<span className="text-sm font-medium text-slate-300">Email</span>
							<input
								type="email"
								required
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] transition-colors"
								placeholder="you@example.com"
							/>
						</label>

						<label className="flex flex-col gap-2">
							<span className="text-sm font-medium text-slate-300">Password</span>
							<input
								type="password"
								required
								minLength={8}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] transition-colors"
								placeholder="Minimum 8 characters"
							/>
						</label>

						<label className="flex items-start gap-3 text-sm text-slate-400 cursor-pointer">
							<input
								type="checkbox"
								required
								checked={acceptedLegal}
								onChange={(e) => setAcceptedLegal(e.target.checked)}
								className="mt-1 rounded border-white/20 bg-white/5 text-[#3B82F6] focus:ring-[#3B82F6] focus:ring-offset-0 focus:ring-offset-transparent"
							/>
							<span>
								I agree to the{" "}
								<a href="/legal/terms" target="_blank" className="text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
									Terms of Service
								</a>{" "}
								and{" "}
								<a href="/legal/privacy" target="_blank" className="text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
									Privacy Policy
								</a>
							</span>
						</label>

						{error && (
							<div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
								{error}
							</div>
						)}

						<button
							type="submit"
							disabled={loading || !acceptedLegal}
							className="rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-4 py-3 text-base font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
						>
							{loading ? "Creating account..." : "Start Free Trial"}
						</button>

						<div className="relative my-2">
							<div className="absolute inset-0 flex items-center">
								<div className="w-full border-t border-white/10" />
							</div>
							<div className="relative flex justify-center text-sm">
								<span className="bg-[#1E293B] px-4 text-slate-500">or continue with</span>
							</div>
						</div>

						<SocialSignInButtons callbackUrl={callbackUrl} />

						<p className="text-center text-sm text-slate-500">
							Already have an account?{" "}
							<a
								href={`/account/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
								className="text-[#3B82F6] hover:text-[#60A5FA] font-medium transition-colors"
							>
								Sign in
							</a>
						</p>
					</form>

					<p className="mt-6 text-center text-xs text-slate-600">
						No credit card required. Cancel anytime.
					</p>
				</div>
			</div>
		</main>
	);
}

export default function SignUpPage() {
	return (
		<Suspense>
			<SignUpForm />
		</Suspense>
	);
}
