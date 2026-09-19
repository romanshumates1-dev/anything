'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Send,
  MessageSquare,
  Handshake,
  FileText,
  CheckCircle,
  ArrowRight,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface PipelineStats {
  leadIngestion: { processed: number; errors: number };
  outreach: { sent: number; deferred: number; suppressed: number };
  responses: { classified: number; escalated: number };
  negotiations: { advanced: number; walkAway: number };
  contracts: { generated: number; sent: number };
  closings: { completed: number };
}

interface StageHealth {
  stage: string;
  status: 'healthy' | 'degraded' | 'error';
  lastProcessed: string | null;
  errorRate: number;
}

const stages = [
  {
    id: 'leadIngestion',
    name: 'Lead Ingestion',
    icon: Users,
    color: 'blue',
    description: 'Import & score',
  },
  {
    id: 'outreach',
    name: 'Outreach',
    icon: Send,
    color: 'indigo',
    description: 'Messages sent',
  },
  {
    id: 'responses',
    name: 'Responses',
    icon: MessageSquare,
    color: 'purple',
    description: 'Classify & route',
  },
  {
    id: 'negotiations',
    name: 'Negotiations',
    icon: Handshake,
    color: 'orange',
    description: 'AI negotiation',
  },
  {
    id: 'contracts',
    name: 'Contracts',
    icon: FileText,
    color: 'yellow',
    description: 'Generate & send',
  },
  {
    id: 'closings',
    name: 'Closings',
    icon: CheckCircle,
    color: 'green',
    description: 'Complete deals',
  },
];

const colorMap: Record<string, string> = {
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
};

const lightColorMap: Record<string, string> = {
  blue: 'bg-blue-100 dark:bg-blue-900/30',
  indigo: 'bg-indigo-100 dark:bg-indigo-900/30',
  purple: 'bg-purple-100 dark:bg-purple-900/30',
  orange: 'bg-orange-100 dark:bg-orange-900/30',
  yellow: 'bg-yellow-100 dark:bg-yellow-900/30',
  green: 'bg-green-100 dark:bg-green-900/30',
};

const textColorMap: Record<string, string> = {
  blue: 'text-blue-600 dark:text-blue-400',
  indigo: 'text-indigo-600 dark:text-indigo-400',
  purple: 'text-purple-600 dark:text-purple-400',
  orange: 'text-orange-600 dark:text-orange-400',
  yellow: 'text-yellow-600 dark:text-yellow-400',
  green: 'text-green-600 dark:text-green-400',
};

export function PipelineFlowVisualization() {
  const { data, isLoading } = useQuery({
    queryKey: ['pipeline-flow'],
    queryFn: async () => {
      const res = await fetch('/api/pipeline?include_config=false');
      if (!res.ok) throw new Error('Failed to fetch pipeline status');
      const json = await res.json();
      return json.status as {
        lastRun: { stats: PipelineStats } | null;
        stageHealth: StageHealth[];
      };
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  const stats = data?.lastRun?.stats;
  const health = data?.stageHealth || [];

  const getStageStats = (stageId: string): { primary: number; secondary?: number } => {
    if (!stats) return { primary: 0 };

    switch (stageId) {
      case 'leadIngestion':
        return { primary: stats.leadIngestion?.processed || 0, secondary: stats.leadIngestion?.errors };
      case 'outreach':
        return { primary: stats.outreach?.sent || 0, secondary: stats.outreach?.deferred };
      case 'responses':
        return { primary: stats.responses?.classified || 0, secondary: stats.responses?.escalated };
      case 'negotiations':
        return { primary: stats.negotiations?.advanced || 0, secondary: stats.negotiations?.walkAway };
      case 'contracts':
        return { primary: stats.contracts?.generated || 0, secondary: stats.contracts?.sent };
      case 'closings':
        return { primary: stats.closings?.completed || 0 };
      default:
        return { primary: 0 };
    }
  };

  const getStageHealth = (stageId: string): StageHealth | undefined => {
    const stageNameMap: Record<string, string> = {
      leadIngestion: 'lead_ingestion',
      outreach: 'outreach',
      responses: 'responses',
      negotiations: 'negotiations',
      contracts: 'contracts',
      closings: 'closings',
    };
    return health.find((h) => h.stage === stageNameMap[stageId]);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
        Pipeline Flow
      </h3>

      {/* Desktop: Horizontal Flow */}
      <div className="hidden lg:flex items-center justify-between gap-2">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const stageStats = getStageStats(stage.id);
          const stageHealth = getStageHealth(stage.id);
          const isDegraded = stageHealth?.status === 'degraded';
          const isError = stageHealth?.status === 'error';

          return (
            <div key={stage.id} className="flex items-center">
              <div className="flex flex-col items-center">
                {/* Stage Card */}
                <div
                  className={`
                    relative p-4 rounded-xl border-2 transition-all
                    ${isError
                      ? 'border-red-300 dark:border-red-600'
                      : isDegraded
                      ? 'border-yellow-300 dark:border-yellow-600'
                      : 'border-transparent'}
                    ${lightColorMap[stage.color]}
                  `}
                >
                  {/* Health Indicator */}
                  {(isError || isDegraded) && (
                    <div className="absolute -top-2 -right-2">
                      <AlertTriangle
                        className={`h-4 w-4 ${
                          isError ? 'text-red-500' : 'text-yellow-500'
                        }`}
                      />
                    </div>
                  )}

                  <div className={`p-3 rounded-lg ${colorMap[stage.color]} mb-2`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>

                  <div className="text-center">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white">
                      {stage.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {stage.description}
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="mt-2 text-center">
                    <span className={`text-2xl font-bold ${textColorMap[stage.color]}`}>
                      {stageStats.primary}
                    </span>
                    {stageStats.secondary !== undefined && stageStats.secondary > 0 && (
                      <span className="text-xs text-gray-500 ml-1">
                        ({stageStats.secondary})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Arrow */}
              {idx < stages.length - 1 && (
                <ArrowRight className="h-5 w-5 text-gray-300 dark:text-gray-600 mx-1 flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: Vertical Flow */}
      <div className="lg:hidden space-y-4">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const stageStats = getStageStats(stage.id);
          const stageHealth = getStageHealth(stage.id);
          const isHealthy = !stageHealth || stageHealth.status === 'healthy';

          return (
            <div key={stage.id}>
              <div
                className={`
                  flex items-center gap-4 p-4 rounded-xl
                  ${lightColorMap[stage.color]}
                `}
              >
                <div className={`p-3 rounded-lg ${colorMap[stage.color]}`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>

                <div className="flex-1">
                  <p className="font-semibold text-sm text-gray-900 dark:text-white">
                    {stage.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {stage.description}
                  </p>
                </div>

                <div className="text-right">
                  <span className={`text-xl font-bold ${textColorMap[stage.color]}`}>
                    {stageStats.primary}
                  </span>
                  {!isHealthy && (
                    <AlertTriangle className="h-4 w-4 text-yellow-500 inline ml-2" />
                  )}
                </div>
              </div>

              {idx < stages.length - 1 && (
                <div className="flex justify-center my-2">
                  <ArrowRight className="h-4 w-4 text-gray-300 dark:text-gray-600 rotate-90" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {stats && (
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">
              Total leads processed
            </span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {stats.leadIngestion?.processed || 0}
            </span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-gray-500 dark:text-gray-400">
              Conversion to contract
            </span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {stats.leadIngestion?.processed
                ? ((stats.contracts?.generated || 0) / stats.leadIngestion.processed * 100).toFixed(1)
                : 0}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
