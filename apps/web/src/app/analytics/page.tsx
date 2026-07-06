'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, Mail, Phone, CheckCircle } from 'lucide-react';

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
  const total = funnel.sent || 1;

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Analytics</h1>
          <p className="text-gray-500 mt-1">Campaign performance and funnel metrics</p>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin opacity-30" />
          </div>
        ) : !stats ? (
          <Card className="border-none shadow-sm">
            <CardContent className="py-12 text-center">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No analytics data yet.</p>
              <p className="text-sm text-gray-400 mt-1">Launch a campaign to see metrics.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Funnel */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>Conversion Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {[
                    { label: 'Sent', value: funnel.sent, icon: Mail, color: 'bg-blue-100 text-blue-700' },
                    { label: 'Delivered', value: funnel.delivered, icon: CheckCircle, color: 'bg-green-100 text-green-700' },
                    { label: 'Replied', value: funnel.replied, icon: Phone, color: 'bg-purple-100 text-purple-700' },
                    { label: 'Engaged', value: funnel.engaged, color: 'bg-amber-100 text-amber-700' },
                    { label: 'Negotiated', value: funnel.negotiated, color: 'bg-orange-100 text-orange-700' },
                    { label: 'Contracted', value: funnel.contracted, color: 'bg-emerald-100 text-emerald-700' },
                  ].map((item) => {
                    const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                    return (
                      <div key={item.label} className={`flex-1 min-w-[120px] rounded-lg p-4 ${item.color}`}>
                        <div className="flex items-center gap-2 mb-1">
                          {item.icon && <item.icon className="h-4 w-4" />}
                          <span className="text-sm font-medium">{item.label}</span>
                        </div>
                        <p className="text-2xl font-bold">{item.value}</p>
                        <p className="text-xs opacity-80">{pct}% of sent</p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Cost estimates */}
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>Cost Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">SMS spend (est.)</span>
                  <span className="font-medium">${((stats?.smsCostCents || 0) / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">AI spend (est.)</span>
                  <span className="font-medium">${((stats?.aiCostCents || 0) / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Scrub cost</span>
                  <span className="font-medium">${((stats?.scrubCostCents || 0) / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span>${((stats?.totalCostCents || 0) / 100).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}