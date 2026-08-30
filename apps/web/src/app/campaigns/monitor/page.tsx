'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  ArrowLeft,
  RefreshCw,
  Activity,
  Mail,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  Zap,
  Shield,
  MapPin,
} from 'lucide-react';

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800 border-green-200',
    PAUSED: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    ok: 'bg-green-100 text-green-800 border-green-200',
    warning: 'bg-red-100 text-red-800 border-red-200',
    pending: 'bg-blue-100 text-blue-800 border-blue-200',
    completed: 'bg-green-100 text-green-800 border-green-200',
    failed: 'bg-red-100 text-red-800 border-red-200',
    dead: 'bg-gray-100 text-gray-800 border-gray-200',
  };
  return (
    <Badge variant="outline" className={colors[status] || 'bg-gray-100'}>
      {status}
    </Badge>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  status,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  trend?: string;
  status?: 'ok' | 'warning' | 'error';
}) {
  const statusColors = {
    ok: 'border-l-green-500',
    warning: 'border-l-yellow-500',
    error: 'border-l-red-500',
  };
  return (
    <Card className={`border-l-4 ${status ? statusColors[status] : 'border-l-blue-500'}`}>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
          </div>
          <div className="flex flex-col items-end">
            <Icon className="h-8 w-8 text-gray-300" />
            {trend && <span className="text-xs text-green-600 mt-1">{trend}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QualityGate({
  name,
  current,
  threshold,
  unit,
  status,
}: {
  name: string;
  current: number;
  threshold: number;
  unit: string;
  status: string;
}) {
  const pct = Math.min((current / threshold) * 100, 100);
  const barColor = status === 'ok' ? 'bg-green-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{name}</span>
        <span className={status === 'ok' ? 'text-green-600' : 'text-red-600'}>
          {current}{unit} / {threshold}{unit}
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HourlyChart({ data }: { data: any[] }) {
  if (!data || data.length === 0) {
    return <p className="text-gray-400 text-sm">No data yet</p>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-20">
      {data.slice(0, 12).reverse().map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center">
          <div
            className="w-full bg-blue-500 rounded-t"
            style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? '4px' : '0' }}
          />
          <span className="text-[10px] text-gray-400 mt-1">
            {new Date(d.hour).getHours()}h
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CampaignMonitorPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['campaign-monitor'],
    queryFn: async () => {
      const res = await fetch('/api/campaigns/monitor');
      if (!res.ok) throw new Error('Failed to fetch monitor data');
      return res.json();
    },
    enabled: !!session,
    refetchInterval: autoRefresh ? 5000 : false,
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
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <Link href="/campaigns" className="text-sm text-gray-500 flex items-center gap-1 mb-2">
              <ArrowLeft className="h-4 w-4" /> Campaigns
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Campaign Monitor
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Real-time campaign performance and health
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              Auto-refresh (5s)
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {data?.campaign && (
              <StatusBadge status={data.campaign.status} />
            )}
          </div>
        </header>

        {isLoading ? (
          <div className="py-20 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : !data ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              Failed to load monitor data
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Top Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                title="Daily Progress"
                value={`${data.campaign.progress}%`}
                subtitle={`${formatNumber(data.campaign.dailySent)} / ${formatNumber(data.campaign.dailyTarget)}`}
                icon={TrendingUp}
                status="ok"
              />
              <MetricCard
                title="Emails Sent Today"
                value={formatNumber(data.emails.today.sent)}
                subtitle={`${data.emails.today.delivered} delivered`}
                icon={Mail}
                status={data.emails.today.sent > 0 ? 'ok' : 'warning'}
              />
              <MetricCard
                title="Pending Jobs"
                value={data.jobs.pending || 0}
                subtitle={`${data.jobs.completed || 0} completed`}
                icon={Activity}
                status={(data.jobs.failed || 0) > 0 ? 'warning' : 'ok'}
              />
              <MetricCard
                title="Queue Ready"
                value={data.queue.queued || 0}
                subtitle={`${data.queue.total || 0} total`}
                icon={Zap}
                status="ok"
              />
            </div>

            {/* Quality Gates */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Quality Gates
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <QualityGate
                    name="Bounce Rate"
                    current={data.emails.gates.bounce.current}
                    threshold={data.emails.gates.bounce.threshold}
                    unit="%"
                    status={data.emails.gates.bounce.status}
                  />
                  <QualityGate
                    name="Complaint Rate"
                    current={data.emails.gates.complaint.current}
                    threshold={data.emails.gates.complaint.threshold}
                    unit="%"
                    status={data.emails.gates.complaint.status}
                  />
                  <QualityGate
                    name="Unsub Rate"
                    current={data.emails.gates.unsub.current}
                    threshold={data.emails.gates.unsub.threshold}
                    unit="%"
                    status={data.emails.gates.unsub.status}
                  />
                </div>
                <div className="mt-4 pt-4 border-t grid grid-cols-3 md:grid-cols-6 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-green-600">{data.emails.quality.deliveryRate}%</p>
                    <p className="text-xs text-gray-500">Delivery</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-600">{data.emails.quality.openRate}%</p>
                    <p className="text-xs text-gray-500">Open Rate</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-purple-600">{data.emails.quality.clickRate}%</p>
                    <p className="text-xs text-gray-500">Click Rate</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.emails.today.bounced}</p>
                    <p className="text-xs text-gray-500">Bounced</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.emails.today.complained}</p>
                    <p className="text-xs text-gray-500">Complaints</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{data.emails.today.unsubscribed}</p>
                    <p className="text-xs text-gray-500">Unsubs</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Hourly Volume */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Hourly Send Volume (Last 12h)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <HourlyChart data={data.hourlyVolume} />
                </CardContent>
              </Card>

              {/* Health Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    System Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Health Engine</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={data.health.status} />
                      <span className="text-xs text-gray-400">
                        {data.health.interval}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Last Check</span>
                    <span className="text-sm">{formatTime(data.health.lastCheck)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Warmup Limit</span>
                    <span className="text-sm font-mono">
                      {formatNumber(data.warmup.dailyLimit)}/day
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Warmup Status</span>
                    {data.warmup.paused ? (
                      <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                        PAUSED: {data.warmup.pausedReason || 'Unknown'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-100 text-green-800">
                        ACTIVE
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Fee Range</span>
                    <span className="text-sm font-mono">
                      ${data.campaign.feeRange.min.toLocaleString()} - ${data.campaign.feeRange.max.toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Regional Breakdown */}
            {data.regional && data.regional.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Regional Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {data.regional.map((r: any) => (
                      <div key={r.state} className="text-center p-3 bg-gray-50 rounded-lg">
                        <p className="font-bold text-lg">{r.state}</p>
                        <p className="text-sm text-gray-600">{r.count} leads</p>
                        <p className="text-xs text-gray-400">
                          ${Math.round((r.avg_value || 0) / 100).toLocaleString()} avg
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent Errors */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Recent Errors
                  {data.errors.length > 0 && (
                    <Badge variant="outline" className="bg-red-100 text-red-800 ml-2">
                      {data.errors.length}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.errors.length === 0 ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-5 w-5" />
                    <span>No errors</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.errors.map((e: any) => (
                      <div
                        key={e.id}
                        className="flex items-start gap-3 p-3 bg-red-50 rounded-lg"
                      >
                        <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{e.type}</span>
                            <span className="text-xs text-gray-500">{e.attempts}</span>
                          </div>
                          <p className="text-sm text-gray-600 truncate">{e.message}</p>
                          <p className="text-xs text-gray-400">{formatTime(e.when)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Job Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Job Queue Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {['pending', 'processing', 'completed', 'failed', 'dead'].map((status) => (
                    <div key={status} className="text-center p-3 bg-gray-50 rounded-lg">
                      <StatusBadge status={status} />
                      <p className="text-2xl font-bold mt-2">{data.jobs[status] || 0}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Last Updated */}
            <p className="text-center text-xs text-gray-400">
              Last updated: {new Date(data.timestamp).toLocaleString()}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
