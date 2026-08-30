'use client';

/**
 * In-app Event Log (MVP v2 — P1). Newest first, filterable by integration.
 * Reads /api/system/event-log (audit_logs, phone-masked server-side) so manual
 * testing is: flip a beta flag → act → watch events here. No console-digging.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ScrollText, RefreshCw } from 'lucide-react';

interface EventRow {
  id: number;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'speedToLead', label: 'Speed-to-Lead' },
  { key: 'cadenceEngine', label: 'Cadence' },
  { key: 'localPresence', label: 'Local Presence' },
  { key: 'voiceEscalation', label: 'Voice' },
];

export default function EventLogPanel() {
  const [integration, setIntegration] = useState('');

  const { data, isLoading, isFetching, refetch } = useQuery<{ events: EventRow[] }>({
    queryKey: ['event-log', integration],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (integration) p.set('integration', integration);
      const res = await fetch(`/api/system/event-log?${p.toString()}`);
      if (!res.ok) return { events: [] };
      return res.json();
    },
    refetchInterval: 5000, // live-ish feed while manually testing
  });

  const events = data?.events ?? [];

  return (
    <Card className="border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
          <ScrollText className="h-5 w-5 text-[var(--text-secondary)]" /> Event Log
          <span className="text-xs font-normal text-[var(--text-muted)]">newest first · live</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setIntegration(f.key)}
              className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                integration === f.key
                  ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--text-muted)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" /></div>
        ) : events.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">
            No events yet{integration ? ' for this integration' : ''}. Flip a beta flag and act — events land here.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] max-h-[420px] overflow-y-auto text-sm">
            {events.map((e) => (
              <li key={e.id} className="py-2 flex items-start gap-3">
                <span className="text-[11px] text-[var(--text-muted)] shrink-0 w-[130px]">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px] font-mono border-[var(--border-subtle)] text-[var(--text-secondary)]">{e.action}</Badge>
                <span className="text-xs text-[var(--text-secondary)] min-w-0 break-all">
                  {e.targetType}:{e.targetId}
                  {e.payload && Object.keys(e.payload).length > 0 ? (
                    <span className="text-[var(--text-muted)]"> · {JSON.stringify(e.payload).slice(0, 160)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
