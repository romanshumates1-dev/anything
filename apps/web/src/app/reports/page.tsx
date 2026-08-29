'use client';

import { useSession } from '@/lib/auth-client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, BarChart3, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

interface PipelineAnalytics {
  phases: Array<{
    phase: string;
    count: number;
    conversionRate: number;
    dropOffRate: number;
  }>;
  overallConversion: number;
  kpis: {
    costPerDeal: number;
    avgTimeToClose: number;
    closeRate: number;
  };
  recommendations: string[];
}

export default function ReportsPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: analytics, isLoading } = useQuery<PipelineAnalytics>({
    queryKey: ['pipeline-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/optimization/pipeline-analytics');
      if (!res.ok) throw new Error('Failed to load analytics');
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

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center gap-3 mb-8">
        <BarChart3 className="h-8 w-8" />
        <h1 className="text-3xl font-bold">Reports & Analytics</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : !analytics ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Unable to load analytics data.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* KPI Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Close Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                  <span className="text-2xl font-bold">
                    {Math.round((analytics.kpis.closeRate || 0) * 100)}%
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Days to Close
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-blue-500" />
                  <span className="text-2xl font-bold">
                    {analytics.kpis.avgTimeToClose || 0}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Overall Conversion
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-500" />
                  <span className="text-2xl font-bold">
                    {Math.round((analytics.overallConversion || 0) * 100)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pipeline Funnel */}
          <Card>
            <CardHeader>
              <CardTitle>Pipeline Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics.phases.map((phase, i) => (
                  <div key={phase.phase} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{phase.phase}</span>
                      <span className="text-muted-foreground">
                        {phase.count} leads ({Math.round(phase.conversionRate * 100)}% conv)
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${Math.max(5, phase.conversionRate * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recommendations */}
          {analytics.recommendations && analytics.recommendations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>AI Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analytics.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <TrendingUp className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
