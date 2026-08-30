'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import BetaFlagsCard from '@/components/settings/BetaFlagsCard';
import EventLogPanel from '@/components/EventLogPanel';

type Tile = { status: 'green' | 'amber' | 'red'; [k: string]: unknown };
type Dashboard = { overall: string; tiles: Record<string, Tile>; timestamp: string };

const services = [
  {
    id: 'db',
    name: 'Database',
    provider: 'Neon',
    description: 'Stores all leads, campaigns, and messages',
  },
  {
    id: 'ai',
    name: 'AI Engine',
    provider: 'Claude',
    description: 'Powers message generation and lead analysis',
  },
  {
    id: 'sms',
    name: 'SMS Gateway',
    provider: 'AWS SNS',
    description: 'Sends and receives text messages',
  },
  {
    id: 'voice',
    name: 'Voice Driver',
    provider: 'Twilio',
    description: 'Handles phone calls and voice escalation',
  },
  {
    id: 'jobs',
    name: 'Job Queue',
    provider: 'Internal',
    description: 'Processes background tasks and scheduled work',
  },
  {
    id: 'worker',
    name: 'Worker',
    provider: 'Internal',
    description: 'Executes queued jobs and maintains task flow',
  },
  {
    id: 'numberPool',
    name: 'Number Pool',
    provider: 'Twilio',
    description: 'Manages phone numbers for outbound messaging',
  },
  {
    id: 'quietHours',
    name: 'Quiet Hours',
    provider: 'System',
    description: 'Controls messaging windows for compliance',
  },
];

const getStatusFromTile = (status: string): 'success' | 'warning' | 'error' => {
  if (status === 'green') return 'success';
  if (status === 'amber') return 'warning';
  return 'error';
};

const getStatusLabel = (status: string) => {
  if (status === 'green') return 'Operational';
  if (status === 'amber') return 'Degraded';
  return 'Down';
};

const renderTileMetrics = (key: string, tile: Tile): Record<string, string> => {
  switch (key) {
    case 'db':
      return tile.error ? { error: String(tile.error) } : { latency: `${tile.latencyMs}ms` };
    case 'jobs':
      return tile.error ? { error: String(tile.error) } : {
        due: String(tile.due),
        'oldest lag': `${tile.oldestLagSec}s`,
        'open jobs': String(tile.openTotal),
      };
    case 'worker':
      return { mode: String(tile.mode), poll: `${tile.pollIntervalMs}ms` };
    case 'ai':
      return { provider: String(tile.provider), p95: tile.replyP95Ms != null ? `${tile.replyP95Ms}ms` : 'N/A' };
    case 'sms':
      return { mode: String(tile.mode) };
    case 'voice':
      return { driver: String(tile.driver), escalation: tile.escalationEnabled ? 'ON' : 'OFF' };
    case 'quietHours':
      return { status: tile.withinSendWindow ? 'In window' : 'Outside window', window: String(tile.windowLabel) };
    case 'numberPool':
      return tile.error ? { error: String(tile.error) } : {
        numbers: String(tile.numbers),
        capped: String(tile.capped),
        'rotation cap': String(tile.rotationCap),
      };
    default:
      return {};
  }
};

export default function SystemHealthPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [expandedService, setExpandedService] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery<Dashboard>({
    queryKey: ['system-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/system/dashboard');
      if (!res.ok) throw new Error('Failed to fetch dashboard');
      return res.json();
    },
    enabled: !!session,
    refetchInterval: 30000,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const overallHealthy = data?.overall === 'green';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">System Health</h1>
          <p className="text-[var(--text-secondary)] mt-1">Monitor service status and performance</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Overall Status */}
      <GlassCard className="flex items-center gap-4">
        <StatusDot status={overallHealthy ? 'success' : 'warning'} size="lg" />
        <div>
          <p className="text-lg font-semibold text-[var(--text-primary)]">
            {overallHealthy ? 'All systems operational' : 'Some systems degraded'}
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Last checked: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : 'Loading...'}
          </p>
        </div>
      </GlassCard>

      {/* Services Grid */}
      <GlassCard padding="none">
        {isLoading && !data ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {services.map((service) => {
              const tile = data?.tiles?.[service.id];
              const isExpanded = expandedService === service.id;
              const status = tile ? getStatusFromTile(tile.status) : 'neutral';
              const statusLabel = tile ? getStatusLabel(tile.status) : 'Unknown';
              const metrics = tile ? renderTileMetrics(service.id, tile) : {};

              return (
                <div key={service.id}>
                  <button
                    onClick={() => setExpandedService(isExpanded ? null : service.id)}
                    className="w-full px-6 py-4 flex items-center gap-4 hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <StatusDot status={status as any} />
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--text-primary)]">{service.name}</p>
                        <span className="text-xs text-[var(--text-muted)]">({service.provider})</span>
                      </div>
                      <p className="text-sm text-[var(--text-muted)]">{service.description}</p>
                    </div>
                    <span className={`text-sm ${status === 'success' ? 'text-[var(--color-success)]' : status === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--color-error)]'}`}>
                      {statusLabel}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isExpanded && Object.keys(metrics).length > 0 && (
                    <div className="px-6 py-4 bg-[var(--bg-tertiary)] border-t border-[var(--border-subtle)]">
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(metrics).map(([key, value]) => (
                          <div key={key}>
                            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                              {key.replace(/([A-Z])/g, ' $1').trim()}
                            </p>
                            <p className="text-lg font-mono text-[var(--text-primary)]">{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Beta Flags */}
      <BetaFlagsCard />

      {/* Event Log */}
      <EventLogPanel />

      {/* Incident History */}
      <GlassCard>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Recent Incidents</h3>
        <div className="flex items-center gap-3 py-8 justify-center">
          <StatusDot status="success" />
          <p className="text-sm text-[var(--text-muted)]">No incidents in the last 30 days</p>
        </div>
      </GlassCard>
    </div>
  );
}
