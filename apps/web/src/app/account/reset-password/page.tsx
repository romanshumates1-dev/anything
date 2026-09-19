"use client";

import Link from "next/link";
import { type FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, AlertCircle, ArrowRight } from "lucide-react";

function ResetPasswordForm() {
	const searchParams = useSearchParams();
	const token = searchParams.get("token") || "";
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);

		if (password.length < 8) {
			setError("Password must be at least 8 characters");
			return;
		}

		if (password !== confirmPassword) {
			setError("Passwords do not match");
			return;
		}

		setLoading(true);

		try {
			const res = await fetch("/api/auth/reset-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token, password }),
			});

			if (!res.ok) {
				const data = await res.json();
				setError(data.error || "Failed to reset password");
				setLoading(false);
				return;
			}

			setSuccess(true);
		} catch {
			setError("Network error. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	if (!token) {
		return (
			<main className="flex min-h-screen w-full items-center justify-center bg-[#0F172A] p-4">
				{/* Background effects */}
				<div className="fixed inset-0 overflow-hidden pointer-events-none">
					<div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-[#3B82F6]/5 blur-3xl" />
					<div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-[#8B5CF6]/5 blur-3xl" />
				</div>

				<div className="relative w-full max-w-md">
					<div className="flex w-full flex-col gap-5 rounded-2xl border border-white/10 bg-[#1E293B]/80 backdrop-blur-sm p-8 shadow-2xl text-center">
						<div className="mx-auto w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-2">
							<AlertCircle className="h-8 w-8 text-red-400" />
						</div>
						<h1 className="text-2xl font-bold text-white">Invalid Link</h1>
						<p className="text-slate-400">
							This password reset link is invalid or has expired.
						</p>
						<a
							href="/account/forgot-password"
							className="text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
						>
							Request a new reset link
						</a>
					</div>
				</div>
			</main>
		);
	}

	if (success) {
		return (
			<main className="flex min-h-screen w-full items-center justify-center bg-[#0F172A] p-4">
				{/* Background effects */}
				<div className="fixed inset-0 overflow-hidden pointer-events-none">
					<div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-[#3B82F6]/5 blur-3xl" />
					<div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-[#8B5CF6]/5 blur-3xl" />
				</div>

				<div className="relative w-full max-w-md">
					<div className="flex w-full flex-col gap-5 rounded-2xl border border-white/10 bg-[#1E293B]/80 backdrop-blur-sm p-8 shadow-2xl text-center">
						<div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-2">
							<CheckCircle className="h-8 w-8 text-emerald-400" />
						</div>
						<h1 className="text-2xl font-bold text-white">Password Reset</h1>
						<p className="text-slate-400">
							Your password has been successfully reset. You can now sign in with your new password.
						</p>
						<a
							href="/account/signin"
							className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-4 py-3 text-base font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
						>
							Sign In
							<ArrowRight className="h-4 w-4" />
						</a>
					</div>
				</div>
			</main>
		);
	}

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
						<h1 className="text-2xl font-bold text-white">Set new password</h1>
						<p className="text-slate-400 text-sm mt-1">Choose a strong password with at least 8 characters</p>
					</div>

					<label className="flex flex-col gap-2">
						<span className="text-sm font-medium text-slate-300">New Password</span>
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

					<label className="flex flex-col gap-2">
						<span className="text-sm font-medium text-slate-300">Confirm Password</span>
						<input
							type="password"
							required
							minLength={8}
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] transition-colors"
							placeholder="Re-enter your password"
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
						{loading ? "Resetting..." : "Reset Password"}
					</button>
				</form>
			</div>
		</main>
	);
}

export default function ResetPasswordPage() {
	return (
		<Suspense>
			<ResetPasswordForm />
		</Suspense>
	);
}
