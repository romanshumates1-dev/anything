'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, ArrowLeft, Gauge } from 'lucide-react';

function scoreColor(score: number) {
  if (score >= 80) return 'text-[var(--color-success)]';
  if (score >= 50) return 'text-[var(--color-warning)]';
  return 'text-[var(--color-error)]';
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
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const score = data?.score ?? 0;
  const categories = data?.categories ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <Link href="/" className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center gap-1 mb-2">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Gauge className="h-7 w-7 text-[var(--accent-blue)]" /> System Readiness
        </h1>
        <p className="text-[var(--text-secondary)] mt-1">Deterministic score computed from live system state.</p>
      </header>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : (
        <>
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-[var(--text-primary)]">Overall Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-6xl font-bold ${scoreColor(score)}`}>
                {score}
                <span className="text-2xl text-[var(--text-muted)]">/100</span>
              </div>
              <div className="mt-4">
                <Progress value={score} />
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-[var(--text-primary)]">Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {categories.map((c: any) => (
                <div key={c.key}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm font-medium text-[var(--text-primary)]">{c.label}</span>
                    <span className="text-sm text-[var(--text-muted)]">
                      {c.points}/{c.weight} pts
                    </span>
                  </div>
                  <Progress value={c.weight > 0 ? (c.points / c.weight) * 100 : 0} />
                  <p className="text-xs text-[var(--text-muted)] mt-1">{c.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
