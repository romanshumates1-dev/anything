'use client';

/**
 * Phase H — System Health (admin). Aggregates every service tile from
 * /api/system/dashboard (single request/refresh), auto-refreshes every 10s,
 * and shows the beta-flags panel + Event Log tail. Each tile is green/amber/red
 * with thresholds documented in the dashboard route. A dead worker drives the
 * Jobs Queue tile red (oldest-lag climbs) within one refresh.
 */
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity } from 'lucide-react';
import BetaFlagsCard from '@/components/settings/BetaFlagsCard';
import EventLogPanel from '@/components/EventLogPanel';

const REFRESH_MS = 10_000;

type Tile = { status: 'green' | 'amber' | 'red'; [k: string]: unknown };
type Dashboard = { overall: string; tiles: Record<string, Tile>; timestamp: string };

const dot = (s: string) =>
  s === 'green' ? 'bg-emerald-500' : s === 'amber' ? 'bg-amber-500' : 'bg-red-500';
const ring = (s: string) =>
  s === 'green' ? 'border-emerald-500/30' : s === 'amber' ? 'border-amber-500/40' : 'border-red-500/50';

const TILE_META: Record<string, { label: string; link?: string; render: (t: Tile) => string }> = {
  db: { label: 'Database', render: (t) => (t.error ? String(t.error) : `${t.latencyMs}ms`) },
  jobs: {
    label: 'Jobs Queue',
    render: (t) => (t.error ? String(t.error) : `${t.due} due · oldest lag ${t.oldestLagSec}s · ${t.openTotal} open`),
  },
  worker: { label: 'Worker', render: (t) => `${t.mode} · poll ${t.pollIntervalMs}ms` },
  ai: { label: 'AI Provider', link: '/settings', render: (t) => `${t.provider}${t.replyP95Ms != null ? ` · P95 ${t.replyP95Ms}ms` : ' · no latency data'}` },
  sms: { label: 'SMS Driver', link: '/settings', render: (t) => String(t.mode) },
  voice: { label: 'Voice Driver', link: '/settings', render: (t) => `${t.driver} · escalation ${t.escalationEnabled ? 'ON' : 'off'}` },
  quietHours: { label: 'Quiet Hours', render: (t) => `${t.withinSendWindow ? 'in window' : 'outside window'} · ${t.windowLabel}` },
  numberPool: { label: 'Number Pool', link: '/settings', render: (t) => (t.error ? String(t.error) : `${t.numbers} numbers · ${t.capped} capped · cap ${t.rotationCap}`) },
};

export default function SystemHealthPage() {
  const { data: session, isPending } = useSession();

  const { data, isLoading, error, dataUpdatedAt } = useQuery<Dashboard>({
    queryKey: ['system-dashboard'],
    queryFn: async () => {
      const res = await fetch('/api/system/dashboard');
      if (!res.ok) throw new Error(`dashboard ${res.status}`);
      return res.json();
    },
    refetchInterval: REFRESH_MS,
    retry: false,
  });

  if (isPending) return <div className="p-8"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!session) return <div className="p-8 text-sm text-muted-foreground">Sign in required.</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Activity className="h-6 w-6" /> System Health
        </h1>
        <div className="flex items-center gap-2 text-sm">
          {data && (
            <>
              <span className={`h-3 w-3 rounded-full ${dot(data.overall)}`} />
              <span className="text-muted-foreground">
                overall {data.overall} · refreshes {REFRESH_MS / 1000}s · {new Date(dataUpdatedAt).toLocaleTimeString()}
              </span>
            </>
          )}
        </div>
      </header>

      {error && (
        <Card className="border-red-500/50"><CardContent className="p-4 text-sm text-red-600">
          Could not load system health: {(error as Error).message} (admin required)
        </CardContent></Card>
      )}

      {isLoading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading tiles…</div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="health-tiles">
          {Object.entries(TILE_META).map(([key, meta]) => {
            const tile = data.tiles[key];
            if (!tile) return null;
            return (
              <Card key={key} className={`border ${ring(tile.status)}`} data-testid={`tile-${key}`} data-status={tile.status}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm font-medium">
                    <span>{meta.label}</span>
                    <span className={`h-2.5 w-2.5 rounded-full ${dot(tile.status)}`} data-testid={`dot-${key}`} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground">{meta.render(tile)}</p>
                  {tile.status !== 'green' && meta.link && (
                    <a href={meta.link} className="mt-1 inline-block text-xs text-primary hover:underline">Open settings →</a>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      <BetaFlagsCard />
      <EventLogPanel />
    </div>
  );
}
