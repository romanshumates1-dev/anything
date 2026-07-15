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
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5" /> Event Log
          <span className="text-xs font-normal text-gray-400">newest first · live</span>
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
              className={`text-xs rounded-full px-3 py-1 border ${
                integration === f.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin opacity-30" /></div>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            No events yet{integration ? ' for this integration' : ''}. Flip a beta flag and act — events land here.
          </p>
        ) : (
          <ul className="divide-y max-h-[420px] overflow-y-auto text-sm">
            {events.map((e) => (
              <li key={e.id} className="py-2 flex items-start gap-3">
                <span className="text-[11px] text-gray-400 shrink-0 w-[130px]">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px] font-mono">{e.action}</Badge>
                <span className="text-xs text-gray-600 min-w-0 break-all">
                  {e.targetType}:{e.targetId}
                  {e.payload && Object.keys(e.payload).length > 0 ? (
                    <span className="text-gray-400"> · {JSON.stringify(e.payload).slice(0, 160)}</span>
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
