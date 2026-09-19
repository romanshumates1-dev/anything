'use client';

/**
 * Negotiation Settings Card - Configure automated AI negotiation parameters
 *
 * Features:
 * - Min/max/target price configuration
 * - Strategy selection (aggressive/balanced/conservative)
 * - Auto-approve and escalation thresholds
 * - Max rounds configuration
 * - View active negotiations dashboard
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Loader2, Bot, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, XCircle, Clock, Sparkles, Home } from 'lucide-react';
import { toast } from 'sonner';

type NegotiationStrategy = 'aggressive' | 'balanced' | 'conservative';

interface NegotiationConfig {
  autoNegotiation: boolean;
  strategy: NegotiationStrategy;
  autoApproveUnderCents: number;
  escalateOverCents: number;
  maxRounds: number;
  defaultFeeFloorCents: number;
  useAIPricing: boolean;
}

interface AIPricingEstimate {
  arvCents: number;
  confidence: 'high' | 'medium' | 'low';
  comparablesUsed: number;
  minOfferCents: number;
  maxOfferCents: number;
  assignmentFeeCents: number;
  methodology: string[];
}

interface NegotiationStats {
  total: number;
  active: number;
  agreed: number;
  walkedAway: number;
  paused: number;
  autoResolved: number;
  escalated: number;
  avgRounds: number;
  autoResolutionRate: number;
}

const money = (cents: number) => '$' + Math.round(cents / 100).toLocaleString('en-US');
const pct = (n: number) => `${Math.round(n)}%`;

const strategyDescriptions: Record<NegotiationStrategy, { icon: React.ReactNode; label: string; desc: string }> = {
  aggressive: {
    icon: <TrendingDown className="h-4 w-4 text-red-500" />,
    label: 'Aggressive',
    desc: 'Smaller concessions, higher margins, more walk-aways',
  },
  balanced: {
    icon: <Minus className="h-4 w-4 text-blue-500" />,
    label: 'Balanced',
    desc: 'Industry-standard approach, good close rate',
  },
  conservative: {
    icon: <TrendingUp className="h-4 w-4 text-green-500" />,
    label: 'Conservative',
    desc: 'Larger concessions, more deals closed, lower margins',
  },
};

export default function NegotiationSettingsCard() {
  const qc = useQueryClient();
  const [formState, setFormState] = useState<Partial<NegotiationConfig>>({});

  // Gate on beta flag
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

  // Load config
  const { data: config, isLoading: configLoading } = useQuery<NegotiationConfig>({
    queryKey: ['negotiation-config'],
    enabled: flagOn,
    queryFn: async () => {
      const res = await fetch('/api/negotiation/config');
      if (!res.ok) throw new Error('Failed to load config');
      return res.json();
    },
  });

  // Load stats
  const { data: stats, isLoading: statsLoading } = useQuery<NegotiationStats>({
    queryKey: ['negotiation-stats'],
    enabled: flagOn,
    refetchInterval: 30000, // Refresh every 30s
    queryFn: async () => {
      const res = await fetch('/api/negotiation/stats');
      if (!res.ok) throw new Error('Failed to load stats');
      return res.json();
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<NegotiationConfig>) => {
      const res = await fetch('/api/negotiation/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['negotiation-config'] });
      toast.success('Negotiation settings saved');
      setFormState({});
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  if (!flagOn) return null;

  const effectiveConfig = { ...config, ...formState };
  const hasChanges = Object.keys(formState).length > 0;

  return (
    <Card data-testid="negotiation-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Negotiation Engine
          <Badge variant="outline">Beta</Badge>
        </CardTitle>
        <CardDescription>
          Configure automated counter-offer handling. The AI negotiates within your approved bounds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Stats Dashboard */}
        {!statsLoading && stats && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <h4 className="text-sm font-medium mb-3">Negotiation Performance</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatTile
                label="Auto Resolution"
                value={pct(stats.autoResolutionRate)}
                icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
                highlight={stats.autoResolutionRate >= 90}
              />
              <StatTile
                label="Active"
                value={String(stats.active)}
                icon={<Clock className="h-4 w-4 text-blue-500" />}
              />
              <StatTile
                label="Agreed"
                value={String(stats.agreed)}
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              />
              <StatTile
                label="Escalated"
                value={String(stats.escalated)}
                icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
              />
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              Total: {stats.total} negotiations | Avg rounds: {stats.avgRounds.toFixed(1)} | Walk-aways: {stats.walkedAway}
            </div>
          </div>
        )}

        {configLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading settings...
          </div>
        ) : (
          <>
            {/* Auto-negotiation toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="auto-negotiation" className="text-sm font-medium">Enable AI Negotiation</Label>
                <p className="text-xs text-muted-foreground">Allow AI to automatically respond to counter-offers</p>
              </div>
              <Switch
                id="auto-negotiation"
                checked={effectiveConfig.autoNegotiation ?? true}
                onCheckedChange={(checked) => setFormState(s => ({ ...s, autoNegotiation: checked }))}
              />
            </div>

            {/* AI Pricing toggle */}
            <div className="flex items-center justify-between rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <Label htmlFor="ai-pricing" className="text-sm font-medium flex items-center gap-2">
                    AI-Suggested Pricing
                    <Badge variant="secondary" className="text-xs">New</Badge>
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use comparable sales data to automatically suggest offer ranges.
                    Falls back to manual bounds if comps are unavailable.
                  </p>
                </div>
              </div>
              <Switch
                id="ai-pricing"
                checked={effectiveConfig.useAIPricing ?? false}
                onCheckedChange={(checked) => setFormState(s => ({ ...s, useAIPricing: checked }))}
              />
            </div>

            {/* AI Pricing Info Panel (shown when enabled) */}
            {effectiveConfig.useAIPricing && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Home className="h-4 w-4 text-primary" />
                  How AI Pricing Works
                </div>
                <div className="text-xs text-muted-foreground space-y-2">
                  <p>
                    When enabled, the system analyzes comparable property sales to suggest offer ranges:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Fetches recent sales within 0.5 miles with similar bed/bath/sqft</li>
                    <li>Calculates weighted ARV based on property similarity</li>
                    <li>Applies 70% rule with condition and motivation adjustments</li>
                    <li>Suggests min/max offer range and assignment fee</li>
                  </ul>
                  <p className="pt-2 border-t mt-2">
                    <span className="font-medium text-foreground">Note:</span> AI suggestions still require your approval.
                    You can override any suggested values before starting negotiations.
                  </p>
                </div>
                <div className="flex gap-2 flex-wrap pt-2">
                  <Badge variant="outline" className="text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                    High confidence: 5+ comps
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1 text-amber-500" />
                    Medium: 3-4 comps
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    <XCircle className="h-3 w-3 mr-1 text-red-500" />
                    Low: Manual review needed
                  </Badge>
                </div>
              </div>
            )}

            {/* Strategy Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Negotiation Strategy</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(['aggressive', 'balanced', 'conservative'] as const).map((strategy) => {
                  const { icon, label, desc } = strategyDescriptions[strategy];
                  const isSelected = effectiveConfig.strategy === strategy;
                  return (
                    <button
                      key={strategy}
                      onClick={() => setFormState(s => ({ ...s, strategy }))}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {icon}
                        <span className="font-medium text-sm">{label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Threshold Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="auto-approve">Auto-approve under</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    id="auto-approve"
                    type="number"
                    value={Math.round((effectiveConfig.autoApproveUnderCents || 10_000_000) / 100)}
                    onChange={(e) => setFormState(s => ({
                      ...s,
                      autoApproveUnderCents: Number(e.target.value) * 100,
                    }))}
                    className="w-32"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Deals under this amount are auto-approved</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="escalate-over">Escalate over</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    id="escalate-over"
                    type="number"
                    value={Math.round((effectiveConfig.escalateOverCents || 50_000_000) / 100)}
                    onChange={(e) => setFormState(s => ({
                      ...s,
                      escalateOverCents: Number(e.target.value) * 100,
                    }))}
                    className="w-32"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Deals over this amount require human review</p>
              </div>
            </div>

            {/* Max Rounds */}
            <div className="space-y-2">
              <Label htmlFor="max-rounds">Maximum Negotiation Rounds</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="max-rounds"
                  type="number"
                  min={1}
                  max={10}
                  value={effectiveConfig.maxRounds || 4}
                  onChange={(e) => setFormState(s => ({
                    ...s,
                    maxRounds: Math.min(10, Math.max(1, Number(e.target.value))),
                  }))}
                  className="w-20"
                />
                <span className="text-sm text-muted-foreground">rounds before walking away</span>
              </div>
            </div>

            {/* Fee Floor */}
            <div className="space-y-2">
              <Label htmlFor="fee-floor">Minimum Fee Floor</Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  id="fee-floor"
                  type="number"
                  value={Math.round((effectiveConfig.defaultFeeFloorCents || 500_000) / 100)}
                  onChange={(e) => setFormState(s => ({
                    ...s,
                    defaultFeeFloorCents: Number(e.target.value) * 100,
                  }))}
                  className="w-24"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                System walks away before going below this fee. Industry minimum: $5,000
              </p>
            </div>

            {/* Save Button */}
            {hasChanges && (
              <div className="flex items-center gap-2 pt-2 border-t">
                <Button
                  onClick={() => saveMutation.mutate(formState)}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Save Changes
                </Button>
                <Button variant="ghost" onClick={() => setFormState({})}>
                  Cancel
                </Button>
              </div>
            )}

            {/* Warning Banner */}
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3 text-sm">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900 dark:text-amber-200">
                    AI negotiates within your approved ranges
                  </p>
                  <p className="text-amber-800 dark:text-amber-300 text-xs mt-1">
                    Each lead requires an owner-approved price range before AI negotiation activates.
                    The AI never sends a number outside your approved bounds.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatTile({
  label,
  value,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`text-center p-2 rounded ${highlight ? 'bg-green-100 dark:bg-green-900/30' : ''}`}>
      <div className="flex items-center justify-center gap-1 mb-1">
        {icon}
        <span className={`text-lg font-semibold ${highlight ? 'text-green-700 dark:text-green-300' : ''}`}>
          {value}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
