/**
 * ANYTHING PLATFORM - DO NOT REWRITE THIS FILE
 *
 * Shipped v2 auth scaffolding. Same contract as signup/page.tsx: <form
 * onSubmit>, e.preventDefault(), and window.location.href redirect are all
 * load-bearing for the mobile WebView. DO NOT replace <form onSubmit> with
 * <button onClick> - that broke signin platform-wide in a prior AI rewrite.
 *
 *   Safe:   restyle, rewrite copy, add form fields.
 *   Unsafe: replacing <form>, removing preventDefault, bypassing
 *           authClient.signIn.email, changing the callbackUrl redirect.
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { SocialSignInButtons } from "@/components/SocialSignInButtons";
import { authClient } from "@/lib/auth-client";

function SignInForm() {
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("callbackUrl") || "/";
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		const { error: signInError } = await authClient.signIn.email({
			email,
			password,
		});

		if (signInError) {
			setError(signInError.message ?? "Sign in failed");
			setLoading(false);
			return;
		}

		if (typeof window !== "undefined") {
			window.location.href = callbackUrl;
		} else {
			console.warn(
				"signin: window is undefined; cannot redirect to callbackUrl",
			);
		}
	};

	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-[#0F172A] p-4">
			{/* Background effects */}
			<div className="fixed inset-0 overflow-hidden pointer-events-none">
				<div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-[#3B82F6]/5 blur-3xl" />
				<div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-[#8B5CF6]/5 blur-3xl" />
			</div>

			<div className="relative w-full max-w-md">
				{/* Logo */}
				<div className="flex justify-center mb-8">
					<Link href="/" className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
							<span className="text-white font-bold">DF</span>
						</div>
						<span className="text-xl font-semibold text-white">DealFlow AI</span>
					</Link>
				</div>

				<form
					onSubmit={(e) => {
						void onSubmit(e);
					}}
					className="flex w-full flex-col gap-5 rounded-2xl border border-white/10 bg-[#1E293B]/80 backdrop-blur-sm p-8 shadow-2xl"
				>
					<div className="text-center mb-2">
						<h1 className="text-2xl font-bold text-white">Welcome back</h1>
						<p className="text-slate-400 text-sm mt-1">Sign in to your account</p>
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
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] transition-colors"
							placeholder="Enter your password"
						/>
					</label>

					{error && (
						<div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
							{error}
						</div>
					)}

					<button
						type="submit"
						disabled={loading}
						className="rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-4 py-3 text-base font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
					>
						{loading ? "Signing in..." : "Sign In"}
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

					<div className="flex flex-col gap-3 text-center text-sm">
						<a
							href={`/account/forgot-password?callbackUrl=${encodeURIComponent(callbackUrl)}`}
							className="text-slate-400 hover:text-white transition-colors"
						>
							Forgot password?
						</a>
						<p className="text-slate-500">
							No account?{" "}
							<a
								href={`/account/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}
								className="text-[#3B82F6] hover:text-[#60A5FA] font-medium transition-colors"
							>
								Sign up
							</a>
						</p>
					</div>
				</form>

				<p className="mt-6 text-center text-xs text-slate-600">
					By signing in, you agree to our{" "}
					<Link href="/legal/terms" className="text-slate-500 hover:text-white transition-colors">
						Terms of Service
					</Link>{" "}
					and{" "}
					<Link href="/legal/privacy" className="text-slate-500 hover:text-white transition-colors">
						Privacy Policy
					</Link>
				</p>
			</div>
		</main>
	);
}

export default function SignInPage() {
	return (
		<Suspense>
			<SignInForm />
		</Suspense>
	);
}
