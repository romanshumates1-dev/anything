"use client";

import React, { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { FeedbackModal } from "./FeedbackModal";

/**
 * Floating feedback button that appears on all pages.
 * Opens the feedback submission modal when clicked.
 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white font-medium shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
        aria-label="Send feedback"
      >
        <MessageSquarePlus className="h-5 w-5" />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      <FeedbackModal open={open} onOpenChange={setOpen} />
    </>
  );
}
