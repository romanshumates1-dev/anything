'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ActionItems } from '@/components/dashboard/ActionItems';
import { SkeletonCard } from '@/components/ui/Skeleton';
import {
  CurrencyDollarIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  DocumentCheckIcon,
} from '@heroicons/react/24/outline';
import {
  Users,
  ShieldCheck,
  AlertTriangle,
  Activity,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

export default function DashboardPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
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

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">DealFlow AI</h1>
            <p className="text-gray-500 mt-1 text-lg">Find leads, launch SMS campaigns, close deals.</p>
          </div>
          <div className="flex gap-4">
            <Link href="/campaigns">
              <Button variant="outline" className="text-lg py-6 px-6">
                Campaigns
              </Button>
            </Link>
            <Link href="/inbox">
              <Button variant="outline" className="text-lg py-6 px-6">
                Inbox
              </Button>
            </Link>
            <Link href="/leads/import">
              <Button variant="outline" className="text-lg py-6 px-6">
                Import Leads
              </Button>
            </Link>
            <Link href="/dashboard/readiness">
              <Button variant="outline" className="text-lg py-6 px-6">
                Readiness
              </Button>
            </Link>
            <Link href="/account/logout">
              <Button variant="ghost" className="text-lg py-6 px-6 text-gray-500">
                Sign Out
              </Button>
            </Link>
          </div>
        </header>

        {/* Quick Start — the 3-step flow so a new user knows exactly what to do. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { n: 1, title: 'Find or import leads', desc: 'Lead Finder (public records) or import a CSV.', href: '/lead-finder', cta: 'Open Lead Finder' },
            { n: 2, title: 'Launch a campaign', desc: 'Quick Launch with smart defaults, or customize.', href: '/campaigns/wizard', cta: 'New Campaign' },
            { n: 3, title: 'Watch it work', desc: 'Track replies in Analytics, approve deals in Approvals.', href: '/analytics', cta: 'View Analytics' },
          ].map((s) => (
            <div key={s.n} className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold">{s.n}</span>
                <span className="font-semibold text-gray-900">{s.title}</span>
              </div>
              <p className="text-sm text-gray-500 mt-2 flex-1">{s.desc}</p>
              <Link href={s.href} className="mt-3">
                <Button variant="outline" size="sm" className="w-full">{s.cta} →</Button>
              </Link>
            </div>
          ))}
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statsLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              <KpiCard
                title="Pipeline Value"
                value={stats?.pipelineValue || 0}
                format="currency"
                change={12}
                changeLabel="vs last month"
                icon={<CurrencyDollarIcon className="h-5 w-5" />}
              />
              <KpiCard
                title="Active Leads"
                value={stats?.totalLeads || 0}
                format="number"
                change={8}
                changeLabel="vs last month"
                icon={<UserGroupIcon className="h-5 w-5" />}
              />
              <KpiCard
                title="Open Conversations"
                value={stats?.openConversations || 0}
                format="number"
                change={-3}
                changeLabel="vs last month"
                icon={<ChatBubbleLeftRightIcon className="h-5 w-5" />}
              />
              <KpiCard
                title="Pending Contracts"
                value={stats?.pendingContracts || 0}
                format="number"
                change={5}
                changeLabel="vs last month"
                icon={<DocumentCheckIcon className="h-5 w-5" />}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 border-none shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Recent Leads</CardTitle>
              <Link href="/leads">
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="text-center py-12 text-gray-400">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p>No leads found. Start by importing your first deal flow.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <ActionItems
              items={[
                {
                  id: '1',
                  type: 'response_needed',
                  title: 'Response from John Smith',
                  subtitle: '123 Main St - Interested in offer',
                  href: '/inbox?lead=1',
                  urgent: true,
                },
                {
                  id: '2',
                  type: 'contract_expiring',
                  title: 'Contract expires in 3 days',
                  subtitle: '456 Oak Ave - Smith/Johnson',
                  href: '/contracts?id=2',
                },
                {
                  id: '3',
                  type: 'follow_up',
                  title: 'Follow up with Sarah Davis',
                  subtitle: '789 Pine Rd - No response in 5 days',
                  href: '/crm?lead=3',
                },
              ]}
            />

            <Card className="border-none shadow-sm">
              <CardHeader>
                <CardTitle>System Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {[
                  { name: 'Database (Neon)', status: 'Operational', color: 'bg-green-500' },
                  { name: 'AI Orchestrator (Claude)', status: 'Operational', color: 'bg-green-500' },
                  { name: 'Job Queue (Internal)', status: 'Active', color: 'bg-green-500' },
                  { name: 'Auth (Better-Auth)', status: 'Secure', color: 'bg-green-500' },
                ].map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${item.color}`} />
                      <span className="text-sm font-medium">{item.name}</span>
                    </div>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
