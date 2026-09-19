"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Eye,
  EyeOff,
  Send,
  Trash2,
  Copy,
  AlertTriangle,
  Search,
  Calendar,
  TrendingUp,
  XCircle,
  StickyNote,
  MessageSquare,
} from "lucide-react";

interface FeedbackItem {
  id: string;
  category: string;
  title: string;
  description: string;
  screenshot_url: string | null;
  priority: string;
  is_public: boolean;
  is_anonymous: boolean;
  status: string;
  vote_count: number;
  admin_notes: string | null;
  duplicate_of_id: string | null;
  author_name: string | null;
  author_id: string | null;
  user_id: string | null;
  response_count: number;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "BUG", label: "Bugs", icon: Bug, color: "text-red-500" },
  { value: "FEATURE", label: "Features", icon: Lightbulb, color: "text-yellow-500" },
  { value: "GENERAL", label: "General", icon: MessageCircle, color: "text-blue-500" },
  { value: "PRAISE", label: "Praise", icon: Heart, color: "text-pink-500" },
];

const STATUSES = [
  { value: "SUBMITTED", label: "Submitted", icon: Circle, color: "bg-gray-500" },
  { value: "UNDER_REVIEW", label: "Under Review", icon: Clock, color: "bg-blue-500" },
  { value: "PLANNED", label: "Planned", icon: Calendar, color: "bg-purple-500" },
  { value: "IN_PROGRESS", label: "In Progress", icon: TrendingUp, color: "bg-yellow-500" },
  { value: "COMPLETED", label: "Completed", icon: CheckCircle2, color: "bg-green-500" },
  { value: "DECLINED", label: "Declined", icon: XCircle, color: "bg-red-500" },
];

const PRIORITIES = [
  { value: "LOW", label: "Low", color: "text-gray-500" },
  { value: "MEDIUM", label: "Medium", color: "text-blue-500" },
  { value: "HIGH", label: "High", color: "text-orange-500" },
  { value: "URGENT", label: "Urgent", color: "text-red-500" },
];

function getCategoryIcon(category: string) {
  const cat = CATEGORIES.find((c) => c.value === category);
  return cat?.icon || MessageCircle;
}

function AdminFeedbackCard({
  item,
  onSelect,
  isSelected,
}: {
  item: FeedbackItem;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const Icon = getCategoryIcon(item.category);
  const statusConfig = STATUSES.find((s) => s.value === item.status);
  const priorityConfig = PRIORITIES.find((p) => p.value === item.priority);
  const StatusIcon = statusConfig?.icon || Circle;

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer transition-all glass-card p-6 ${
        isSelected
          ? "ring-2 ring-[var(--accent-blue)] border-[var(--accent-blue)]"
          : "hover:border-[var(--border-medium)]"
      }`}
    >
      <div className="flex gap-4">
        {/* Vote Count */}
        <div className="flex flex-col items-center text-center">
          <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {item.vote_count}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon className={`h-4 w-4 ${CATEGORIES.find((c) => c.value === item.category)?.color}`} />
              <h3 className="font-medium text-[var(--text-primary)] line-clamp-1">
                {item.title}
              </h3>
              {!item.is_public && (
                <EyeOff className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant="secondary"
                className={`${priorityConfig?.color} text-xs`}
              >
                {priorityConfig?.label}
              </Badge>
              <Badge
                variant="secondary"
                className={`${statusConfig?.color} text-white text-xs`}
              >
                <StatusIcon className="h-3 w-3 mr-1" />
                {statusConfig?.label}
              </Badge>
            </div>
          </div>

          <p className="text-sm text-[var(--text-secondary)] line-clamp-2 mb-2">
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
              <span className="flex items-center gap-1 text-[var(--accent-blue)]">
                <MessageSquare className="h-3 w-3" />
                {item.response_count}
              </span>
            )}
            {item.admin_notes && (
              <span className="flex items-center gap-1 text-[var(--accent-purple)]">
                <StickyNote className="h-3 w-3" />
                Has notes
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedbackDetailPanel({
  item,
  onClose,
  onUpdate,
}: {
  item: FeedbackItem;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(item.status);
  const [adminNotes, setAdminNotes] = useState(item.admin_notes || "");
  const [response, setResponse] = useState("");
  const [responsePublic, setResponsePublic] = useState(true);

  const updateMutation = useMutation({
    mutationFn: async (data: { status?: string; admin_notes?: string }) => {
      const res = await fetch(`/api/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
      onUpdate();
    },
  });

  const respondMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/feedback/${item.id}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response,
          is_public: responsePublic,
        }),
      });
      if (!res.ok) throw new Error("Failed to respond");
      return res.json();
    },
    onSuccess: () => {
      setResponse("");
      queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
      onUpdate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/feedback/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });
      onClose();
    },
  });

  const Icon = getCategoryIcon(item.category);
  const statusConfig = STATUSES.find((s) => s.value === item.status);

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-[var(--bg-secondary)] border-l border-[var(--border-subtle)] shadow-xl z-50 overflow-y-auto">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <Icon className={`h-5 w-5 ${CATEGORIES.find((c) => c.value === item.category)?.color}`} />
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                {item.title}
              </h2>
              <p className="text-sm text-[var(--text-muted)]">
                Submitted {new Date(item.created_at).toLocaleDateString()} by{" "}
                {item.author_name || "Anonymous"}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XCircle className="h-5 w-5" />
          </Button>
        </div>

        {/* Description */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">Description</h3>
          <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
            {item.description}
          </p>
        </div>

        {/* Status Update */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">Status</h3>
          <div className="flex gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => {
                  const SIcon = s.icon;
                  return (
                    <SelectItem key={s.value} value={s.value}>
                      <div className="flex items-center gap-2">
                        <SIcon className="h-4 w-4" />
                        {s.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button
              onClick={() => updateMutation.mutate({ status })}
              disabled={status === item.status || updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Update"
              )}
            </Button>
          </div>
        </div>

        {/* Admin Notes */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
            Admin Notes (internal)
          </h3>
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Add internal notes about this feedback..."
            className="mb-2"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateMutation.mutate({ admin_notes: adminNotes })}
            disabled={adminNotes === (item.admin_notes || "") || updateMutation.isPending}
          >
            Save Notes
          </Button>
        </div>

        {/* Response */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
            Add Response
          </h3>
          <Textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Write a response to this feedback..."
            className="mb-2"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={responsePublic}
                onChange={(e) => setResponsePublic(e.target.checked)}
                className="rounded"
              />
              Make response public
            </label>
            <Button
              onClick={() => respondMutation.mutate()}
              disabled={!response.trim() || respondMutation.isPending}
            >
              {respondMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Response
            </Button>
          </div>
        </div>

        {/* Metadata */}
        <div className="mb-6 p-4 rounded-lg bg-[var(--bg-tertiary)]">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-[var(--text-muted)]">Category:</span>{" "}
              <span className="text-[var(--text-secondary)]">{item.category}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Priority:</span>{" "}
              <span className="text-[var(--text-secondary)]">{item.priority}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Votes:</span>{" "}
              <span className="text-[var(--text-secondary)]">{item.vote_count}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Responses:</span>{" "}
              <span className="text-[var(--text-secondary)]">{item.response_count}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Public:</span>{" "}
              <span className="text-[var(--text-secondary)]">{item.is_public ? "Yes" : "No"}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Anonymous:</span>{" "}
              <span className="text-[var(--text-secondary)]">{item.is_anonymous ? "Yes" : "No"}</span>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="pt-4 border-t border-[var(--border-subtle)]">
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm("Are you sure you want to delete this feedback?")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            Delete Feedback
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminFeedbackPage() {
  const { data: session, isPending: authLoading } = useSession();
  const userRole = (session?.user as { role?: string })?.role;

  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<FeedbackItem | null>(null);

  const { data: feedbackData, isLoading } = useQuery({
    queryKey: ["admin-feedback", category, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("limit", "200");

      const res = await fetch(`/api/feedback?${params}`);
      if (!res.ok) throw new Error("Failed to fetch feedback");
      return res.json();
    },
    enabled: userRole === "ADMIN",
  });

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session || userRole !== "ADMIN") {
    redirect("/dashboard");
  }

  const items: FeedbackItem[] = feedbackData?.items || [];
  const filteredItems = search
    ? items.filter(
        (item) =>
          item.title.toLowerCase().includes(search.toLowerCase()) ||
          item.description.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  // Stats
  const stats = {
    total: items.length,
    submitted: items.filter((i) => i.status === "SUBMITTED").length,
    inProgress: items.filter((i) => i.status === "IN_PROGRESS").length,
    completed: items.filter((i) => i.status === "COMPLETED").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Feedback Management
        </h1>
        <p className="text-[var(--text-secondary)] mt-1">
          Review and respond to user feedback
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassCard padding="sm">
          <div className="text-sm text-[var(--text-muted)]">Total</div>
          <div className="text-2xl font-bold text-[var(--text-primary)]">{stats.total}</div>
        </GlassCard>
        <GlassCard padding="sm">
          <div className="text-sm text-[var(--text-muted)]">Pending Review</div>
          <div className="text-2xl font-bold text-yellow-500">{stats.submitted}</div>
        </GlassCard>
        <GlassCard padding="sm">
          <div className="text-sm text-[var(--text-muted)]">In Progress</div>
          <div className="text-2xl font-bold text-blue-500">{stats.inProgress}</div>
        </GlassCard>
        <GlassCard padding="sm">
          <div className="text-sm text-[var(--text-muted)]">Completed</div>
          <div className="text-2xl font-bold text-green-500">{stats.completed}</div>
        </GlassCard>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search feedback..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--border-subtle)] bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:ring-2 focus:ring-[var(--accent-blue)]/20 outline-none"
          />
        </div>

        {/* Category Filter */}
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status Filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Feedback List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : filteredItems.length === 0 ? (
        <GlassCard className="text-center py-12">
          <MessageCircle className="h-12 w-12 mx-auto text-[var(--text-muted)] mb-4" />
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
            No feedback found
          </h3>
          <p className="text-[var(--text-secondary)]">
            Try adjusting your filters
          </p>
        </GlassCard>
      ) : (
        <div className="grid gap-4">
          {filteredItems.map((item) => (
            <AdminFeedbackCard
              key={item.id}
              item={item}
              onSelect={() => setSelectedItem(item)}
              isSelected={selectedItem?.id === item.id}
            />
          ))}
        </div>
      )}

      {/* Detail Panel */}
      {selectedItem && (
        <FeedbackDetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onUpdate={() => {
            // Refresh the selected item
            const updated = feedbackData?.items?.find(
              (i: FeedbackItem) => i.id === selectedItem.id
            );
            if (updated) setSelectedItem(updated);
          }}
        />
      )}
    </div>
  );
}
