'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Mail, Phone, CheckCircle, DollarSign, PhoneOff, Target, Globe, Brain, MapPin } from 'lucide-react';

const CampaignGlobe = dynamic(() => import('@/components/analytics/CampaignGlobe'), {
  ssr: false,
  loading: () => (
    <div className="h-[380px] flex items-center justify-center text-[var(--text-muted)]">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

const money = (cents: number) => `$${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`;

export default function AnalyticsPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => {
      const res = await fetch('/api/analytics');
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!session,
  });

  const { data: geo } = useQuery({
    queryKey: ['analytics-geo'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/geo');
      if (!res.ok) return { campaigns: [] };
      return res.json();
    },
    enabled: !!session,
    refetchInterval: 20_000,
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

  const funnel = stats?.funnel || { sent: 0, delivered: 0, replied: 0, engaged: 0, negotiated: 0, contracted: 0 };
  const conv = stats?.conversion || {};
  const rates = stats?.rates || {};
  const costs = stats?.costs || { smsCostCents: 0, aiCostCents: 0, totalCostCents: 0, costPerContactCents: 0, costPerDealCents: 0 };
  const margin = stats?.margin || {};
  const totals = stats?.totals || {};
  const perCampaign: any[] = stats?.perCampaign || [];

  const funnelStages = [
    { label: 'Sent', value: funnel.sent, icon: Mail, color: 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]' },
    { label: 'Delivered', value: funnel.delivered, icon: CheckCircle, color: 'bg-[var(--color-success)]/10 text-[var(--color-success)]' },
    { label: 'Replied', value: funnel.replied, icon: Phone, color: 'bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]' },
    { label: 'Engaged', value: funnel.engaged, icon: null, color: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]' },
    { label: 'Negotiated', value: funnel.negotiated, icon: null, color: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]' },
    { label: 'Contracted', value: funnel.contracted, icon: null, color: 'bg-[var(--color-success)]/10 text-[var(--color-success)]' },
  ];

  const kpis = [
    { label: 'Overall conversion', value: pct(conv.overall), sub: 'reach → closed', icon: Target, color: 'text-[var(--accent-blue)]' },
    { label: 'Response rate', value: pct(rates.responseRatePct), sub: 'replied / reached', icon: Phone, color: 'text-[var(--accent-purple)]' },
    { label: 'Opt-out rate', value: pct(rates.optOutRatePct), sub: 'STOP / reached', icon: PhoneOff, color: 'text-[var(--color-error)]' },
    { label: 'Cost per deal', value: money(costs.costPerDealCents), sub: `${totals.closed ?? 0} closed`, icon: DollarSign, color: 'text-[var(--color-success)]' },
    { label: 'Est. margin', value: money(margin.estimatedMarginCents), sub: 'revenue − cost', icon: TrendingUp, color: 'text-[var(--color-success)]' },
  ];

  const hasData = (funnel.sent || funnel.replied || funnel.negotiated || totals.contacts || perCampaign.length) > 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Analytics</h1>
          <p className="text-[var(--text-secondary)] mt-1">Conversion, cost, and margin across your campaigns</p>
        </div>
        <div className="flex gap-2">
          <Link href="/analytics/advanced" className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] text-sm flex items-center gap-2">
            <Brain className="h-4 w-4" />
            AI Campaign Review
          </Link>
          <Link href="/analytics/advanced" className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] text-sm flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Regional Analytics
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : !stats || !hasData ? (
        <GlassCard className="py-12 text-center">
          <TrendingUp className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[var(--text-secondary)]">No analytics data yet.</p>
          <p className="text-sm text-[var(--text-muted)] mt-1">Launch a campaign to see metrics.</p>
        </GlassCard>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {kpis.map((k) => (
              <GlassCard key={k.label} padding="md">
                <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
                  <k.icon className={`h-4 w-4 ${k.color}`} />
                  <span className="text-xs font-medium">{k.label}</span>
                </div>
                <p className="text-2xl font-mono font-bold text-[var(--text-primary)]">{k.value}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{k.sub}</p>
              </GlassCard>
            ))}
          </div>

          {/* Live campaign globe */}
          <GlassCard>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
              <Globe className="h-5 w-5" /> Live Campaign Map
              <span className="text-xs font-normal text-[var(--text-muted)]">approximate regions</span>
            </h3>
            <CampaignGlobe campaigns={geo?.campaigns || []} />
          </GlassCard>

          {/* Funnel with per-stage conversion */}
          <GlassCard>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Conversion Funnel</h3>
            <div className="flex flex-wrap gap-3">
              {funnelStages.map((item) => (
                <div key={item.label} className={`flex-1 min-w-[120px] rounded-lg p-4 ${item.color}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {item.icon && <item.icon className="h-4 w-4" />}
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                  <p className="text-2xl font-mono font-bold">{item.value}</p>
                  <p className="text-xs opacity-80">{conv[item.label.toLowerCase() + 'OfPrev'] == null ? '—' : `${pct(conv[item.label.toLowerCase() + 'OfPrev'])} from prev`}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Cost + margin */}
          <div className="grid md:grid-cols-2 gap-6">
            <GlassCard>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Cost Breakdown</h3>
              <div className="space-y-2 text-sm">
                <Row label="SMS spend" value={money(costs.smsCostCents)} />
                <Row label="AI spend" value={money(costs.aiCostCents)} />
                <Row label="Cost per contact" value={money(costs.costPerContactCents)} />
                <Row label="Cost per deal" value={money(costs.costPerDealCents)} />
                <div className="border-t border-[var(--border-subtle)] pt-2"><Row label="Total spend" value={money(costs.totalCostCents)} bold /></div>
              </div>
            </GlassCard>
            <GlassCard>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                Profit Margin <span className="text-xs font-normal text-[var(--color-warning)]">(estimated)</span>
              </h3>
              <div className="space-y-2 text-sm">
                <Row label="Closed deals" value={String(margin.closedDeals ?? 0)} />
                <Row label="Assumed fee / deal" value={money(margin.estimatedFeePerDealCents)} />
                <Row label="Est. revenue" value={money(margin.revenueCents)} />
                <Row label="Attributed cost" value={money(costs.totalCostCents)} />
                <div className="border-t border-[var(--border-subtle)] pt-2"><Row label="Est. margin" value={money(margin.estimatedMarginCents)} bold /></div>
                <p className="text-xs text-[var(--text-muted)] pt-1">{margin.note}</p>
              </div>
            </GlassCard>
          </div>

          {/* Per-campaign breakdown */}
          <GlassCard>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Per-Campaign Breakdown</h3>
            {perCampaign.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-4">No campaigns yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                      <th className="py-2 pr-4">Campaign</th>
                      <th className="py-2 px-2">Status</th>
                      <th className="py-2 px-2 text-right">Contacts</th>
                      <th className="py-2 px-2 text-right">Replied</th>
                      <th className="py-2 px-2 text-right">Negotiating</th>
                      <th className="py-2 px-2 text-right">Deals</th>
                      <th className="py-2 pl-2 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perCampaign.map((c) => (
                      <tr key={c.id} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td className="py-2 pr-4 font-medium text-[var(--text-primary)]">
                          {c.name} {c.testMode && <Badge className="ml-1 text-[10px] bg-[var(--color-warning)]/10 text-[var(--color-warning)]">TEST</Badge>}
                        </td>
                        <td className="py-2 px-2"><Badge className="bg-[var(--text-muted)]/10 text-[var(--text-muted)]">{c.status}</Badge></td>
                        <td className="py-2 px-2 text-right font-mono text-[var(--text-secondary)]">{c.contacts}</td>
                        <td className="py-2 px-2 text-right font-mono text-[var(--text-secondary)]">{c.replied}</td>
                        <td className="py-2 px-2 text-right font-mono text-[var(--text-secondary)]">{c.negotiating}</td>
                        <td className="py-2 px-2 text-right font-mono text-[var(--color-success)]">{c.deals}</td>
                        <td className="py-2 pl-2 text-right font-mono text-[var(--text-secondary)]">{money(c.costCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{label}</span>
      <span className={`font-mono ${bold ? 'text-[var(--color-success)]' : 'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  );
}
