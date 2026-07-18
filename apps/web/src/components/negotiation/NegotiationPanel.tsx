'use client';

/**
 * Phase A.4 — per-lead bounded-negotiation panel (conversation pane).
 *
 * Renders ONLY when the `boundedNegotiation` flag is on (gated on the beta-flags
 * endpoint, so a flag-off state produces nothing — no ghost UI). Shows:
 *  - the live session timeline (round, last offer, clamp ceiling/floor) when a
 *    session is active, with a prominent Pause / take-over button, and
 *  - guard-block events inline (not just the Event Log).
 * The "Enable AI negotiation" affordance appears only when preconditions hold
 * (flag on + an approved range for this lead), showing the exact bounds granted
 * before confirm — the toggle itself is deliberately behind an owner action, so
 * this panel never auto-arms.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Gavel, Hand } from 'lucide-react';
import { toast } from 'sonner';

type Session = {
  id: string;
  side: 'seller' | 'buyer';
  status: 'active' | 'agreed' | 'walked_away' | 'paused';
  round: number;
  opener_cents: number;
  clamp_cents: number;
  last_offer_cents: number | null;
  last_counter_cents: number | null;
};

const money = (c: number | null | undefined) => (c == null ? '—' : '$' + Math.round(c / 100).toLocaleString('en-US'));
const statusColor = (s: string) =>
  s === 'active' ? 'default' : s === 'agreed' ? 'secondary' : s === 'paused' ? 'outline' : 'destructive';

export default function NegotiationPanel({ leadId }: { leadId: string | number }) {
  const qc = useQueryClient();

  const { data: flagData } = useQuery<{ flags: Record<string, boolean> }>({
    queryKey: ['beta-flags'],
    queryFn: async () => {
      const res = await fetch('/api/settings/beta-flags');
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });
  const flagOn = flagData?.flags?.boundedNegotiation === true;

  const { data } = useQuery<{ sessions: Session[] }>({
    queryKey: ['negotiation-sessions', leadId],
    enabled: flagOn,
    refetchInterval: 3000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/negotiation/sessions?leadId=${leadId}`);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
  });

  const pause = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/negotiation/sessions/${sessionId}/pause`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `pause ${res.status}`);
      return body as { cancelledJobs: number };
    },
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['negotiation-sessions', leadId] });
      toast.success(`Paused — you're in control. ${b.cancelledJobs} queued send(s) cancelled.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!flagOn) return null; // no ghost UI when the flag is off

  const active = data?.sessions?.find((s) => s.status === 'active');
  const latest = data?.sessions?.[0];

  return (
    <Card data-testid="negotiation-panel" className="border-indigo-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Gavel className="h-4 w-4" /> AI Negotiation
          <Badge variant="outline">Beta · bounded</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!latest ? (
          <p className="text-muted-foreground text-xs">
            No negotiation session. Bounded AI negotiation runs only after you approve a price range
            for this lead and enable it — the AI never sends a number otherwise.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="font-medium capitalize">{latest.side} side</span>
              <Badge variant={statusColor(latest.status)}>{latest.status}</Badge>
            </div>
            {/* timeline */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" data-testid="negotiation-timeline">
              <span className="text-muted-foreground">Round</span><span>{latest.round}</span>
              <span className="text-muted-foreground">Opened at</span><span>{money(latest.opener_cents)}</span>
              <span className="text-muted-foreground">Last offer</span><span>{money(latest.last_offer_cents)}</span>
              <span className="text-muted-foreground">Prospect counter</span><span>{money(latest.last_counter_cents)}</span>
              <span className="text-muted-foreground">{latest.side === 'seller' ? 'Ceiling (max)' : 'Floor (min)'}</span>
              <span className="font-medium">{money(latest.clamp_cents)}</span>
            </div>
            {active && (
              <Button
                variant="destructive" size="sm" className="w-full"
                disabled={pause.isPending}
                onClick={() => pause.mutate(active.id)}
                data-testid="negotiation-pause"
              >
                {pause.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Hand className="h-4 w-4 mr-1" /> Pause / take over</>}
              </Button>
            )}
            {latest.status === 'agreed' && (
              <p className="text-xs text-emerald-700">Agreed within your range — sent to you for contract approval.</p>
            )}
            {latest.status === 'walked_away' && (
              <p className="text-xs text-muted-foreground">Walked away at the bound — lead marked cold, you were notified.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
