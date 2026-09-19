"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X, Sparkles, ChevronRight, Clock } from "lucide-react";

interface QuestionnaireReminderProps {
  variant?: "banner" | "card";
  className?: string;
}

/**
 * A reminder banner/card that shows on the dashboard if the user
 * hasn't completed the signup questionnaire. Can be dismissed.
 */
export function QuestionnaireReminder({
  variant = "banner",
  className = "",
}: QuestionnaireReminderProps) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if questionnaire is completed
    const checkQuestionnaire = async () => {
      try {
        const response = await fetch("/api/user/questionnaire");
        if (response.ok) {
          const data = await response.json();
          // Show reminder if not completed, not skipped, and reminder not dismissed
          if (!data.completed && !data.skipped && !data.reminderDismissed) {
            setVisible(true);
          }
        }
      } catch (error) {
        console.error("Error checking questionnaire status:", error);
      } finally {
        setLoading(false);
      }
    };

    checkQuestionnaire();
  }, []);

  const handleDismiss = async () => {
    setVisible(false);
    // Mark reminder as dismissed
    try {
      await fetch("/api/user/questionnaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissReminder: true }),
      });
    } catch (error) {
      console.error("Error dismissing reminder:", error);
    }
  };

  if (loading || !visible) {
    return null;
  }

  if (variant === "banner") {
    return (
      <div
        className={`relative overflow-hidden rounded-xl border border-[#3B82F6]/20 bg-gradient-to-r from-[#3B82F6]/10 via-[#8B5CF6]/10 to-[#3B82F6]/10 ${className}`}
      >
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#3B82F6]/5 via-[#8B5CF6]/5 to-[#3B82F6]/5 animate-pulse" />

        <div className="relative flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#3B82F6]/20">
              <Sparkles className="h-5 w-5 text-[#3B82F6]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Help us personalize your experience
              </p>
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Takes less than 2 minutes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/welcome"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] rounded-lg hover:opacity-90 transition-opacity"
            >
              Complete Questionnaire
              <ChevronRight className="h-4 w-4" />
            </Link>
            <button
              onClick={handleDismiss}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Card variant
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[#3B82F6]/20 bg-[var(--bg-secondary)] p-6 ${className}`}
    >
      {/* Close button */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 rounded-lg transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-[#3B82F6]/20 to-[#8B5CF6]/20">
          <Sparkles className="h-6 w-6 text-[#3B82F6]" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
            Complete Your Profile
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Answer a few quick questions so we can personalize your DealFlow
            experience and show you the most relevant features.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="/welcome"
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] rounded-lg hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/25"
            >
              <Sparkles className="h-4 w-4" />
              Start Questionnaire
            </Link>
            <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Under 2 min
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default QuestionnaireReminder;
