"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  TrendingUp,
  Target,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  RefreshCw,
  Loader2,
  BarChart3,
  PieChart,
  Megaphone,
  DollarSign,
  Wrench,
  MessageSquare,
} from "lucide-react";

// Chart color palette
const CHART_COLORS = [
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#06B6D4", // cyan
  "#EC4899", // pink
  "#84CC16", // lime
];

// Label mappings for better display
const LABEL_MAPS: Record<string, Record<string, string>> = {
  experience: {
    BEGINNER: "Beginner",
    INTERMEDIATE: "Intermediate",
    ADVANCED: "Advanced",
    EXPERT: "Expert",
  },
  challenge: {
    lead_gen: "Lead Generation",
    follow_up: "Follow-up",
    closing: "Closing Deals",
    scaling: "Scaling",
    other: "Other",
  },
  source: {
    google: "Google Search",
    social: "Social Media",
    referral: "Referral",
    podcast: "Podcast",
    youtube: "YouTube",
    other: "Other",
  },
  budget: {
    bootstrap: "Bootstrapping",
    "50-200": "$50-200/mo",
    "200-500": "$200-500/mo",
    "500+": "$500+/mo",
  },
  teamSize: {
    solo: "Solo",
    "2-5": "2-5 people",
    "6-10": "6-10 people",
    "10+": "10+ people",
  },
  market: {
    residential: "Residential",
    commercial: "Commercial",
    land: "Land",
    mixed: "Mixed",
  },
};

interface DistributionItem {
  label: string;
  value: number;
}

interface AudienceData {
  stats: {
    totalResponses: number;
    completed: number;
    skipped: number;
    inProgress: number;
    completionRate: number;
  };
  distributions: {
    experience: DistributionItem[];
    dealsPerMonth: DistributionItem[];
    teamSize: DistributionItem[];
    market: DistributionItem[];
    challenge: DistributionItem[];
    source: DistributionItem[];
    budget: DistributionItem[];
    tools: DistributionItem[];
  };
  recentResponses: Array<{
    id: string;
    email: string;
    name: string | null;
    experienceLevel: string | null;
    dealsPerMonth: string | null;
    biggestChallenge: string | null;
    howHeardAboutUs: string | null;
    completedAt: string | null;
    createdAt: string;
  }>;
  completionTrend: Array<{
    date: string;
    total: number;
    completed: number;
  }>;
}

// Simple bar chart component
function HorizontalBarChart({
  data,
  labelMap,
  color = CHART_COLORS[0],
}: {
  data: DistributionItem[];
  labelMap?: Record<string, string>;
  color?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-[var(--text-muted)] text-center py-4">
        No data available
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value));

  return (
    <div className="space-y-3">
      {data.map((item, index) => {
        const percentage = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        const displayLabel = labelMap?.[item.label] || item.label;

        return (
          <div key={item.label || index} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-secondary)]">{displayLabel}</span>
              <span className="text-[var(--text-primary)] font-medium">
                {item.value}
              </span>
            </div>
            <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${percentage}%`,
                  backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Simple pie/donut visual (text-based)
function PieChartVisual({
  data,
  labelMap,
}: {
  data: DistributionItem[];
  labelMap?: Record<string, string>;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-[var(--text-muted)] text-center py-4">
        No data available
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-2">
      {data.map((item, index) => {
        const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
        const displayLabel = labelMap?.[item.label] || item.label;

        return (
          <div
            key={item.label || index}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span className="text-sm text-[var(--text-secondary)]">
                {displayLabel}
              </span>
            </div>
            <div className="text-right">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {item.value}
              </span>
              <span className="text-xs text-[var(--text-muted)] ml-2">
                ({percentage}%)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Stats card component
function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  trend,
  color = "blue",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  subValue?: string;
  trend?: string;
  color?: "blue" | "green" | "yellow" | "red" | "purple";
}) {
  const colorMap = {
    blue: "text-[#3B82F6] bg-[#3B82F6]/10",
    green: "text-[#10B981] bg-[#10B981]/10",
    yellow: "text-[#F59E0B] bg-[#F59E0B]/10",
    red: "text-[#EF4444] bg-[#EF4444]/10",
    purple: "text-[#8B5CF6] bg-[#8B5CF6]/10",
  };

  return (
    <GlassCard padding="md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--text-muted)]">{label}</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">
            {value}
          </p>
          {subValue && (
            <p className="text-xs text-[var(--text-muted)] mt-1">{subValue}</p>
          )}
          {trend && (
            <p className="text-xs text-[#10B981] mt-1 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {trend}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-xl ${colorMap[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </GlassCard>
  );
}

export default function AdminAudiencePage() {
  const { data: session, isPending: authLoading } = useSession();
  const userRole = (session?.user as { role?: string })?.role;

  const {
    data: audienceData,
    isLoading,
    refetch,
    isFetching,
  } = useQuery<AudienceData>({
    queryKey: ["admin-audience"],
    queryFn: async () => {
      const res = await fetch("/api/admin/audience");
      if (!res.ok) throw new Error("Failed to fetch audience data");
      return res.json();
    },
    enabled: userRole === "ADMIN",
    refetchInterval: 60000, // Refresh every minute
  });

  // Export data as CSV
  const handleExport = () => {
    if (!audienceData) return;

    const rows = audienceData.recentResponses.map((r) => ({
      email: r.email,
      name: r.name || "",
      experienceLevel: r.experienceLevel || "",
      dealsPerMonth: r.dealsPerMonth || "",
      biggestChallenge: r.biggestChallenge || "",
      howHeardAboutUs: r.howHeardAboutUs || "",
      status: r.completedAt ? "Completed" : "In Progress",
      createdAt: r.createdAt,
    }));

    const headers = Object.keys(rows[0] || {}).join(",");
    const csvContent = [
      headers,
      ...rows.map((r) =>
        Object.values(r)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audience-data-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

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

  const stats = audienceData?.stats;
  const distributions = audienceData?.distributions;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--accent-purple)]/10">
              <Users className="h-6 w-6 text-[var(--accent-purple)]" />
            </div>
            Audience Insights
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Questionnaire responses and user segmentation data
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!audienceData || isLoading}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard
              icon={Users}
              label="Total Responses"
              value={stats?.totalResponses || 0}
              color="blue"
            />
            <StatCard
              icon={CheckCircle2}
              label="Completed"
              value={stats?.completed || 0}
              subValue={`${stats?.completionRate || 0}% completion rate`}
              color="green"
            />
            <StatCard
              icon={XCircle}
              label="Skipped"
              value={stats?.skipped || 0}
              color="red"
            />
            <StatCard
              icon={Clock}
              label="In Progress"
              value={stats?.inProgress || 0}
              color="yellow"
            />
            <StatCard
              icon={Target}
              label="Completion Rate"
              value={`${stats?.completionRate || 0}%`}
              color="purple"
            />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Experience Level */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Experience Level
                </h3>
              </div>
              <HorizontalBarChart
                data={distributions?.experience || []}
                labelMap={LABEL_MAPS.experience}
              />
            </GlassCard>

            {/* Acquisition Source */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Megaphone className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  How They Found Us
                </h3>
              </div>
              <PieChartVisual
                data={distributions?.source || []}
                labelMap={LABEL_MAPS.source}
              />
            </GlassCard>

            {/* Biggest Challenge */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Biggest Challenges
                </h3>
              </div>
              <HorizontalBarChart
                data={distributions?.challenge || []}
                labelMap={LABEL_MAPS.challenge}
              />
            </GlassCard>

            {/* Budget Range */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Budget Range
                </h3>
              </div>
              <PieChartVisual
                data={distributions?.budget || []}
                labelMap={LABEL_MAPS.budget}
              />
            </GlassCard>

            {/* Team Size */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Team Size
                </h3>
              </div>
              <HorizontalBarChart
                data={distributions?.teamSize || []}
                labelMap={LABEL_MAPS.teamSize}
              />
            </GlassCard>

            {/* Deals per Month */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Deals per Month
                </h3>
              </div>
              <HorizontalBarChart data={distributions?.dealsPerMonth || []} />
            </GlassCard>

            {/* Primary Market */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <PieChart className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Primary Market
                </h3>
              </div>
              <PieChartVisual
                data={distributions?.market || []}
                labelMap={LABEL_MAPS.market}
              />
            </GlassCard>

            {/* Current Tools */}
            <GlassCard padding="lg">
              <div className="flex items-center gap-2 mb-4">
                <Wrench className="h-5 w-5 text-[var(--text-muted)]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  Current Tools Used
                </h3>
              </div>
              <HorizontalBarChart data={distributions?.tools || []} />
            </GlassCard>
          </div>

          {/* Recent Responses Table */}
          <GlassCard padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="h-5 w-5 text-[var(--text-muted)]" />
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                Recent Responses
              </h3>
            </div>

            {audienceData?.recentResponses &&
            audienceData.recentResponses.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="text-left py-3 px-2 text-[var(--text-muted)] font-medium">
                        User
                      </th>
                      <th className="text-left py-3 px-2 text-[var(--text-muted)] font-medium">
                        Experience
                      </th>
                      <th className="text-left py-3 px-2 text-[var(--text-muted)] font-medium">
                        Challenge
                      </th>
                      <th className="text-left py-3 px-2 text-[var(--text-muted)] font-medium">
                        Source
                      </th>
                      <th className="text-left py-3 px-2 text-[var(--text-muted)] font-medium">
                        Status
                      </th>
                      <th className="text-left py-3 px-2 text-[var(--text-muted)] font-medium">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {audienceData.recentResponses.map((response) => (
                      <tr
                        key={response.id}
                        className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]"
                      >
                        <td className="py-3 px-2">
                          <div>
                            <p className="text-[var(--text-primary)] font-medium">
                              {response.name || "Anonymous"}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {response.email}
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-[var(--text-secondary)]">
                          {LABEL_MAPS.experience[response.experienceLevel || ""] ||
                            response.experienceLevel ||
                            "-"}
                        </td>
                        <td className="py-3 px-2 text-[var(--text-secondary)]">
                          {LABEL_MAPS.challenge[response.biggestChallenge || ""] ||
                            response.biggestChallenge ||
                            "-"}
                        </td>
                        <td className="py-3 px-2 text-[var(--text-secondary)]">
                          {LABEL_MAPS.source[response.howHeardAboutUs || ""] ||
                            response.howHeardAboutUs ||
                            "-"}
                        </td>
                        <td className="py-3 px-2">
                          <Badge
                            variant="secondary"
                            className={
                              response.completedAt
                                ? "bg-[#10B981]/10 text-[#10B981]"
                                : "bg-[#F59E0B]/10 text-[#F59E0B]"
                            }
                          >
                            {response.completedAt ? "Completed" : "In Progress"}
                          </Badge>
                        </td>
                        <td className="py-3 px-2 text-[var(--text-muted)]">
                          {new Date(response.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-[var(--text-muted)]">
                No responses yet
              </div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
