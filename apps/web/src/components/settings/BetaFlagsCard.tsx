'use client';

/**
 * Settings → Beta Integrations (MVP v2 — P1).
 * Four flags, persisted server-side in app_settings, toggled live (no restart).
 * Each flag change is written to the Event Log (audit_logs) by the API.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

const FLAG_META: Record<string, { label: string; blurb: string; danger?: string }> = {
  speedToLead: {
    label: 'Speed-to-Lead',
    blurb: 'Times every inbound reply → AI dispatch, with an ack-SMS fallback so a prospect never sits in silence.',
  },
  cadenceEngine: {
    label: 'Cadence Engine',
    blurb: 'Multi-step follow-up ladder (T+0 → T+60s → T+4h → D1/3/7/14) with send-window snapping.',
  },
  localPresence: {
    label: 'Local Presence',
    blurb: 'Picks a from-number matching the lead’s area code, with per-number rotation caps.',
  },
  voiceEscalation: {
    label: 'Voice Escalation',
    blurb: 'SMS → AI voice call double-tap, with voicemail drop on no-answer.',
    danger: 'Leave OFF until A2P/10DLC clears. Mock driver only — nothing dials live.',
  },
};

export default function BetaFlagsCard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ flags: Record<string, boolean>; keys: string[] }>({
    queryKey: ['beta-flags'],
    queryFn: async () => {
      const res = await fetch('/api/settings/beta-flags');
      if (!res.ok) throw new Error('Failed to load beta flags');
      return res.json();
    },
  });

  const toggle = useMutation({
    mutationFn: async (patch: Record<string, boolean>) => {
      const res = await fetch('/api/settings/beta-flags', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Toggle failed');
      return res.json();
    },
    onSuccess: (_d, patch) => {
      const [k, v] = Object.entries(patch)[0];
      toast.success(`${FLAG_META[k]?.label ?? k} ${v ? 'ON' : 'OFF'}`);
      qc.invalidateQueries({ queryKey: ['beta-flags'] });
      qc.invalidateQueries({ queryKey: ['event-log'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const flags = data?.flags ?? {};
  const keys = data?.keys ?? Object.keys(FLAG_META);

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" /> Beta Integrations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Manual testing: flip a flag → act → watch the Event Log</AlertTitle>
          <AlertDescription className="text-xs">
            Flags persist server-side and take effect live (no restart). A flag that is OFF produces
            zero events from its integration.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin opacity-30" /></div>
        ) : (
          <div className="space-y-3">
            {keys.map((k) => {
              const meta = FLAG_META[k] ?? { label: k, blurb: '' };
              const on = flags[k] === true;
              return (
                <div key={k} className="flex items-start justify-between gap-4 border rounded-lg p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{meta.label}</span>
                      <Badge variant="outline" className="text-[10px]">BETA</Badge>
                      {on && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">ON</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{meta.blurb}</p>
                    {meta.danger && <p className="text-xs text-amber-700 mt-1">⚠ {meta.danger}</p>}
                  </div>
                  <Switch
                    checked={on}
                    disabled={toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ [k]: v })}
                    aria-label={`Toggle ${meta.label}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
