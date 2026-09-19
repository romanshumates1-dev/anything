"use client";

import React, { useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bug,
  Lightbulb,
  MessageCircle,
  Heart,
  AlertTriangle,
  Loader2,
  Check,
  Eye,
  EyeOff,
  Camera,
} from "lucide-react";

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORIES = [
  { value: "BUG", label: "Bug Report", icon: Bug, color: "text-red-500" },
  { value: "FEATURE", label: "Feature Request", icon: Lightbulb, color: "text-yellow-500" },
  { value: "GENERAL", label: "General Feedback", icon: MessageCircle, color: "text-blue-500" },
  { value: "PRAISE", label: "Praise", icon: Heart, color: "text-pink-500" },
];

const PRIORITIES = [
  { value: "LOW", label: "Low", description: "Nice to have" },
  { value: "MEDIUM", label: "Medium", description: "Would be helpful" },
  { value: "HIGH", label: "High", description: "Important for my workflow" },
  { value: "URGENT", label: "Urgent", description: "Blocking my work" },
];

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<string>("GENERAL");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [isPublic, setIsPublic] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async (data: {
      category: string;
      title: string;
      description: string;
      priority: string;
      is_public: boolean;
      is_anonymous: boolean;
      screenshot_url?: string | null;
    }) => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to submit feedback");
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
      setTimeout(() => {
        resetForm();
        onOpenChange(false);
      }, 2000);
    },
  });

  const resetForm = () => {
    setCategory("GENERAL");
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    setIsPublic(true);
    setIsAnonymous(false);
    setScreenshotUrl(null);
    setSuccess(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.mutate({
      category,
      title,
      description,
      priority,
      is_public: isPublic,
      is_anonymous: isAnonymous,
      screenshot_url: screenshotUrl,
    });
  };

  const selectedCategory = CATEGORIES.find((c) => c.value === category);

  if (!session) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Please sign in to submit feedback.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="default"
              onClick={() => (window.location.href = "/account/signin")}
            >
              Sign In
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (success) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-[var(--color-success)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              Thank you for your feedback!
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              We appreciate you taking the time to help us improve.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Help us improve by sharing your thoughts, reporting bugs, or requesting features.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Category Selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                Category
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = category === cat.value;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setCategory(cat.value)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                        isSelected
                          ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--text-primary)]"
                          : "border-[var(--border-subtle)] hover:border-[var(--border-medium)] text-[var(--text-secondary)]"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isSelected ? cat.color : ""}`} />
                      <span className="text-sm">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium text-[var(--text-primary)]">
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  category === "BUG"
                    ? "Brief description of the bug..."
                    : category === "FEATURE"
                    ? "What feature would you like?"
                    : "Summary of your feedback..."
                }
                className="w-full px-3 py-2 rounded-md border border-[var(--border-subtle)] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:ring-2 focus:ring-[var(--accent-blue)]/20 outline-none transition-all"
                required
                minLength={3}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium text-[var(--text-primary)]">
                Description
              </label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  category === "BUG"
                    ? "Steps to reproduce, expected vs actual behavior..."
                    : category === "FEATURE"
                    ? "Describe the feature and why it would be helpful..."
                    : "Share your thoughts in detail..."
                }
                className="min-h-[120px] resize-none"
                required
                minLength={10}
              />
            </div>

            {/* Priority (for bugs/features) */}
            {(category === "BUG" || category === "FEATURE") && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">
                  Priority
                </label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <div className="flex flex-col">
                          <span>{p.label}</span>
                          <span className="text-xs text-[var(--text-muted)]">{p.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Visibility Options */}
            <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isPublic ? (
                    <Eye className="h-4 w-4 text-[var(--text-muted)]" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-[var(--text-muted)]" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Public feedback
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Others can see and vote on this
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPublic(!isPublic)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isPublic ? "bg-[var(--accent-blue)]" : "bg-[var(--bg-tertiary)]"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isPublic ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {isPublic && (
                <div className="flex items-center justify-between ml-6">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Post anonymously
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Your name won&apos;t be shown publicly
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAnonymous(!isAnonymous)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      isAnonymous ? "bg-[var(--accent-blue)]" : "bg-[var(--bg-tertiary)]"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isAnonymous ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitMutation.isPending || !title || !description}
              className="bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Feedback"
              )}
            </Button>
          </DialogFooter>

          {submitMutation.isError && (
            <div className="mt-4 p-3 rounded-lg bg-[var(--color-error)]/10 border border-[var(--color-error)]/20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[var(--color-error)]" />
                <span className="text-sm text-[var(--color-error)]">
                  {submitMutation.error?.message || "Failed to submit feedback"}
                </span>
              </div>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
