'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
} from 'lucide-react';

interface PipelineStatus {
  isRunning: boolean;
  lastRun: {
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: string;
    stats: {
      leadIngestion?: { processed: number; errors: number };
      outreach?: { sent: number; deferred: number; suppressed: number };
      responses?: { classified: number; escalated: number };
      negotiations?: { advanced: number; walkAway: number };
      contracts?: { generated: number; sent: number };
      closings?: { completed: number };
    };
  } | null;
  pendingActions: {
    total: number;
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
  stageHealth: Array<{
    stage: string;
    status: 'healthy' | 'degraded' | 'error';
    errorRate: number;
  }>;
}

export function PipelineStatusCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['pipeline-status'],
    queryFn: async () => {
      const res = await fetch('/api/pipeline?include_config=false');
      if (!res.ok) throw new Error('Failed to fetch pipeline status');
      const json = await res.json();
      return json.status as PipelineStatus;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <GlassCard>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  if (!data) {
    return null;
  }

  const { pendingActions, stageHealth, lastRun, isRunning } = data;
  const healthyStages = stageHealth.filter((s) => s.status === 'healthy').length;
  const totalStages = stageHealth.length;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
          Pipeline Status
        </h3>
        {isRunning ? (
          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Running
          </Badge>
        ) : (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Idle
          </Badge>
        )}
      </div>

      {/* Health Summary */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-1">
          {stageHealth.map((stage) => (
            <div
              key={stage.stage}
              className={`h-2 w-8 rounded-full ${
                stage.status === 'healthy'
                  ? 'bg-green-500'
                  : stage.status === 'degraded'
                  ? 'bg-yellow-500'
                  : 'bg-red-500'
              }`}
              title={`${stage.stage}: ${stage.status}`}
            />
          ))}
        </div>
        <span className="text-sm text-[var(--text-muted)]">
          {healthyStages}/{totalStages} healthy
        </span>
      </div>

      {/* Pending Actions Summary */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[var(--text-muted)]" />
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {pendingActions.total}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Pending Actions</p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-error)]" />
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {pendingActions.urgent + pendingActions.high}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Need Attention</p>
        </div>
      </div>

      {/* Last Run Stats */}
      {lastRun && (
        <div className="border-t border-[var(--border-default)] pt-4 mb-4">
          <p className="text-xs text-[var(--text-muted)] mb-2">
            Last run: {new Date(lastRun.startedAt).toLocaleString()}
          </p>
          <div className="flex flex-wrap gap-2">
            {lastRun.stats.leadIngestion && (
              <Badge variant="outline" className="text-xs">
                {lastRun.stats.leadIngestion.processed} leads
              </Badge>
            )}
            {lastRun.stats.outreach && (
              <Badge variant="outline" className="text-xs">
                {lastRun.stats.outreach.sent} sent
              </Badge>
            )}
            {lastRun.stats.responses && (
              <Badge variant="outline" className="text-xs">
                {lastRun.stats.responses.classified} responses
              </Badge>
            )}
            {lastRun.stats.contracts && lastRun.stats.contracts.generated > 0 && (
              <Badge variant="outline" className="text-xs">
                {lastRun.stats.contracts.generated} contracts
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Action Link */}
      <Link href="/dashboard/actions">
        <Button variant="outline" className="w-full">
          <Activity className="h-4 w-4 mr-2" />
          View Action Queue
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Button>
      </Link>
    </GlassCard>
  );
}
