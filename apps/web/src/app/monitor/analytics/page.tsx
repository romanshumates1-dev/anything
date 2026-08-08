'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface AnalyticsData {
  summary: {
    totalLeads: number;
    totalContacted: number;
    totalReplied: number;
    totalInterested: number;
    pipelineValue: number;
    avgDealValue: number;
    avgTouches: number;
  };
  rates: {
    response: string;
    interest: string;
    rejection: string;
  };
  costs: {
    totalCost: number;
    costPerContact: number;
    costPerReply: number;
    costPerInterest: number;
  };
  revenue: {
    totalRevenue: number;
    profit: number;
    roi: number;
  };
  regional: Array<{
    state: string;
    contacted: number;
    replied: number;
    interested: number;
    responseRate: number;
    avgDealValue: number;
    roi: number;
  }>;
  dailyTrend: Array<{
    date: string;
    contacted: number;
    replied: number;
    interested: number;
    responseRate: number;
  }>;
  sourcePerformance: Array<{
    source: string;
    totalLeads: number;
    contacted: number;
    replied: number;
    responseRate: number;
    qualityScore: number;
  }>;
  aiInsights: Array<{
    category: string;
    priority: string;
    title: string;
    description: string;
    metric: string;
    currentValue: string | number;
    benchmark: string | number;
    recommendation: string;
    potentialImpact: string;
  }>;
}

function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors = {
    critical: 'bg-rose-100 text-rose-700 border-rose-200',
    high: 'bg-amber-100 text-amber-700 border-amber-200',
    medium: 'bg-blue-100 text-blue-700 border-blue-200',
    low: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${colors[priority as keyof typeof colors] || colors.low}`}>
      {priority.toUpperCase()}
    </span>
  );
}

function CategoryIcon({ category }: { category: string }) {
  const icons = {
    warning: (
      <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    improvement: (
      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    opportunity: (
      <svg className="w-5 h-5 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  };
  return icons[category as keyof typeof icons] || icons.improvement;
}

export default function AdvancedAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/advanced?days=${days}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [days]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-12 h-12 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-purple-700 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Advanced Analytics</h1>
                <p className="text-sm text-slate-500">AI-Powered Campaign Insights</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <select
                value={days}
                onChange={e => setDays(parseInt(e.target.value))}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <Link href="/monitor" className="text-sm text-slate-600 hover:text-slate-900">Monitor</Link>
              <Link href="/monitor/profit" className="text-sm text-slate-600 hover:text-slate-900">Profit</Link>
            </div>
          </div>
        </div>
      </header>

      {data && (
        <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">

          {/* AI Insights */}
          {data.aiInsights && data.aiInsights.length > 0 && (
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Campaign Recommendations
              </h2>
              <div className="space-y-4">
                {data.aiInsights.map((insight, i) => (
                  <div key={i} className="border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        <CategoryIcon category={insight.category} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-slate-900">{insight.title}</h3>
                          <PriorityBadge priority={insight.priority} />
                        </div>
                        <p className="text-sm text-slate-600 mb-3">{insight.description}</p>

                        <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                          <div className="bg-slate-50 rounded-lg p-3">
                            <p className="text-slate-500 text-xs mb-1">{insight.metric}</p>
                            <p className="font-semibold text-slate-900">{insight.currentValue}</p>
                          </div>
                          <div className="bg-slate-50 rounded-lg p-3">
                            <p className="text-slate-500 text-xs mb-1">Benchmark</p>
                            <p className="font-semibold text-slate-900">{insight.benchmark}</p>
                          </div>
                        </div>

                        <div className="bg-violet-50 rounded-lg p-3 border border-violet-100">
                          <p className="text-xs text-violet-600 font-medium mb-1">Recommendation</p>
                          <p className="text-sm text-violet-900">{insight.recommendation}</p>
                        </div>

                        <p className="text-xs text-slate-500 mt-2">
                          <span className="font-medium">Potential Impact:</span> {insight.potentialImpact}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <p className="text-sm text-slate-500">Total Contacted</p>
              <p className="text-2xl font-bold text-slate-900">{data.summary.totalContacted.toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <p className="text-sm text-slate-500">Response Rate</p>
              <p className="text-2xl font-bold text-blue-600">{data.rates.response}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <p className="text-sm text-slate-500">Interest Rate</p>
              <p className="text-2xl font-bold text-violet-600">{data.rates.interest}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <p className="text-sm text-slate-500">Pipeline Value</p>
              <p className="text-2xl font-bold text-emerald-600">{formatCurrency(data.summary.pipelineValue)}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <p className="text-sm text-slate-500">Total Cost</p>
              <p className="text-2xl font-bold text-slate-900">{formatCurrency(data.costs.totalCost)}</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-slate-200">
              <p className="text-sm text-slate-500">ROI</p>
              <p className={`text-2xl font-bold ${data.revenue.roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {data.revenue.roi}%
              </p>
            </div>
          </div>

          {/* Regional Performance */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Regional Performance</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-2 font-medium text-slate-600">State</th>
                    <th className="text-right py-3 px-2 font-medium text-slate-600">Contacted</th>
                    <th className="text-right py-3 px-2 font-medium text-slate-600">Replied</th>
                    <th className="text-right py-3 px-2 font-medium text-slate-600">Interested</th>
                    <th className="text-right py-3 px-2 font-medium text-slate-600">Response %</th>
                    <th className="text-right py-3 px-2 font-medium text-slate-600">Avg Deal</th>
                    <th className="text-right py-3 px-2 font-medium text-slate-600">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {data.regional.slice(0, 10).map((r, i) => (
                    <tr key={r.state} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-2 font-medium">{r.state}</td>
                      <td className="py-3 px-2 text-right">{r.contacted.toLocaleString()}</td>
                      <td className="py-3 px-2 text-right">{r.replied}</td>
                      <td className="py-3 px-2 text-right">{r.interested}</td>
                      <td className="py-3 px-2 text-right">
                        <span className={r.responseRate >= 2 ? 'text-emerald-600' : r.responseRate >= 1 ? 'text-amber-600' : 'text-rose-600'}>
                          {r.responseRate.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right">{formatCurrency(r.avgDealValue)}</td>
                      <td className="py-3 px-2 text-right">
                        <span className={r.roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {r.roi.toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Lead Source Quality */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Lead Source Quality</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.sourcePerformance.slice(0, 6).map((source) => (
                <div key={source.source} className="border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-slate-900 capitalize">{source.source.replace(/_/g, ' ')}</h3>
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      source.qualityScore >= 70 ? 'bg-emerald-100 text-emerald-700' :
                      source.qualityScore >= 40 ? 'bg-amber-100 text-amber-700' :
                      'bg-rose-100 text-rose-700'
                    }`}>
                      Score: {source.qualityScore}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-slate-500">Leads</p>
                      <p className="font-medium">{source.totalLeads.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Contacted</p>
                      <p className="font-medium">{source.contacted.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Replied</p>
                      <p className="font-medium">{source.replied}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Response %</p>
                      <p className="font-medium">{source.responseRate}%</p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        source.qualityScore >= 70 ? 'bg-emerald-500' :
                        source.qualityScore >= 40 ? 'bg-amber-500' :
                        'bg-rose-500'
                      }`}
                      style={{ width: `${source.qualityScore}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Daily Trend Chart */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Daily Performance Trend</h2>
            <div className="h-64 flex items-end gap-1">
              {data.dailyTrend.slice(0, 30).reverse().map((day, i) => {
                const maxContacted = Math.max(...data.dailyTrend.map(d => d.contacted), 1);
                const height = (day.contacted / maxContacted) * 100;
                return (
                  <div
                    key={day.date}
                    className="flex-1 bg-blue-500 rounded-t hover:bg-blue-600 transition-colors relative group"
                    style={{ height: `${Math.max(height, 2)}%` }}
                  >
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                      {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      <br />
                      {day.contacted} contacted
                      <br />
                      {day.responseRate}% response
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-slate-500 mt-2">
              <span>{data.dailyTrend.length > 0 ? new Date(data.dailyTrend[data.dailyTrend.length - 1]?.date).toLocaleDateString() : ''}</span>
              <span>{data.dailyTrend.length > 0 ? new Date(data.dailyTrend[0]?.date).toLocaleDateString() : ''}</span>
            </div>
          </section>

        </main>
      )}
    </div>
  );
}
