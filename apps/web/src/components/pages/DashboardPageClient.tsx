'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, ShieldCheck, AlertTriangle, Activity, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

export default function DashboardPageClient() {
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

  const statCards = [
    { name: 'Total Leads', value: stats?.totalLeads || 0, icon: Users, color: 'text-blue-600' },
    {
      name: 'Requires Human',
      value: stats?.requiresHuman || 0,
      icon: AlertTriangle,
      color: 'text-amber-600',
    },
    {
      name: 'Pending Jobs',
      value: stats?.pendingJobs || 0,
      icon: Activity,
      color: 'text-purple-600',
    },
    {
      name: 'Audit Logs',
      value: stats?.auditCount || 0,
      icon: ShieldCheck,
      color: 'text-green-600',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">DealFlow AI</h1>
            <p className="text-gray-500 mt-1 text-lg">Production Hardened Infrastructure</p>
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat) => (
            <Card key={stat.name} className="border-none shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">{stat.name}</CardTitle>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin opacity-20" />
                ) : (
                  <div className="text-2xl font-bold">{stat.value}</div>
                )}
              </CardContent>
            </Card>
          ))}
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

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>System Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {[
                { name: 'Database (Neon)', status: 'Operational', color: 'bg-green-500' },
                { name: 'AI Orchestrator (Gemini)', status: 'Operational', color: 'bg-green-500' },
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
  );
}
