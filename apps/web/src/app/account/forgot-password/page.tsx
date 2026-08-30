"use client";

import { type FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function ForgotPasswordForm() {
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("callbackUrl") || "/";
	const [email, setEmail] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/auth/forgot-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});

			if (!res.ok) {
				const data = await res.json();
				setError(data.error || "Failed to send reset email");
				setLoading(false);
				return;
			}

			setSubmitted(true);
		} catch {
			setError("Network error. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	if (submitted) {
		return (
			<main className="flex min-h-screen w-full items-center justify-center bg-gray-50 p-[16px]">
				<div className="flex w-full max-w-[400px] flex-col gap-[16px] rounded-[12px] bg-white p-[24px] shadow">
					<h1 className="text-[24px] font-semibold">Check your email</h1>
					<p className="text-[14px] text-gray-600">
						If an account exists for <strong>{email}</strong>, we sent a password reset link.
						Check your inbox and spam folder.
					</p>
					<a
						href={`/account/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
						className="text-center text-[14px] text-blue-600 hover:underline"
					>
						Back to sign in
					</a>
				</div>
			</main>
		);
	}

	return (
		<main className="flex min-h-screen w-full items-center justify-center bg-gray-50 p-[16px]">
			<form
				onSubmit={(e) => {
					void onSubmit(e);
				}}
				className="flex w-full max-w-[400px] flex-col gap-[16px] rounded-[12px] bg-white p-[24px] shadow"
			>
				<h1 className="text-[24px] font-semibold">Reset password</h1>
				<p className="text-[14px] text-gray-600">
					Enter your email address and we'll send you a link to reset your password.
				</p>

				<label className="flex flex-col gap-[4px] text-[14px]">
					Email
					<input
						type="email"
						required
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						className="rounded-[8px] border border-gray-300 p-[10px] text-[16px] outline-none focus:border-blue-500"
					/>
				</label>

				{error && (
					<div className="rounded-[8px] bg-red-50 p-[10px] text-[14px] text-red-600">
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={loading}
					className="rounded-[8px] bg-blue-600 p-[12px] text-[16px] font-medium text-white disabled:opacity-50"
				>
					{loading ? "Sending…" : "Send Reset Link"}
				</button>

				<a
					href={`/account/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
					className="text-center text-[14px] text-blue-600 hover:underline"
				>
					Back to sign in
				</a>
			</form>
		</main>
	);
}

export default function ForgotPasswordPage() {
	return (
		<Suspense>
			<ForgotPasswordForm />
		</Suspense>
	);
}
