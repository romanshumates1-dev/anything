'use client';

import { useSession } from '@/lib/auth-client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, ArrowRight } from 'lucide-react';

const money = (cents: number) => `$${((cents || 0) / 100).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`;

export default function FunnelPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: funnel, isLoading } = useQuery({
    queryKey: ['funnel'],
    queryFn: async () => {
      const res = await fetch('/api/funnel');
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

  const stages = funnel?.funnel || {
    NEW: 0,
    CONTACTED: 0,
    ENGAGED: 0,
    NEGOTIATING: 0,
    SIGNED: 0,
    ASSIGNED: 0,
  };

  const conversions = funnel?.conversions || {};
  const timeseries = funnel?.timeseries || [];

  const funnelStages = [
    { label: 'New Leads', value: stages.NEW, step: 'NEW', conv: null },
    { label: 'Contacted', value: stages.CONTACTED, step: 'CONTACTED', conv: conversions.contactedOfNew },
    { label: 'Engaged', value: stages.ENGAGED, step: 'ENGAGED', conv: conversions.engagedOfContacted },
    { label: 'Negotiating', value: stages.NEGOTIATING, step: 'NEGOTIATING', conv: conversions.negotiatingOfEngaged },
    { label: 'Signed', value: stages.SIGNED, step: 'SIGNED', conv: conversions.signedOfNegotiating },
    { label: 'Assigned', value: stages.ASSIGNED, step: 'ASSIGNED', conv: conversions.assignedOfSigned },
  ];

  const hasData = (stages.NEW || stages.CONTACTED || stages.ENGAGED || stages.NEGOTIATING || stages.SIGNED || stages.ASSIGNED) > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Conversion Funnel</h1>
          <p className="text-gray-500 mt-1">Stage transition analytics from the audit trail</p>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin opacity-30" />
          </div>
        ) : !hasData ? (
          <Card className="border-none shadow-sm">
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No funnel data yet.</p>
              <p className="text-sm text-gray-400 mt-1">
                Stage transitions are recorded as leads move through the pipeline.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Overall conversion */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>Overall Conversion Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-4xl font-bold text-blue-600">
                  {pct(conversions.overall)}
                </p>
                <p className="text-sm text-gray-500 mt-1">NEW leads → ASSIGNED contracts</p>
              </CardContent>
            </Card>

            {/* Funnel stages */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>Stage Transitions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {funnelStages.map((item, idx) => (
                    <div key={item.label} className="flex-1 min-w-[120px] rounded-lg p-4 bg-gradient-to-b from-gray-50 to-gray-100 border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-xs">{idx + 1}</Badge>
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <p className="text-2xl font-bold">{item.value}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {item.conv == null ? '—' : `${pct(item.conv)} from prev`}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Time series */}
            {timeseries.length > 0 && (
              <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle>Recent Activity (14-day)</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 px-2 text-right">Transitions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeseries.map((t: any) => (
                        <tr key={t.date} className="border-b last:border-0">
                          <td className="py-2 pr-4">{t.date}</td>
                          <td className="py-2 px-2 text-right">{t.transitions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}