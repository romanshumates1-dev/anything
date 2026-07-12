'use client';

import { useSession } from '@/lib/auth-client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Mail, Phone, CheckCircle, DollarSign, PhoneOff, Target } from 'lucide-react';

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

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (!session) return null;

  const funnel = stats?.funnel || { sent: 0, delivered: 0, replied: 0, engaged: 0, negotiated: 0, contracted: 0 };
  const conv = stats?.conversion || {};
  const rates = stats?.rates || {};
  const costs = stats?.costs || { smsCostCents: 0, aiCostCents: 0, totalCostCents: 0, costPerContactCents: 0, costPerDealCents: 0 };
  const margin = stats?.margin || {};
  const totals = stats?.totals || {};
  const perCampaign: any[] = stats?.perCampaign || [];

  const funnelStages = [
    { label: 'Sent', value: funnel.sent, icon: Mail, color: 'bg-blue-100 text-blue-700', conv: null },
    { label: 'Delivered', value: funnel.delivered, icon: CheckCircle, color: 'bg-green-100 text-green-700', conv: conv.deliveredOfSent },
    { label: 'Replied', value: funnel.replied, icon: Phone, color: 'bg-purple-100 text-purple-700', conv: conv.repliedOfReach },
    { label: 'Engaged', value: funnel.engaged, icon: null, color: 'bg-amber-100 text-amber-700', conv: conv.engagedOfReplied },
    { label: 'Negotiated', value: funnel.negotiated, icon: null, color: 'bg-orange-100 text-orange-700', conv: conv.negotiatedOfEngaged },
    { label: 'Contracted', value: funnel.contracted, icon: null, color: 'bg-emerald-100 text-emerald-700', conv: conv.contractedOfNegotiated },
  ];

  const kpis = [
    { label: 'Overall conversion', value: pct(conv.overall), sub: 'reach → closed', icon: Target, color: 'text-blue-600' },
    { label: 'Response rate', value: pct(rates.responseRatePct), sub: 'replied / reached', icon: Phone, color: 'text-purple-600' },
    { label: 'Opt-out rate', value: pct(rates.optOutRatePct), sub: 'STOP / reached', icon: PhoneOff, color: 'text-red-600' },
    { label: 'Cost per deal', value: money(costs.costPerDealCents), sub: `${totals.closed ?? 0} closed`, icon: DollarSign, color: 'text-emerald-600' },
    { label: 'Est. margin', value: money(margin.estimatedMarginCents), sub: 'revenue − cost (est.)', icon: TrendingUp, color: 'text-green-600' },
  ];

  const hasData = (funnel.sent || funnel.replied || funnel.negotiated || totals.contacts || perCampaign.length) > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Analytics</h1>
          <p className="text-gray-500 mt-1">Conversion, cost, and margin across your campaigns</p>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin opacity-30" /></div>
        ) : !stats || !hasData ? (
          <Card className="border-none shadow-sm">
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No analytics data yet.</p>
              <p className="text-sm text-gray-400 mt-1">Launch a campaign (or run the mock simulator) to see metrics.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {kpis.map((k) => (
                <Card key={k.label} className="border-none shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-gray-500 mb-1">
                      <k.icon className={`h-4 w-4 ${k.color}`} />
                      <span className="text-xs font-medium">{k.label}</span>
                    </div>
                    <p className="text-2xl font-bold">{k.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{k.sub}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Funnel with per-stage conversion */}
            <Card className="border-none shadow-sm">
              <CardHeader><CardTitle>Conversion Funnel</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {funnelStages.map((item) => (
                    <div key={item.label} className={`flex-1 min-w-[120px] rounded-lg p-4 ${item.color}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {item.icon && <item.icon className="h-4 w-4" />}
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <p className="text-2xl font-bold">{item.value}</p>
                      <p className="text-xs opacity-80">{item.conv == null ? '—' : `${pct(item.conv)} from prev`}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Cost + margin */}
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="border-none shadow-sm">
                <CardHeader><CardTitle>Cost Breakdown</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="SMS spend" value={money(costs.smsCostCents)} />
                  <Row label="AI spend" value={money(costs.aiCostCents)} />
                  <Row label="Cost per contact" value={money(costs.costPerContactCents)} />
                  <Row label="Cost per deal" value={money(costs.costPerDealCents)} />
                  <div className="border-t pt-2"><Row label="Total spend" value={money(costs.totalCostCents)} bold /></div>
                </CardContent>
              </Card>
              <Card className="border-none shadow-sm">
                <CardHeader><CardTitle>Profit Margin <span className="text-xs font-normal text-amber-600">(estimated)</span></CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="Closed deals" value={String(margin.closedDeals ?? 0)} />
                  <Row label="Assumed fee / deal" value={money(margin.estimatedFeePerDealCents)} />
                  <Row label="Est. revenue" value={money(margin.revenueCents)} />
                  <Row label="Attributed cost" value={money(costs.totalCostCents)} />
                  <div className="border-t pt-2"><Row label="Est. margin" value={money(margin.estimatedMarginCents)} bold /></div>
                  <p className="text-xs text-gray-400 pt-1">{margin.note}</p>
                </CardContent>
              </Card>
            </div>

            {/* Per-campaign breakdown */}
            <Card className="border-none shadow-sm">
              <CardHeader><CardTitle>Per-Campaign Breakdown</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {perCampaign.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4">No campaigns yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
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
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium text-gray-900">
                            {c.name} {c.testMode && <Badge variant="outline" className="ml-1 text-[10px]">TEST</Badge>}
                          </td>
                          <td className="py-2 px-2"><Badge variant="outline">{c.status}</Badge></td>
                          <td className="py-2 px-2 text-right">{c.contacts}</td>
                          <td className="py-2 px-2 text-right">{c.replied}</td>
                          <td className="py-2 px-2 text-right">{c.negotiating}</td>
                          <td className="py-2 px-2 text-right">{c.deals}</td>
                          <td className="py-2 pl-2 text-right">{money(c.costCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-gray-500'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
