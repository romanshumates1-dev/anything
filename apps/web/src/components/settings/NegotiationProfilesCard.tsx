'use client';

/**
 * Settings → Negotiation Profiles (Phase N — behind `negotiationProfiles` flag).
 * Lists profiles, and gives a LIVE formula preview against a sample property:
 * edit ARV/sqft/condition → watch the OWNER-suggested min/max + confidence +
 * "How was this calculated?" trace recompute. Banner makes the invariant plain:
 * these are suggestions the owner approves; the AI never sends a number.
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Scale, ChevronDown } from 'lucide-react';

type Profile = {
  id: string; name: string; segment: string | null; tone: string;
  arvMultiplier: number; minFee: number; feeTargetMax: number; openerPctOfMax: number;
  allowsColdOutbound: boolean; requiresManualComps: boolean; doubleCloseAdvisory: boolean;
};
type Valuation = {
  suggestMin: number | null; suggestMax: number | null; confidence: 'HIGH' | 'MED' | 'LOW';
  escalate: boolean; formulaTrace: string[];
};

const money = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US')}`);
const confColor = (c: string): 'default' | 'secondary' | 'destructive' =>
  c === 'HIGH' ? 'default' : c === 'MED' ? 'secondary' : 'destructive';

export default function NegotiationProfilesCard() {
  const [selected, setSelected] = useState<string>('standard_distressed');
  const [arv, setArv] = useState('200000');
  const [sqft, setSqft] = useState('1500');
  const [tier, setTier] = useState<'light' | 'moderate' | 'heavy'>('moderate');
  const [showTrace, setShowTrace] = useState(false);

  // Gate on the beta-flags endpoint (200 for admins regardless of flag values),
  // so a flag-OFF state produces NO profiles fetch and therefore no 403 console
  // noise and no flash of the card. Flag off ⇒ render nothing (pre-phase state).
  const { data: flagData } = useQuery<{ flags: Record<string, boolean> }>({
    queryKey: ['beta-flags'],
    queryFn: async () => {
      const res = await fetch('/api/settings/beta-flags');
      if (!res.ok) throw new Error(`flags ${res.status}`);
      return res.json();
    },
    retry: false,
  });
  const flagOn = flagData?.flags?.negotiationProfiles === true;

  const { data, isLoading } = useQuery<{ profiles: Profile[] }>({
    queryKey: ['negotiation-profiles'],
    enabled: flagOn, // only fetch profiles when the flag is on
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/negotiation/profiles');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `GET ${res.status}`);
      return res.json();
    },
  });

  const preview = useMutation({
    mutationFn: async (): Promise<Valuation> => {
      const res = await fetch('/api/negotiation/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: selected,
          inputs: { arv: Number(arv), sqft: Number(sqft), conditionTier: tier, hasAvm: true, compsCount: 4 },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `preview ${res.status}`);
      return body.valuation;
    },
  });

  // Flag off (or flags not yet known) → render nothing (matches pre-phase).
  if (!flagOn) return null;

  const profiles = data?.profiles ?? [];
  const active = profiles.find((p) => p.id === selected);

  return (
    <Card data-testid="negotiation-profiles-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          Negotiation Profiles
          <Badge variant="outline">Beta · Phase N</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>Suggested — you approve every range.</strong> Profiles tune what the system
          suggests to <em>you</em> and the AI&apos;s non-numeric tone. The AI never sends a price to a
          prospect; any price talk still routes to you for review.
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" data-testid="profile-pills">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p.id); preview.reset(); }}
                  className={`rounded-full border px-3 py-1 text-sm ${selected === p.id ? 'border-primary bg-primary/10 font-medium' : 'border-border'}`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {active && (
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="profile-params">
                <div><span className="text-muted-foreground">ARV ×</span> {active.arvMultiplier}</div>
                <div><span className="text-muted-foreground">Fee</span> {money(active.minFee)}–{money(active.feeTargetMax)}</div>
                <div><span className="text-muted-foreground">Opener</span> {Math.round(active.openerPctOfMax * 100)}%</div>
                <div><span className="text-muted-foreground">Tone</span> {active.tone}</div>
                {!active.allowsColdOutbound && <Badge variant="destructive">inbound/referral only</Badge>}
                {active.requiresManualComps && <Badge variant="secondary">manual comps</Badge>}
                {active.doubleCloseAdvisory && <Badge variant="secondary">double-close advisory</Badge>}
              </div>
            )}

            <div className="rounded-md border p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Live preview (sample property)</div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs">ARV<Input className="w-32" inputMode="numeric" value={arv} onChange={(e) => setArv(e.target.value)} /></label>
                <label className="text-xs">Sq ft<Input className="w-24" inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value)} /></label>
                <label className="text-xs">Condition
                  <select className="ml-1 rounded border bg-background px-2 py-1" value={tier} onChange={(e) => setTier(e.target.value as any)}>
                    <option value="light">light</option><option value="moderate">moderate</option><option value="heavy">heavy</option>
                  </select>
                </label>
                <Button size="sm" onClick={() => preview.mutate()} disabled={preview.isPending}>
                  {preview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Recompute'}
                </Button>
              </div>

              {preview.data && (
                <div className="mt-3 space-y-2" data-testid="preview-result">
                  {preview.data.escalate ? (
                    <div className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      Escalate — no numeric suggestion (human review required).
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-lg font-semibold">{money(preview.data.suggestMin)} – {money(preview.data.suggestMax)}</span>
                      <Badge variant={confColor(preview.data.confidence)}>{preview.data.confidence} confidence</Badge>
                    </div>
                  )}
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:underline" onClick={() => setShowTrace((s) => !s)}>
                    <ChevronDown className={`h-3 w-3 transition ${showTrace ? 'rotate-180' : ''}`} /> How was this calculated?
                  </button>
                  {showTrace && (
                    <ul className="space-y-0.5 rounded bg-muted/50 p-2 text-xs font-mono" data-testid="formula-trace">
                      {preview.data.formulaTrace.map((line, i) => <li key={i}>{line}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {preview.error && <div className="mt-2 text-sm text-destructive">{(preview.error as Error).message}</div>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
