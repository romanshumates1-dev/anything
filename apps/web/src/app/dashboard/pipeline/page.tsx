'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, Settings, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { PipelineFlowVisualization } from '@/components/dashboard/PipelineFlowVisualization';
import { PipelineConfigCard } from '@/components/settings/PipelineConfigCard';

interface PipelineRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
  stage_stats: Record<string, { processed?: number; sent?: number; errors?: number }>;
  leads_processed: number;
  messages_sent: number;
  human_actions_created: number;
  errors: Array<{ stage: string; error: string }>;
}

export default function PipelinePage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['pipeline-runs'],
    queryFn: async () => {
      const res = await fetch('/api/pipeline/runs');
      if (!res.ok) throw new Error('Failed to fetch runs');
      return res.json() as Promise<{ runs: PipelineRun[] }>;
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

  const pipelineRuns = runs?.runs || [];

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              Pipeline Management
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Monitor and configure the automated pipeline
            </p>
          </div>
        </header>

        {/* Pipeline Flow Visualization */}
        <PipelineFlowVisualization />

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Runs */}
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Recent Pipeline Runs</CardTitle>
              <CardDescription>
                History of automated pipeline executions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : pipelineRuns.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No pipeline runs yet.</p>
                  <p className="text-sm mt-1">
                    Pipeline runs are triggered automatically or manually.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pipelineRuns.slice(0, 10).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800"
                    >
                      <div className="flex items-center gap-3">
                        {run.status === 'COMPLETED' && (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        {run.status === 'FAILED' && (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        {run.status === 'PARTIAL' && (
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        )}
                        {run.status === 'RUNNING' && (
                          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {new Date(run.started_at).toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-500">
                            {run.leads_processed} leads, {run.messages_sent} messages
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            run.status === 'COMPLETED'
                              ? 'border-green-300 text-green-700'
                              : run.status === 'FAILED'
                              ? 'border-red-300 text-red-700'
                              : run.status === 'PARTIAL'
                              ? 'border-yellow-300 text-yellow-700'
                              : 'border-blue-300 text-blue-700'
                          }
                        >
                          {run.status}
                        </Badge>
                        {run.human_actions_created > 0 && (
                          <Badge variant="secondary">
                            {run.human_actions_created} actions
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Configuration */}
          <PipelineConfigCard />
        </div>

        {/* Design Philosophy */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Design Philosophy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose dark:prose-invert max-w-none">
              <p className="text-gray-600 dark:text-gray-400">
                <strong>AI runs everything, humans only intervene when genuinely beneficial.</strong>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    Human Interaction Points
                  </h4>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Campaign Setup - You know your market</li>
                    <li>High-Value Deal Review - Over threshold</li>
                    <li>Contract Signing - Legal commitment</li>
                    <li>Closing Confirmation - Payment release</li>
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    Fully Automated
                  </h4>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>Lead import, scoring, assignment</li>
                    <li>Message sending and follow-ups</li>
                    <li>Response classification</li>
                    <li>Negotiation within bounds</li>
                    <li>Contract generation</li>
                  </ul>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
