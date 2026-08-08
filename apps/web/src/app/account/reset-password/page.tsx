"use client";

import { type FormEvent, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

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
			<main className="flex min-h-screen w-full items-center justify-center bg-gray-50 p-[16px]">
				<div className="flex w-full max-w-[400px] flex-col gap-[16px] rounded-[12px] bg-white p-[24px] shadow">
					<h1 className="text-[24px] font-semibold text-red-600">Invalid Link</h1>
					<p className="text-[14px] text-gray-600">
						This password reset link is invalid or has expired.
					</p>
					<a
						href="/account/forgot-password"
						className="text-center text-[14px] text-blue-600 hover:underline"
					>
						Request a new reset link
					</a>
				</div>
			</main>
		);
	}

	if (success) {
		return (
			<main className="flex min-h-screen w-full items-center justify-center bg-gray-50 p-[16px]">
				<div className="flex w-full max-w-[400px] flex-col gap-[16px] rounded-[12px] bg-white p-[24px] shadow">
					<h1 className="text-[24px] font-semibold text-green-600">Password Reset</h1>
					<p className="text-[14px] text-gray-600">
						Your password has been successfully reset. You can now sign in with your new password.
					</p>
					<a
						href="/account/signin"
						className="rounded-[8px] bg-blue-600 p-[12px] text-center text-[16px] font-medium text-white"
					>
						Sign In
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
				<h1 className="text-[24px] font-semibold">Set new password</h1>

				<label className="flex flex-col gap-[4px] text-[14px]">
					New Password
					<input
						type="password"
						required
						minLength={8}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						className="rounded-[8px] border border-gray-300 p-[10px] text-[16px] outline-none focus:border-blue-500"
					/>
				</label>

				<label className="flex flex-col gap-[4px] text-[14px]">
					Confirm Password
					<input
						type="password"
						required
						minLength={8}
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
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
					{loading ? "Resetting…" : "Reset Password"}
				</button>
			</form>
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
