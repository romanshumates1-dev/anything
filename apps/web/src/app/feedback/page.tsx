"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FeedbackModal } from "@/components/feedback/FeedbackModal";
import {
  Bug,
  Lightbulb,
  MessageCircle,
  Heart,
  ChevronUp,
  Clock,
  CheckCircle2,
  Circle,
  Loader2,
  Filter,
  Plus,
  TrendingUp,
  Calendar,
  MessageSquare,
  ExternalLink,
} from "lucide-react";

interface FeedbackItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: string;
  vote_count: number;
  user_voted: boolean;
  author_name: string | null;
  author_id: string | null;
  response_count: number;
  created_at: string;
  updated_at: string;
  is_anonymous: boolean;
}

const CATEGORIES = [
  { value: "all", label: "All", icon: Filter },
  { value: "BUG", label: "Bugs", icon: Bug, color: "text-red-500" },
  { value: "FEATURE", label: "Features", icon: Lightbulb, color: "text-yellow-500" },
  { value: "GENERAL", label: "General", icon: MessageCircle, color: "text-blue-500" },
  { value: "PRAISE", label: "Praise", icon: Heart, color: "text-pink-500" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Circle }> = {
  SUBMITTED: { label: "Submitted", color: "bg-gray-500", icon: Circle },
  UNDER_REVIEW: { label: "Under Review", color: "bg-blue-500", icon: Clock },
  PLANNED: { label: "Planned", color: "bg-purple-500", icon: Calendar },
  IN_PROGRESS: { label: "In Progress", color: "bg-yellow-500", icon: TrendingUp },
  COMPLETED: { label: "Completed", color: "bg-green-500", icon: CheckCircle2 },
};

const ROADMAP_STATUSES = ["PLANNED", "IN_PROGRESS", "COMPLETED"];

function getCategoryIcon(category: string) {
  const cat = CATEGORIES.find((c) => c.value === category);
  return cat?.icon || MessageCircle;
}

function getCategoryColor(category: string) {
  const cat = CATEGORIES.find((c) => c.value === category);
  return cat?.color || "text-[var(--text-muted)]";
}

function FeedbackCard({
  item,
  onVote,
  isVoting,
}: {
  item: FeedbackItem;
  onVote: (id: string) => void;
  isVoting: boolean;
}) {
  const Icon = getCategoryIcon(item.category);
  const statusConfig = STATUS_CONFIG[item.status];
  const StatusIcon = statusConfig?.icon || Circle;

  return (
    <GlassCard className="group hover:border-[var(--border-medium)] transition-all">
      <div className="flex gap-4">
        {/* Vote Button */}
        <div className="flex flex-col items-center">
          <button
            onClick={() => onVote(item.id)}
            disabled={isVoting}
            className={`flex flex-col items-center p-2 rounded-lg transition-all ${
              item.user_voted
                ? "bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]"
                : "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
            }`}
          >
            <ChevronUp className={`h-5 w-5 ${item.user_voted ? "" : "opacity-60"}`} />
            <span className="text-sm font-medium">{item.vote_count}</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon className={`h-4 w-4 ${getCategoryColor(item.category)}`} />
              <h3 className="font-medium text-[var(--text-primary)] line-clamp-1">
                {item.title}
              </h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {statusConfig && (
                <Badge
                  variant="secondary"
                  className={`${statusConfig.color} text-white text-xs`}
                >
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {statusConfig.label}
                </Badge>
              )}
            </div>
          </div>

          <p className="text-sm text-[var(--text-secondary)] line-clamp-2 mb-3">
            {item.description}
          </p>

          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <span>
              {item.is_anonymous || !item.author_name
                ? "Anonymous"
                : item.author_name}
            </span>
            <span>{new Date(item.created_at).toLocaleDateString()}</span>
            {item.response_count > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {item.response_count} response{item.response_count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function RoadmapColumn({ status, items, onVote, votingId }: {
  status: string;
  items: FeedbackItem[];
  onVote: (id: string) => void;
  votingId: string | null;
}) {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config?.icon || Circle;

  return (
    <div className="flex-1 min-w-[300px]">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--border-subtle)]">
        <div className={`w-2 h-2 rounded-full ${config?.color}`} />
        <h3 className="font-semibold text-[var(--text-primary)]">{config?.label}</h3>
        <Badge variant="secondary" className="text-xs">
          {items.length}
        </Badge>
      </div>
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">
            No items yet
          </p>
        ) : (
          items.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              onVote={onVote}
              isVoting={votingId === item.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function FeedbackPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [tab, setTab] = useState<"feedback" | "roadmap">("feedback");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState<"votes" | "newest">("votes");
  const [votingId, setVotingId] = useState<string | null>(null);

  const { data: feedbackData, isLoading } = useQuery({
    queryKey: ["feedback", category, sort],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      params.set("sort", sort);
      params.set("limit", "100");

      const res = await fetch(`/api/feedback?${params}`);
      if (!res.ok) throw new Error("Failed to fetch feedback");
      return res.json();
    },
  });

  const voteMutation = useMutation({
    mutationFn: async (feedbackId: string) => {
      setVotingId(feedbackId);
      const res = await fetch(`/api/feedback/${feedbackId}/vote`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to vote");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feedback"] });
    },
    onSettled: () => {
      setVotingId(null);
    },
  });

  const items: FeedbackItem[] = feedbackData?.items || [];
  const roadmapItems = items.filter((item) =>
    ROADMAP_STATUSES.includes(item.status) && item.category === "FEATURE"
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Feedback & Roadmap
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Help shape the future of DealFlow AI
          </p>
        </div>
        <Button
          onClick={() => setFeedbackOpen(true)}
          className="bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          Submit Feedback
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "feedback" | "roadmap")}>
        <TabsList>
          <TabsTrigger value="feedback">
            <MessageCircle className="h-4 w-4 mr-2" />
            Feedback
          </TabsTrigger>
          <TabsTrigger value="roadmap">
            <TrendingUp className="h-4 w-4 mr-2" />
            Roadmap
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feedback" className="mt-6">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            {/* Category Filter */}
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isSelected = category === cat.value;
                return (
                  <button
                    key={cat.value}
                    onClick={() => setCategory(cat.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all ${
                      isSelected
                        ? "bg-[var(--accent-blue)] text-white"
                        : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${isSelected ? "" : cat.color || ""}`} />
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Sort */}
            <div className="flex gap-2 sm:ml-auto">
              <button
                onClick={() => setSort("votes")}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  sort === "votes"
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Top Voted
              </button>
              <button
                onClick={() => setSort("newest")}
                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                  sort === "newest"
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Newest
              </button>
            </div>
          </div>

          {/* Feedback List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
            </div>
          ) : items.length === 0 ? (
            <GlassCard className="text-center py-12">
              <MessageCircle className="h-12 w-12 mx-auto text-[var(--text-muted)] mb-4" />
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                No feedback yet
              </h3>
              <p className="text-[var(--text-secondary)] mb-4">
                Be the first to share your thoughts!
              </p>
              <Button onClick={() => setFeedbackOpen(true)}>
                Submit Feedback
              </Button>
            </GlassCard>
          ) : (
            <div className="grid gap-4">
              {items.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  onVote={(id) => voteMutation.mutate(id)}
                  isVoting={votingId === item.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="roadmap" className="mt-6">
          {/* Roadmap Kanban View */}
          <div className="flex gap-6 overflow-x-auto pb-4">
            {ROADMAP_STATUSES.map((status) => (
              <RoadmapColumn
                key={status}
                status={status}
                items={roadmapItems.filter((item) => item.status === status)}
                onVote={(id) => voteMutation.mutate(id)}
                votingId={votingId}
              />
            ))}
          </div>

          {roadmapItems.length === 0 && !isLoading && (
            <GlassCard className="text-center py-12">
              <TrendingUp className="h-12 w-12 mx-auto text-[var(--text-muted)] mb-4" />
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                Roadmap coming soon
              </h3>
              <p className="text-[var(--text-secondary)]">
                Feature requests will appear here once they&apos;re planned.
              </p>
            </GlassCard>
          )}
        </TabsContent>
      </Tabs>

      {/* Feedback Modal */}
      <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
