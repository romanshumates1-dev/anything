'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Loader2,
  Users,
  Send,
  MessageSquare,
  Handshake,
  FileText,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Target,
} from 'lucide-react';

interface FunnelStage {
  id: string;
  label: string;
  count: number;
  color: string;
  icon: React.ElementType;
  trend?: number;
}

/**
 * LeadFunnelVisualization - Visual funnel showing lead progression
 *
 * Displays conversion rates at each stage to give wholesalers
 * a clear picture of their pipeline health and bottlenecks.
 */
export function LeadFunnelVisualization() {
  const { data, isLoading } = useQuery({
    queryKey: ['funnel-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/funnel');
      if (!res.ok) {
        // Return mock data if endpoint not available
        return {
          stages: [
            { id: 'leads', count: 847, trend: 12 },
            { id: 'contacted', count: 623, trend: 8 },
            { id: 'responded', count: 198, trend: 15 },
            { id: 'negotiating', count: 45, trend: 5 },
            { id: 'contract', count: 18, trend: 20 },
            { id: 'closed', count: 12, trend: 50 },
          ],
          avgDealValue: 8500,
          projectedRevenue: 102000,
        };
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const stageConfig: Omit<FunnelStage, 'count'>[] = [
    { id: 'leads', label: 'Total Leads', color: 'from-blue-500 to-blue-600', icon: Users },
    { id: 'contacted', label: 'Contacted', color: 'from-indigo-500 to-indigo-600', icon: Send },
    { id: 'responded', label: 'Responded', color: 'from-purple-500 to-purple-600', icon: MessageSquare },
    { id: 'negotiating', label: 'Negotiating', color: 'from-orange-500 to-orange-600', icon: Handshake },
    { id: 'contract', label: 'Under Contract', color: 'from-yellow-500 to-yellow-600', icon: FileText },
    { id: 'closed', label: 'Closed', color: 'from-green-500 to-green-600', icon: CheckCircle },
  ];

  if (isLoading) {
    return (
      <GlassCard>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  const stages = stageConfig.map((stage, index) => {
    const stageData = data?.stages?.find((s: { id: string; count: number; trend?: number }) => s.id === stage.id);
    const count = stageData?.count ?? 0;
    const trend = stageData?.trend ?? 0;
    const prevCount = index > 0
      ? (data?.stages?.find((s: { id: string; count: number }) => s.id === stageConfig[index - 1].id)?.count ?? 0)
      : count;
    const conversionRate = prevCount > 0 ? ((count / prevCount) * 100).toFixed(0) : '0';

    return {
      ...stage,
      count,
      trend,
      conversionRate: index > 0 ? conversionRate : null,
    };
  });

  const maxCount = Math.max(...stages.map(s => s.count), 1);

  const avgDealValue = data?.avgDealValue || 8500;
  const projectedRevenue = data?.projectedRevenue || (stages[stages.length - 1]?.count || 0) * avgDealValue;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-[var(--accent-blue)]" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Lead Funnel</h3>
        </div>
        <Link
          href="/crm"
          className="text-xs text-[var(--accent-blue)] hover:underline flex items-center gap-1"
        >
          View CRM
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="space-y-3">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const widthPercent = Math.max((stage.count / maxCount) * 100, 15);
          const isPositiveTrend = stage.trend > 0;
          const isNegativeTrend = stage.trend < 0;

          return (
            <div key={stage.id} className="relative group">
              {/* Conversion rate indicator */}
              {stage.conversionRate && (
                <div className="absolute -top-1 right-0 text-[10px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                  {stage.conversionRate}% conversion
                </div>
              )}

              <div className="flex items-center gap-3">
                {/* Icon */}
                <div className={`p-2 rounded-lg bg-gradient-to-br ${stage.color} flex-shrink-0 shadow-sm`}>
                  <Icon className="h-4 w-4 text-white" />
                </div>

                {/* Bar */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[var(--text-secondary)]">{stage.label}</span>
                    <div className="flex items-center gap-2">
                      {stage.trend !== 0 && (
                        <span
                          className={`flex items-center gap-0.5 text-[10px] font-medium ${
                            isPositiveTrend
                              ? 'text-[var(--color-success)]'
                              : isNegativeTrend
                              ? 'text-[var(--color-error)]'
                              : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {isPositiveTrend && <TrendingUp className="h-3 w-3" />}
                          {isNegativeTrend && <TrendingDown className="h-3 w-3" />}
                          {isPositiveTrend && '+'}
                          {stage.trend}%
                        </span>
                      )}
                      <span className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                        {stage.count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${stage.color} rounded-full transition-all duration-700 ease-out`}
                      style={{ width: `${widthPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Connector line with animated flow */}
              {index < stages.length - 1 && (
                <div className="ml-5 h-3 flex items-center">
                  <div className="border-l-2 border-dashed border-[var(--border-subtle)] h-full" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary stats - enhanced */}
      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-[var(--text-muted)]">Conversion</p>
          <p className="text-lg font-semibold text-[var(--color-success)]">
            {stages[0].count > 0
              ? ((stages[stages.length - 1].count / stages[0].count) * 100).toFixed(1)
              : '0'}%
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Avg. Deal</p>
          <p className="text-lg font-semibold text-[var(--text-primary)]">
            ${avgDealValue.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-muted)]">Projected</p>
          <p className="text-lg font-semibold text-[var(--accent-blue)]">
            ${projectedRevenue.toLocaleString()}
          </p>
        </div>
      </div>
    </GlassCard>
  );
}
