"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { SignupQuestionnaire } from "@/components/signup/SignupQuestionnaire";
import { Loader2 } from "lucide-react";

export default function WelcomePage() {
  const router = useRouter();
  const { data: session, isPending: authLoading } = useSession();
  const [checkingQuestionnaire, setCheckingQuestionnaire] = useState(true);
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    // If not authenticated, redirect to signin
    if (!session) {
      router.push("/account/signin?callbackUrl=/welcome");
      return;
    }

    // Check if questionnaire is already completed
    const checkQuestionnaire = async () => {
      try {
        const response = await fetch("/api/user/questionnaire");
        if (response.ok) {
          const data = await response.json();
          if (data.completed || data.skipped) {
            // Already completed or skipped, go to dashboard
            router.push("/dashboard");
            return;
          }
        }
        // Show questionnaire
        setShowQuestionnaire(true);
      } catch (error) {
        console.error("Error checking questionnaire:", error);
        // On error, still show questionnaire
        setShowQuestionnaire(true);
      } finally {
        setCheckingQuestionnaire(false);
      }
    };

    checkQuestionnaire();
  }, [authLoading, session, router]);

  // Loading state
  if (authLoading || checkingQuestionnaire) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#3B82F6] mx-auto mb-4" />
          <p className="text-slate-400">Setting up your experience...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - will redirect
  if (!session) {
    return null;
  }

  // Show questionnaire
  if (showQuestionnaire) {
    return (
      <SignupQuestionnaire
        redirectTo="/dashboard"
        onComplete={() => {
          router.push("/dashboard");
        }}
        onSkip={() => {
          router.push("/dashboard");
        }}
      />
    );
  }

  return null;
}
