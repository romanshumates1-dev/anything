'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, ArrowLeft, Gauge } from 'lucide-react';

function scoreColor(score: number) {
  if (score >= 80) return 'text-green-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
}

export default function ReadinessPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: ['system-readiness'],
    queryFn: async () => {
      const res = await fetch('/api/system/readiness');
      if (!res.ok) throw new Error('Failed to fetch readiness');
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const score = data?.score ?? 0;
  const categories = data?.categories ?? [];

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <Link href="/" className="text-sm text-gray-500 flex items-center gap-1 mb-2">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <Gauge className="h-7 w-7 text-blue-600" /> System Readiness
          </h1>
          <p className="text-gray-500 mt-1">Deterministic score computed from live system state.</p>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin opacity-30" />
          </div>
        ) : (
          <>
            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>Overall Score</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-6xl font-bold ${scoreColor(score)}`}>
                  {score}
                  <span className="text-2xl text-gray-400">/100</span>
                </div>
                <div className="mt-4">
                  <Progress value={score} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>Category Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {categories.map((c: any) => (
                  <div key={c.key}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-sm font-medium text-gray-800">{c.label}</span>
                      <span className="text-sm text-gray-500">
                        {c.points}/{c.weight} pts
                      </span>
                    </div>
                    <Progress value={c.weight > 0 ? (c.points / c.weight) * 100 : 0} />
                    <p className="text-xs text-gray-400 mt-1">{c.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
