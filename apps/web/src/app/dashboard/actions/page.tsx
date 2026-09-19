'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquare,
  DollarSign,
  Loader2,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';

interface ActionItem {
  id: string;
  type: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  quickActions: Array<{ action: string; label: string; variant?: string }>;
  status: string;
  createdAt: string;
  dueAt: string | null;
  autoContinueAt: string | null;
}

interface PipelineStatus {
  isRunning: boolean;
  lastRun: {
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: string;
    stats: Record<string, unknown>;
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
    lastProcessed: string | null;
    errorRate: number;
  }>;
}

const priorityConfig = {
  URGENT: { color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: AlertTriangle },
  HIGH: { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', icon: AlertTriangle },
  NORMAL: { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: Clock },
  LOW: { color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400', icon: Clock },
};

const typeConfig: Record<string, { icon: typeof FileText; label: string }> = {
  REVIEW_DEAL: { icon: DollarSign, label: 'Deal Review' },
  APPROVE_CONTRACT: { icon: FileText, label: 'Contract Approval' },
  CONFIRM_CLOSING: { icon: CheckCircle2, label: 'Closing Confirmation' },
  REVIEW_RESPONSE: { icon: MessageSquare, label: 'Response Review' },
  ESCALATION: { icon: AlertTriangle, label: 'Escalation' },
  CAMPAIGN_SETUP: { icon: RefreshCw, label: 'Campaign Setup' },
  EXCEPTION: { icon: AlertTriangle, label: 'Exception' },
};

export default function ActionsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>('all');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['actions', filter],
    queryFn: async () => {
      const params = new URLSearchParams({
        include_status: 'true',
        limit: '50',
      });
      if (filter !== 'all') {
        params.set('priority', filter);
      }
      const res = await fetch(`/api/actions?${params}`);
      if (!res.ok) throw new Error('Failed to fetch actions');
      return res.json() as Promise<{
        items: ActionItem[];
        total: number;
        pipelineStatus: PipelineStatus;
      }>;
    },
    enabled: !!session,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const executeAction = useMutation({
    mutationFn: async ({ actionId, action, notes }: { actionId: string; action: string; notes?: string }) => {
      const res = await fetch(`/api/actions/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes }),
      });
      if (!res.ok) throw new Error('Failed to execute action');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
    },
  });

  const runPipeline = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedule' }),
      });
      if (!res.ok) throw new Error('Failed to run pipeline');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
    },
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const items = data?.items || [];
  const pipelineStatus = data?.pipelineStatus;

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              Action Queue
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Items requiring your attention
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              onClick={() => runPipeline.mutate()}
              disabled={runPipeline.isPending || pipelineStatus?.isRunning}
            >
              {runPipeline.isPending || pipelineStatus?.isRunning ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Run Pipeline
            </Button>
          </div>
        </header>

        {/* Pipeline Status */}
        {pipelineStatus && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="border-none shadow-sm">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {pipelineStatus.pendingActions.total}
                </div>
                <div className="text-sm text-gray-500">Total Actions</div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-red-600">
                  {pipelineStatus.pendingActions.urgent}
                </div>
                <div className="text-sm text-gray-500">Urgent</div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-orange-600">
                  {pipelineStatus.pendingActions.high}
                </div>
                <div className="text-sm text-gray-500">High Priority</div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-blue-600">
                  {pipelineStatus.pendingActions.normal}
                </div>
                <div className="text-sm text-gray-500">Normal</div>
              </CardContent>
            </Card>
            <Card className="border-none shadow-sm">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-gray-600">
                  {pipelineStatus.pendingActions.low}
                </div>
                <div className="text-sm text-gray-500">Low Priority</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Stage Health */}
        {pipelineStatus?.stageHealth && (
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Pipeline Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {pipelineStatus.stageHealth.map((stage) => (
                  <div
                    key={stage.stage}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 min-w-fit"
                  >
                    <div
                      className={`h-2 w-2 rounded-full ${
                        stage.status === 'healthy'
                          ? 'bg-green-500'
                          : stage.status === 'degraded'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`}
                    />
                    <span className="text-sm font-medium capitalize">
                      {stage.stage.replace(/_/g, ' ')}
                    </span>
                    <ArrowRight className="h-3 w-3 text-gray-400" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex gap-2">
          {['all', 'URGENT', 'HIGH', 'NORMAL', 'LOW'].map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>

        {/* Action Items */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : items.length === 0 ? (
            <Card className="border-none shadow-sm">
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  All caught up!
                </h3>
                <p className="text-gray-500 mt-1">
                  No actions require your attention right now.
                </p>
              </CardContent>
            </Card>
          ) : (
            items.map((item) => {
              const typeInfo = typeConfig[item.type] || { icon: Clock, label: item.type };
              const TypeIcon = typeInfo.icon;
              const priorityInfo = priorityConfig[item.priority];
              const PriorityIcon = priorityInfo.icon;

              return (
                <Card key={item.id} className="border-none shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                        <TypeIcon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                            {item.title}
                          </h3>
                          <Badge className={priorityInfo.color}>
                            <PriorityIcon className="h-3 w-3 mr-1" />
                            {item.priority}
                          </Badge>
                          <Badge variant="outline">{typeInfo.label}</Badge>
                        </div>
                        {item.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span>
                            Created {new Date(item.createdAt).toLocaleString()}
                          </span>
                          {item.autoContinueAt && (
                            <span className="text-orange-600">
                              Auto-continues {new Date(item.autoContinueAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Quick Actions */}
                      <div className="flex gap-2 flex-shrink-0">
                        {item.quickActions.map((qa) => (
                          <Button
                            key={qa.action}
                            variant={qa.variant === 'destructive' ? 'destructive' : 'outline'}
                            size="sm"
                            onClick={() =>
                              executeAction.mutate({
                                actionId: item.id,
                                action: qa.action,
                              })
                            }
                            disabled={executeAction.isPending}
                          >
                            {qa.label}
                          </Button>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            executeAction.mutate({
                              actionId: item.id,
                              action: 'skip',
                              notes: 'Skipped from dashboard',
                            })
                          }
                          disabled={executeAction.isPending}
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
