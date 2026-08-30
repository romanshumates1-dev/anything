'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ProfitData {
  summary: {
    totalSpend: number;
    totalRevenue: number;
    profit: number;
    roi: number;
    pipelineValue: number;
    projectedProfit: number;
  };
  costs: {
    email: { count: number; cost: number };
    sms: { count: number; cost: number };
    total: number;
    perContact: number;
    perDeal: number;
  };
  funnel: {
    queued: number;
    contacted: number;
    replied: number;
    interested: number;
    won: number;
    rates: {
      reply: number;
      interest: number;
      close: number;
      overall: number;
    };
  };
  breakEven: {
    dealsNeeded: number;
    contactsPerDeal: number;
    costPerDeal: number;
    avgDealValue: number;
    atCurrentRate: {
      contactsNeeded: number;
      estimatedCost: number;
    };
  };
  scenarios: {
    worst: { label: string; value: number; description: string };
    breakEven: { label: string; deals: number; value: number; description: string };
    current: { label: string; deals: number; value: number; description: string };
    projected: { label: string; deals: number; value: number; description: string };
    best: { label: string; deals: number; value: number; description: string };
  };
  updatedAt: string;
}

function formatCurrency(value: number): string {
  if (value < 0) return '-$' + Math.abs(value).toLocaleString();
  return '$' + value.toLocaleString();
}

function formatPercent(value: number): string {
  return value.toFixed(1) + '%';
}

function ProfitGauge({ value, min, max, breakEven }: { value: number; min: number; max: number; breakEven: number }) {
  const range = max - min;
  const position = Math.max(0, Math.min(100, ((value - min) / range) * 100));
  const breakEvenPos = Math.max(0, Math.min(100, ((breakEven - min) / range) * 100));

  return (
    <div className="relative h-8 bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 rounded-full overflow-hidden">
      <div
        className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
        style={{ left: `${breakEvenPos}%` }}
      />
      <div
        className="absolute top-1 bottom-1 w-4 h-6 bg-white rounded-full shadow-lg border-2 border-slate-800"
        style={{ left: `calc(${position}% - 8px)` }}
      />
      <div className="absolute -bottom-6 text-xs text-slate-500" style={{ left: `${breakEvenPos}%`, transform: 'translateX(-50%)' }}>
        Break Even
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, isActive }: { scenario: { label: string; value: number; deals?: number; description: string }; isActive?: boolean }) {
  const isPositive = scenario.value >= 0;

  return (
    <div className={`p-4 rounded-xl border-2 transition-all ${isActive ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-600">{scenario.label}</span>
        {scenario.deals !== undefined && (
          <span className="text-xs px-2 py-0.5 bg-slate-100 rounded-full">{scenario.deals} deals</span>
        )}
      </div>
      <p className={`text-2xl font-bold ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
        {formatCurrency(scenario.value)}
      </p>
      <p className="text-xs text-slate-500 mt-1">{scenario.description}</p>
    </div>
  );
}

export default function ProfitDashboard() {
  const [data, setData] = useState<ProfitData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/campaigns/profit');
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
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
          <p className="text-slate-600 font-medium">Loading profit data...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <p className="text-slate-600">Failed to load data</p>
          <button onClick={fetchData} className="mt-4 px-4 py-2 bg-violet-600 text-white rounded-lg">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { summary, costs, funnel, breakEven, scenarios } = data;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Profit Calculator</h1>
                <p className="text-sm text-slate-500">Campaign ROI & Break-Even Analysis</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/monitor" className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Campaign Monitor
              </Link>
              <Link href="/monitor/pipeline" className="text-sm text-slate-600 hover:text-slate-900">
                Pipeline
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Profit Summary */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="text-center p-4 bg-slate-50 rounded-xl">
              <p className="text-sm text-slate-500 mb-1">Total Spend</p>
              <p className="text-3xl font-bold text-slate-900">{formatCurrency(summary.totalSpend)}</p>
            </div>
            <div className="text-center p-4 bg-slate-50 rounded-xl">
              <p className="text-sm text-slate-500 mb-1">Revenue</p>
              <p className="text-3xl font-bold text-emerald-600">{formatCurrency(summary.totalRevenue)}</p>
            </div>
            <div className="text-center p-4 bg-slate-50 rounded-xl">
              <p className="text-sm text-slate-500 mb-1">Net Profit</p>
              <p className={`text-3xl font-bold ${summary.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(summary.profit)}
              </p>
            </div>
            <div className="text-center p-4 bg-slate-50 rounded-xl">
              <p className="text-sm text-slate-500 mb-1">ROI</p>
              <p className={`text-3xl font-bold ${summary.roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatPercent(summary.roi)}
              </p>
            </div>
          </div>

          {/* Profit Gauge */}
          <div className="mb-12">
            <h3 className="text-sm font-medium text-slate-700 mb-4">Profit Position</h3>
            <ProfitGauge
              value={summary.profit}
              min={-summary.totalSpend * 2}
              max={summary.pipelineValue}
              breakEven={0}
            />
            <div className="flex justify-between mt-8 text-xs text-slate-500">
              <span>Max Loss: {formatCurrency(-summary.totalSpend)}</span>
              <span>Pipeline: {formatCurrency(summary.pipelineValue)}</span>
            </div>
          </div>
        </section>

        {/* Scenarios */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Profit Scenarios</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <ScenarioCard scenario={scenarios.worst} />
            <ScenarioCard scenario={scenarios.breakEven} />
            <ScenarioCard scenario={scenarios.current} isActive />
            <ScenarioCard scenario={scenarios.projected} />
            <ScenarioCard scenario={scenarios.best} />
          </div>
        </section>

        {/* Cost Breakdown & Funnel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cost Breakdown */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Cost Breakdown</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">Email (AWS SES)</p>
                    <p className="text-xs text-slate-500">{costs.email.count.toLocaleString()} sent</p>
                  </div>
                </div>
                <p className="font-semibold text-slate-900">{formatCurrency(costs.email.cost)}</p>
              </div>

              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-slate-900">SMS/RCS (AWS)</p>
                    <p className="text-xs text-slate-500">{costs.sms.count.toLocaleString()} sent</p>
                  </div>
                </div>
                <p className="font-semibold text-slate-900">{formatCurrency(costs.sms.cost)}</p>
              </div>

              <div className="border-t border-slate-200 pt-4 mt-4">
                <div className="flex justify-between mb-2">
                  <span className="text-slate-600">Cost per Contact</span>
                  <span className="font-medium">${costs.perContact.toFixed(4)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Est. Cost per Deal</span>
                  <span className="font-medium">{formatCurrency(costs.perDeal)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Conversion Funnel */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Conversion Funnel</h2>
            <div className="space-y-3">
              {[
                { label: 'Queued', value: funnel.queued, color: 'bg-slate-400', width: 100 },
                { label: 'Contacted', value: funnel.contacted, color: 'bg-blue-500', width: funnel.queued > 0 ? (funnel.contacted / funnel.queued) * 100 : 0 },
                { label: 'Replied', value: funnel.replied, color: 'bg-cyan-500', width: funnel.contacted > 0 ? (funnel.replied / funnel.contacted) * 100 : 0, rate: funnel.rates.reply },
                { label: 'Interested', value: funnel.interested, color: 'bg-violet-500', width: funnel.replied > 0 ? (funnel.interested / funnel.replied) * 100 : 0, rate: funnel.rates.interest },
                { label: 'Won', value: funnel.won, color: 'bg-emerald-500', width: funnel.interested > 0 ? (funnel.won / funnel.interested) * 100 : 0, rate: funnel.rates.close },
              ].map((stage, i) => (
                <div key={stage.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">{stage.label}</span>
                    <span className="font-medium">
                      {stage.value.toLocaleString()}
                      {stage.rate !== undefined && <span className="text-slate-400 ml-2">({formatPercent(stage.rate)})</span>}
                    </span>
                  </div>
                  <div className="h-6 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${stage.color} transition-all duration-500`}
                      style={{ width: `${Math.max(stage.width, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-emerald-50 rounded-xl">
              <div className="flex justify-between items-center">
                <span className="text-emerald-700 font-medium">Overall Conversion</span>
                <span className="text-2xl font-bold text-emerald-600">{formatPercent(funnel.rates.overall)}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Break-Even Analysis */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Break-Even Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-amber-50 rounded-xl text-center">
              <p className="text-sm text-amber-700 mb-1">Deals to Break Even</p>
              <p className="text-3xl font-bold text-amber-600">{breakEven.dealsNeeded}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl text-center">
              <p className="text-sm text-slate-600 mb-1">Contacts per Deal</p>
              <p className="text-3xl font-bold text-slate-900">{breakEven.contactsPerDeal.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl text-center">
              <p className="text-sm text-slate-600 mb-1">Avg Deal Value</p>
              <p className="text-3xl font-bold text-slate-900">{formatCurrency(breakEven.avgDealValue)}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-xl text-center">
              <p className="text-sm text-slate-600 mb-1">Cost per Deal</p>
              <p className="text-3xl font-bold text-slate-900">{formatCurrency(breakEven.costPerDeal)}</p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center text-sm text-slate-500 py-4">
          Last updated: {new Date(data.updatedAt).toLocaleString()}
        </div>
      </main>
    </div>
  );
}
