'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MonitorData {
  timestamp: string;
  campaign: {
    status: string;
    dailyTarget: number;
    dailySent: number;
    progress: string;
    feeRange: { min: number; max: number };
  };
  jobs: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    dead: number;
    byType?: Record<string, number>;
  };
  queue: {
    queued: number;
    sent: number;
    completed: number;
  };
  emails: {
    today: {
      sent: number;
      delivered: number;
      opened: number;
      clicked: number;
      bounced: number;
      complained: number;
      unsubscribed: number;
    };
    quality: {
      bounceRate: string;
      complaintRate: string;
      unsubRate: string;
      deliveryRate: string;
      openRate: string;
      clickRate: string;
    };
    gates: {
      bounce: { threshold: number; current: number; status: string };
      complaint: { threshold: number; current: number; status: string };
      unsub: { threshold: number; current: number; status: string };
    };
  };
  warmup: {
    dailyLimit: number;
    paused: boolean;
    pausedReason?: string;
  };
  health: {
    status: string;
    lastCheck: string;
    healer?: string;
    interval?: string;
    metrics?: {
      pendingJobs: number;
      failedJobs: number;
      deadJobs: number;
      recentErrors: number;
      queuedLeads: number;
      isProcessing: boolean;
    };
  };
  errors: Array<{
    id: string;
    type: string;
    message: string;
    attempts: string;
    when: string;
  }>;
  hourlyVolume?: Array<{ hour: string; count: number }>;
  recentActivity?: Array<{ type: string; status: string; when: string }>;
  crm?: {
    leads: {
      total: number;
      with_email: number;
      with_phone: number;
      new_today: number;
      new_this_week: number;
      total_messages_sent: number;
      unique_leads_contacted: number;
      messages_pending: number;
    };
    conversion: {
      total_queued: number;
      awaiting_outreach: number;
      contacted: number;
      replied: number;
      interested: number;
      rejected: number;
      dead: number;
      touched_once: number;
      touched_twice: number;
      touched_thrice: number;
      contactRate: string;
      replyRate: string;
      interestRate: string;
      overallConversion: string;
    };
    pipeline: Record<string, number>;
    tiers: Record<string, { count: number; avgScore: number }>;
    regions: Array<{ region: string; count: number; avgValue: number }>;
  };
  funnel?: {
    stages: Array<{ name: string; count: number; color: string }>;
  };
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (!n) return '$0';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K';
  return '$' + n.toLocaleString();
}

function formatTime(date: string): string {
  if (!date) return '--';
  return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function QualityGate({ name, current, threshold, status }: { name: string; current: number; threshold: number; status: string }) {
  const isOk = status === 'ok';
  const pct = Math.min((current / threshold) * 100, 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-5 h-5 rounded-full flex items-center justify-center ${isOk ? 'bg-emerald-100' : 'bg-rose-100'}`}>
            {isOk ? (
              <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </span>
          <span className="text-sm font-medium text-slate-700">{name}</span>
        </div>
        <span className={`text-sm font-semibold ${isOk ? 'text-emerald-600' : 'text-rose-600'}`}>
          {current.toFixed(2)}% / {threshold}%
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isOk ? 'bg-emerald-500' : 'bg-rose-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = async () => {
    try {
      let res = await fetch('http://localhost:4001/api/campaigns/monitor').catch(() => null);
      if (!res || !res.ok) {
        res = await fetch('/api/campaigns/monitor');
      }
      if (!res.ok) throw new Error('API error: ' + res.status);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-slate-600 font-medium">Loading campaign data...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 bg-rose-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Connection Error</h2>
          <p className="text-slate-500 mb-6">{error || 'Unable to load data'}</p>
          <button onClick={fetchData} className="px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const allGatesOk = data.emails.gates.bounce.status === 'ok' &&
    data.emails.gates.complaint.status === 'ok' &&
    data.emails.gates.unsub.status === 'ok';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Campaign Monitor</h1>
                <p className="text-sm text-slate-500">Real-time performance tracking</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/monitor/pipeline" className="flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700 rounded-lg hover:bg-violet-100 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span className="text-sm font-medium">Pipeline</span>
              </Link>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
                <span className="text-sm font-medium text-slate-600">Live</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-blue-500 transition-colors">
                  <div className={`absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoRefresh ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-sm text-slate-600">Auto-refresh</span>
              </label>
              <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-sm font-medium text-slate-700">Refresh</span>
              </button>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${data.campaign.status === 'ACTIVE' ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
                <span className={`w-2 h-2 rounded-full ${data.campaign.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className={`text-sm font-semibold ${data.campaign.status === 'ACTIVE' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {data.campaign.status}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Alert Banner */}
      {(data.warmup.paused || data.errors.length > 0) && (
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium text-amber-800">
              {data.warmup.paused ? `Campaign paused: ${data.warmup.pausedReason || 'Check settings'}` : `${data.errors.length} error(s) detected`}
            </span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Hero Stats */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Progress Card */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Daily Progress</h2>
                <p className="text-sm text-slate-500">Emails sent toward 150K target</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-slate-900">{formatNumber(data.campaign.dailySent)}</p>
                <p className="text-sm text-slate-500">of 150,000</p>
              </div>
            </div>
            <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(parseFloat(data.campaign.progress), 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-400">
              <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </div>
            <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-100">
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-600">{formatNumber(data.emails.today.delivered)}</p>
                <p className="text-xs text-slate-500 mt-1">Delivered</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{formatNumber(data.emails.today.opened)}</p>
                <p className="text-xs text-slate-500 mt-1">Opened</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-violet-600">{formatNumber(data.emails.today.clicked)}</p>
                <p className="text-xs text-slate-500 mt-1">Clicked</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-amber-600">0</p>
                <p className="text-xs text-slate-500 mt-1">Replied</p>
              </div>
            </div>
          </div>

          {/* Campaign Info */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-lg p-6 text-white">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold">Campaign Settings</h3>
                <p className="text-sm text-slate-400">30-Day Multi-Regional</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-white/10">
                <span className="text-slate-400 text-sm">Assignment Fee</span>
                <span className="font-semibold">${formatNumber(data.campaign.feeRange.min)} - ${formatNumber(data.campaign.feeRange.max)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/10">
                <span className="text-slate-400 text-sm">Daily Limit</span>
                <span className="font-semibold">{formatNumber(data.warmup.dailyLimit)}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/10">
                <span className="text-slate-400 text-sm">Throttle</span>
                <span className="font-semibold">2,500/min</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-slate-400 text-sm">Send Window</span>
                <span className="font-semibold">8AM - 8PM ET</span>
              </div>
            </div>
          </div>
        </section>

        {/* Key Metrics */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'In Queue', value: data.queue.queued, color: 'blue', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
            { label: 'Jobs Completed', value: data.jobs.completed, color: 'emerald', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
            { label: 'Jobs Pending', value: data.jobs.pending, color: 'amber', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
            { label: 'Failed Jobs', value: data.jobs.failed + data.jobs.dead, color: 'rose', icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
          ].map((metric, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div className={`w-10 h-10 bg-${metric.color}-50 rounded-lg flex items-center justify-center`}>
                  <svg className={`w-5 h-5 text-${metric.color}-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={metric.icon} />
                  </svg>
                </div>
              </div>
              <p className="mt-4 text-2xl font-bold text-slate-900">{formatNumber(metric.value)}</p>
              <p className="text-sm text-slate-500">{metric.label}</p>
            </div>
          ))}
        </section>

        {/* Quality & Health */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Quality Gates */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Quality Gates</h3>
                <p className="text-sm text-slate-500">Keeping your reputation safe</p>
              </div>
            </div>
            <div className="space-y-5">
              <QualityGate name="Bounce Rate" current={data.emails.gates.bounce.current} threshold={data.emails.gates.bounce.threshold} status={data.emails.gates.bounce.status} />
              <QualityGate name="Complaint Rate" current={data.emails.gates.complaint.current} threshold={data.emails.gates.complaint.threshold} status={data.emails.gates.complaint.status} />
              <QualityGate name="Unsubscribe Rate" current={data.emails.gates.unsub.current} threshold={data.emails.gates.unsub.threshold} status={data.emails.gates.unsub.status} />
            </div>
            <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-between">
              <span className="text-sm text-slate-500">Overall Health</span>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold ${allGatesOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {allGatesOk ? 'Excellent' : 'Needs Attention'}
                </span>
                <svg className={`w-5 h-5 ${allGatesOk ? 'text-emerald-500' : 'text-amber-500'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">System Status</h3>
                <p className="text-sm text-slate-500">Infrastructure health</p>
              </div>
            </div>
            <div className="space-y-3">
              {[
                {
                  label: 'Health Status',
                  value: data.health.status === 'healthy' ? 'Healthy'
                       : data.health.status === 'working' ? 'Working'
                       : data.health.status === 'idle' ? 'Idle'
                       : data.health.status === 'warning' ? 'Warning'
                       : 'Issues',
                  isGood: ['healthy', 'working', 'idle'].includes(data.health.status),
                  isWarning: data.health.status === 'warning',
                },
                {
                  label: 'Pipeline Healer',
                  value: data.health.healer === 'active' ? 'Active' : 'Needs Attention',
                  isGood: data.health.healer === 'active',
                },
                {
                  label: 'Email Warmup',
                  value: data.warmup.paused ? 'Paused' : 'Active',
                  isGood: !data.warmup.paused,
                },
                {
                  label: 'Processing',
                  value: data.health.metrics?.isProcessing ? 'Active' : 'Idle',
                  isGood: true,
                },
                {
                  label: 'Pending Jobs',
                  value: (data.health.metrics?.pendingJobs || data.jobs.pending || 0).toLocaleString(),
                  isGood: true,
                },
                {
                  label: 'Failed Jobs',
                  value: (data.health.metrics?.failedJobs || data.jobs.failed || 0).toLocaleString(),
                  isGood: (data.health.metrics?.failedJobs || data.jobs.failed || 0) < 10,
                },
                {
                  label: 'Last Check',
                  value: formatTime(data.health.lastCheck || data.timestamp),
                  isGood: true,
                },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      item.isGood ? 'bg-emerald-500' : item.isWarning ? 'bg-amber-500' : 'bg-rose-500'
                    }`} />
                    <span className="text-sm font-medium text-slate-700">{item.label}</span>
                  </div>
                  <span className={`text-sm font-medium ${
                    item.isGood ? 'text-emerald-600' : item.isWarning ? 'text-amber-600' : 'text-rose-600'
                  }`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Job Pipeline */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-900 mb-6">Job Pipeline</h3>
          <div className="flex items-center justify-between gap-2">
            {[
              { label: 'PENDING', value: data.jobs.pending, color: 'blue' },
              { label: 'PROCESSING', value: data.jobs.processing, color: 'amber' },
              { label: 'COMPLETED', value: data.jobs.completed, color: 'emerald' },
              { label: 'FAILED', value: data.jobs.failed + data.jobs.dead, color: 'rose' },
            ].map((stage, i) => (
              <div key={i} className="flex-1 flex items-center">
                <div className={`flex-1 text-center p-4 bg-${stage.color}-50 rounded-xl border-2 border-${stage.color}-200`}>
                  <p className={`text-3xl font-bold text-${stage.color}-600`}>{stage.value}</p>
                  <p className={`text-xs font-medium text-${stage.color}-600 mt-1`}>{stage.label}</p>
                </div>
                {i < 3 && (
                  <svg className="w-6 h-6 text-slate-300 flex-shrink-0 mx-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                )}
              </div>
            ))}
          </div>
          {data.jobs.byType && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h4 className="text-sm font-medium text-slate-500 mb-4">Job Types</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(data.jobs.byType).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-600">{type.replace(/_/g, ' ')}</span>
                    <span className="text-sm font-semibold text-slate-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Hourly Volume Chart & Activity Feed */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Hourly Volume */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Hourly Volume</h3>
                <p className="text-sm text-slate-500">Jobs completed per hour (last 24h)</p>
              </div>
            </div>
            {data.hourlyVolume && data.hourlyVolume.length > 0 ? (
              <div className="space-y-2">
                {data.hourlyVolume.slice(0, 12).map((h, i) => {
                  const maxCount = Math.max(...data.hourlyVolume!.map(x => x.count), 1);
                  const pct = (h.count / maxCount) * 100;
                  const hour = new Date(h.hour).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-16">{hour}</span>
                      <div className="flex-1 h-4 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-400 to-indigo-600 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-slate-700 w-8 text-right">{h.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <p>No hourly data yet</p>
              </div>
            )}
          </div>

          {/* Recent Activity Feed */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-cyan-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Recent Activity</h3>
                <p className="text-sm text-slate-500">Live job activity feed</p>
              </div>
            </div>
            {data.recentActivity && data.recentActivity.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {data.recentActivity.map((a, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        a.status === 'completed' ? 'bg-emerald-500' :
                        a.status === 'pending' ? 'bg-amber-500' :
                        a.status === 'processing' ? 'bg-blue-500' :
                        'bg-rose-500'
                      }`} />
                      <span className="text-sm text-slate-700">{a.type.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        a.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                        a.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        a.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>{a.status}</span>
                      <span className="text-xs text-slate-400">{formatTime(a.when)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p>No recent activity</p>
              </div>
            )}
          </div>
        </section>

        {/* Conversion Funnel */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Conversion Funnel</h3>
              <p className="text-sm text-slate-500">Email engagement pipeline</p>
            </div>
          </div>
          <div className="flex items-end justify-between gap-2">
            {[
              { label: 'Sent', value: data.emails.today.sent, color: 'blue', pct: 100 },
              { label: 'Delivered', value: data.emails.today.delivered, color: 'cyan', pct: data.emails.today.sent > 0 ? (data.emails.today.delivered / data.emails.today.sent) * 100 : 0 },
              { label: 'Opened', value: data.emails.today.opened, color: 'violet', pct: data.emails.today.sent > 0 ? (data.emails.today.opened / data.emails.today.sent) * 100 : 0 },
              { label: 'Clicked', value: data.emails.today.clicked, color: 'emerald', pct: data.emails.today.sent > 0 ? (data.emails.today.clicked / data.emails.today.sent) * 100 : 0 },
            ].map((stage, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div className={`w-full bg-${stage.color}-100 rounded-t-lg transition-all duration-500`} style={{ height: `${Math.max(stage.pct * 2, 10)}px` }}>
                  <div className={`w-full h-full bg-gradient-to-t from-${stage.color}-500 to-${stage.color}-400 rounded-t-lg opacity-80`} />
                </div>
                <div className="text-center mt-3">
                  <p className={`text-xl font-bold text-${stage.color}-600`}>{formatNumber(stage.value)}</p>
                  <p className="text-xs text-slate-500">{stage.label}</p>
                  {i > 0 && <p className="text-xs text-slate-400 mt-1">{stage.pct.toFixed(1)}%</p>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Email Performance Rates */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Performance Rates</h3>
              <p className="text-sm text-slate-500">Key email metrics</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Delivery Rate', value: data.emails.quality.deliveryRate, suffix: '%', good: parseFloat(data.emails.quality.deliveryRate) > 95 },
              { label: 'Open Rate', value: data.emails.quality.openRate, suffix: '%', good: parseFloat(data.emails.quality.openRate) > 20 },
              { label: 'Click Rate', value: data.emails.quality.clickRate, suffix: '%', good: parseFloat(data.emails.quality.clickRate) > 2 },
              { label: 'Bounce Rate', value: data.emails.quality.bounceRate, suffix: '%', good: parseFloat(data.emails.quality.bounceRate) < 2 },
              { label: 'Complaint Rate', value: data.emails.quality.complaintRate, suffix: '%', good: parseFloat(data.emails.quality.complaintRate) < 0.1 },
              { label: 'Unsub Rate', value: data.emails.quality.unsubRate, suffix: '%', good: parseFloat(data.emails.quality.unsubRate) < 1 },
            ].map((rate, i) => (
              <div key={i} className="text-center p-4 bg-slate-50 rounded-xl">
                <p className={`text-2xl font-bold ${rate.good ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {rate.value}{rate.suffix}
                </p>
                <p className="text-xs text-slate-500 mt-1">{rate.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CRM & Conversion Analytics */}
        {data.crm && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Conversion Funnel */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Conversion Funnel</h3>
                  <p className="text-sm text-slate-500">Lead progression tracking</p>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Total Leads', value: data.crm.leads.total, pct: 100, color: 'bg-slate-500' },
                  { label: 'In Queue', value: data.crm.conversion.total_queued, pct: data.crm.leads.total > 0 ? (data.crm.conversion.total_queued / data.crm.leads.total) * 100 : 0, color: 'bg-blue-500' },
                  { label: 'Contacted', value: data.crm.conversion.contacted, pct: data.crm.leads.total > 0 ? (data.crm.conversion.contacted / data.crm.leads.total) * 100 : 0, color: 'bg-cyan-500' },
                  { label: 'Replied', value: data.crm.conversion.replied, pct: data.crm.leads.total > 0 ? (data.crm.conversion.replied / data.crm.leads.total) * 100 : 0, color: 'bg-violet-500' },
                  { label: 'Interested', value: data.crm.conversion.interested, pct: data.crm.leads.total > 0 ? (data.crm.conversion.interested / data.crm.leads.total) * 100 : 0, color: 'bg-emerald-500' },
                ].map((stage, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-700">{stage.label}</span>
                      <span className="text-sm font-bold text-slate-900">{formatNumber(stage.value)}</span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${stage.color} rounded-full transition-all duration-500`} style={{ width: `${Math.max(stage.pct, 1)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-600">{data.crm.conversion.overallConversion}%</p>
                  <p className="text-xs text-slate-500">Overall Conversion</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-violet-600">{data.crm.conversion.replyRate}%</p>
                  <p className="text-xs text-slate-500">Reply Rate</p>
                </div>
              </div>
            </div>

            {/* Conversion Rates Breakdown */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Conversion Rates</h3>
                  <p className="text-sm text-slate-500">Stage-by-stage performance</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Contact Rate', value: data.crm.conversion.contactRate, desc: 'Queued → Contacted', good: parseFloat(data.crm.conversion.contactRate) > 80 },
                  { label: 'Reply Rate', value: data.crm.conversion.replyRate, desc: 'Contacted → Replied', good: parseFloat(data.crm.conversion.replyRate) > 5 },
                  { label: 'Interest Rate', value: data.crm.conversion.interestRate, desc: 'Replied → Interested', good: parseFloat(data.crm.conversion.interestRate) > 20 },
                  { label: 'Overall', value: data.crm.conversion.overallConversion, desc: 'Lead → Interested', good: parseFloat(data.crm.conversion.overallConversion) > 1 },
                ].map((rate, i) => (
                  <div key={i} className="p-4 bg-slate-50 rounded-xl">
                    <p className={`text-2xl font-bold ${rate.good ? 'text-emerald-600' : 'text-amber-600'}`}>{rate.value}%</p>
                    <p className="text-sm font-medium text-slate-700">{rate.label}</p>
                    <p className="text-xs text-slate-400">{rate.desc}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-4 bg-slate-50 rounded-xl">
                <h4 className="text-sm font-medium text-slate-700 mb-3">Touch Points</h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-slate-900">{formatNumber(data.crm.conversion.touched_once)}</p>
                    <p className="text-xs text-slate-500">1 Touch</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-900">{formatNumber(data.crm.conversion.touched_twice)}</p>
                    <p className="text-xs text-slate-500">2 Touches</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-900">{formatNumber(data.crm.conversion.touched_thrice)}</p>
                    <p className="text-xs text-slate-500">3 Touches</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Lead Tiers & Regional Performance */}
        {data.crm && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Tier Breakdown */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Lead Tiers</h3>
                  <p className="text-sm text-slate-500">Quality distribution</p>
                </div>
              </div>
              <div className="space-y-4">
                {[
                  { tier: 'hot', label: 'Hot Leads', emoji: '🔥', color: 'bg-rose-500', bgLight: 'bg-rose-50' },
                  { tier: 'warm', label: 'Warm Leads', emoji: '☀️', color: 'bg-amber-500', bgLight: 'bg-amber-50' },
                  { tier: 'cold', label: 'Cold Leads', emoji: '❄️', color: 'bg-blue-500', bgLight: 'bg-blue-50' },
                ].map((t) => {
                  const tierData = data.crm?.tiers[t.tier];
                  const total = Object.values(data.crm?.tiers || {}).reduce((sum, v) => sum + (v?.count || 0), 0);
                  const pct = total > 0 ? ((tierData?.count || 0) / total) * 100 : 0;
                  return (
                    <div key={t.tier} className={`p-4 ${t.bgLight} rounded-xl`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{t.emoji}</span>
                          <span className="font-medium text-slate-700">{t.label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-slate-900">{formatNumber(tierData?.count || 0)}</span>
                          <span className="text-sm text-slate-500 ml-1">({pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Avg Score</span>
                        <span className="font-medium text-slate-700">{tierData?.avgScore || 0}/100</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Regional Performance */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Regional Performance</h3>
                  <p className="text-sm text-slate-500">Leads by market</p>
                </div>
              </div>
              <div className="space-y-3 max-h-[300px] overflow-y-auto">
                {(data.crm?.regions || []).map((r, i) => {
                  const maxCount = Math.max(...(data.crm?.regions || []).map(x => x.count), 1);
                  const pct = (r.count / maxCount) * 100;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-700 w-10">{r.region}</span>
                      <div className="flex-1 h-6 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full flex items-center justify-end pr-2" style={{ width: `${pct}%` }}>
                          {pct > 30 && <span className="text-xs text-white font-medium">{formatNumber(r.count)}</span>}
                        </div>
                      </div>
                      {pct <= 30 && <span className="text-sm font-medium text-slate-700">{formatNumber(r.count)}</span>}
                      <span className="text-xs text-slate-400 w-20 text-right">{formatCurrency(r.avgValue)} avg</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Lead Database & Messaging Stats */}
        {data.crm && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Lead Database & Messaging</h3>
                <p className="text-sm text-slate-500">Contacts and outreach metrics</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
              {[
                { label: 'Total Leads', value: data.crm.leads.total, color: 'text-slate-900', bg: 'bg-slate-50' },
                { label: 'With Email', value: data.crm.leads.with_email, color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'With Phone', value: data.crm.leads.with_phone, color: 'text-violet-600', bg: 'bg-violet-50' },
                { label: 'Messages Sent', value: data.crm.leads.total_messages_sent || 0, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Leads Contacted', value: data.crm.leads.unique_leads_contacted || 0, color: 'text-cyan-600', bg: 'bg-cyan-50' },
                { label: 'Pending Send', value: data.crm.leads.messages_pending || 0, color: 'text-amber-600', bg: 'bg-amber-50' },
                { label: 'New Today', value: data.crm.leads.new_today, color: 'text-rose-600', bg: 'bg-rose-50' },
                { label: 'This Week', value: data.crm.leads.new_this_week, color: 'text-indigo-600', bg: 'bg-indigo-50' },
              ].map((stat, i) => (
                <div key={i} className={`text-center p-4 ${stat.bg} rounded-xl`}>
                  <p className={`text-2xl font-bold ${stat.color}`}>{formatNumber(stat.value)}</p>
                  <p className="text-xs text-slate-500 mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
            {/* Messaging Efficiency */}
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">
                  {data.crm.leads.total > 0 ? ((data.crm.leads.unique_leads_contacted || 0) / data.crm.leads.total * 100).toFixed(1) : 0}%
                </p>
                <p className="text-xs text-slate-500">Contact Rate</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">
                  {(data.crm.leads.unique_leads_contacted || 0) > 0 ? ((data.crm.leads.total_messages_sent || 0) / (data.crm.leads.unique_leads_contacted || 1)).toFixed(1) : 0}
                </p>
                <p className="text-xs text-slate-500">Avg Messages/Lead</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-slate-900">
                  {formatNumber((data.crm.leads.total_messages_sent || 0) + (data.crm.leads.messages_pending || 0))}
                </p>
                <p className="text-xs text-slate-500">Total Outreach</p>
              </div>
            </div>
          </section>
        )}

        {/* Errors */}
        {data.errors.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900">Recent Errors</h3>
            </div>
            <div className="space-y-3">
              {data.errors.map((err) => (
                <div key={err.id} className="flex items-start gap-3 p-4 bg-rose-50 rounded-xl border border-rose-100">
                  <svg className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-rose-900">{err.type}</span>
                      <span className="text-xs text-rose-600 bg-rose-100 px-2 py-0.5 rounded">{err.attempts}</span>
                    </div>
                    <p className="text-sm text-rose-700 mt-1 break-words">{err.message}</p>
                    <p className="text-xs text-rose-500 mt-1">{formatTime(err.when)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="flex items-center justify-between pt-6 border-t border-slate-200 text-sm text-slate-400">
          <span>Last synced: {formatTime(data.timestamp)}</span>
          <span>DealFlow AI Campaign Monitor</span>
        </footer>
      </main>
    </div>
  );
}
