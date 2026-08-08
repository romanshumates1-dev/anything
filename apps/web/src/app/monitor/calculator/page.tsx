'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface CalculatorResult {
  input: {
    leadSource: string;
    touchCount: number;
    useAiOptimization: boolean;
    targetDeals: number;
    channels: string[];
    avgDealValue: number;
  };
  conversionFunnel: {
    responseRate: number;
    responseToInterested: number;
    interestedToAppointment: number;
    appointmentToContract: number;
    contractToClose: number;
    totalConversion: number;
    totalConversionPercent: string;
  };
  projections: {
    contactsPerDeal: number;
    totalContactsNeeded: number;
    contactsRange: {
      optimistic: number;
      expected: number;
      conservative: number;
    };
  };
  costs: {
    costPerContact: number;
    costPerDeal: number;
    totalCost: number;
  };
  revenue: {
    avgDealValue: number;
    totalRevenue: number;
    profit: number;
    roi: number;
    roiMultiple: number;
  };
  breakEven: {
    dealsNeeded: number;
    contactsNeeded: number;
    costToBreakEven: number;
  };
  timeline: {
    daysToContact: number;
    avgDealClosingDays: number;
    totalEstimatedDays: number;
  };
  systemData?: {
    sampleSize?: number;
    observedResponseRate?: number;
    dataUsed: boolean;
  };
}

function formatCurrency(value: number): string {
  if (value < 0) return '-$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatPercent(value: number, decimals = 2): string {
  return (value * 100).toFixed(decimals) + '%';
}

export default function OutreachCalculator() {
  const [result, setResult] = useState<CalculatorResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Form state
  const [leadSource, setLeadSource] = useState<string>('motivatedSeller');
  const [touchCount, setTouchCount] = useState<number>(3);
  const [useAi, setUseAi] = useState<boolean>(true);
  const [targetDeals, setTargetDeals] = useState<number>(1);
  const [channels, setChannels] = useState<string[]>(['email', 'sms']);
  const [avgDealValue, setAvgDealValue] = useState<number>(12500);

  const calculate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns/outreach-calculator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadSource,
          touchCount,
          useAiOptimization: useAi,
          targetDeals,
          channels,
          avgDealValue,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      }
    } catch (err) {
      console.error('Calculation error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    calculate();
  }, []);

  const toggleChannel = (channel: string) => {
    setChannels(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Outreach Calculator</h1>
                <p className="text-sm text-slate-500">Contacts to Assignment Contract</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/monitor" className="text-sm text-slate-600 hover:text-slate-900">Monitor</Link>
              <Link href="/monitor/profit" className="text-sm text-slate-600 hover:text-slate-900">Profit</Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Input Panel */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-6">Parameters</h2>

            <div className="space-y-5">
              {/* Lead Source */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Lead Source Quality</label>
                <select
                  value={leadSource}
                  onChange={e => setLeadSource(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="coldList">Cold List (0.5% response)</option>
                  <option value="warmList">Warm List (1.5% response)</option>
                  <option value="motivatedSeller">Motivated Seller (2.5% response)</option>
                  <option value="highDistress">High Distress (4.0% response)</option>
                </select>
              </div>

              {/* Touch Count */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Follow-up Sequence: {touchCount} touches
                </label>
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={touchCount}
                  onChange={e => setTouchCount(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>1</span>
                  <span>5</span>
                </div>
              </div>

              {/* Channels */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Outreach Channels</label>
                <div className="grid grid-cols-2 gap-2">
                  {['email', 'sms', 'rcs', 'directMail'].map(ch => (
                    <button
                      key={ch}
                      onClick={() => toggleChannel(ch)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        channels.includes(ch)
                          ? 'bg-blue-50 border-blue-500 text-blue-700'
                          : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                      }`}
                    >
                      {ch === 'directMail' ? 'Direct Mail' : ch.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Optimization */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">AI Message Optimization</span>
                <button
                  onClick={() => setUseAi(!useAi)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${useAi ? 'bg-blue-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${useAi ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              {/* Target Deals */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Target Deals</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={targetDeals}
                  onChange={e => setTargetDeals(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Avg Deal Value */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Avg Assignment Fee: {formatCurrency(avgDealValue)}
                </label>
                <input
                  type="range"
                  min="5000"
                  max="50000"
                  step="1000"
                  value={avgDealValue}
                  onChange={e => setAvgDealValue(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>$5K</span>
                  <span>$50K</span>
                </div>
              </div>

              <button
                onClick={calculate}
                disabled={loading || channels.length === 0}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Calculating...' : 'Calculate'}
              </button>
            </div>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-2 space-y-6">
            {result && (
              <>
                {/* Key Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <p className="text-sm text-slate-500">Contacts Per Deal</p>
                    <p className="text-2xl font-bold text-slate-900">{result.projections.contactsPerDeal.toLocaleString()}</p>
                  </div>
                  <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <p className="text-sm text-slate-500">Cost Per Deal</p>
                    <p className="text-2xl font-bold text-slate-900">{formatCurrency(result.costs.costPerDeal)}</p>
                  </div>
                  <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <p className="text-sm text-slate-500">Expected Profit</p>
                    <p className={`text-2xl font-bold ${result.revenue.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatCurrency(result.revenue.profit)}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <p className="text-sm text-slate-500">ROI</p>
                    <p className={`text-2xl font-bold ${result.revenue.roi >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {result.revenue.roi.toFixed(0)}%
                    </p>
                  </div>
                </div>

                {/* Conversion Funnel */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Conversion Funnel</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Contact', rate: 1, count: result.projections.totalContactsNeeded, color: 'bg-slate-400' },
                      { label: 'Response', rate: result.conversionFunnel.responseRate, count: Math.round(result.projections.totalContactsNeeded * result.conversionFunnel.responseRate), color: 'bg-blue-500' },
                      { label: 'Interested', rate: result.conversionFunnel.responseRate * result.conversionFunnel.responseToInterested, count: Math.round(result.projections.totalContactsNeeded * result.conversionFunnel.responseRate * result.conversionFunnel.responseToInterested), color: 'bg-cyan-500' },
                      { label: 'Appointment', rate: result.conversionFunnel.responseRate * result.conversionFunnel.responseToInterested * result.conversionFunnel.interestedToAppointment, count: Math.round(result.projections.totalContactsNeeded * result.conversionFunnel.responseRate * result.conversionFunnel.responseToInterested * result.conversionFunnel.interestedToAppointment), color: 'bg-violet-500' },
                      { label: 'Contract', rate: result.conversionFunnel.totalConversion / result.conversionFunnel.contractToClose, count: Math.round(result.projections.totalContactsNeeded * result.conversionFunnel.totalConversion / result.conversionFunnel.contractToClose), color: 'bg-amber-500' },
                      { label: 'Closed Deal', rate: result.conversionFunnel.totalConversion, count: targetDeals, color: 'bg-emerald-500' },
                    ].map((stage, i) => (
                      <div key={stage.label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-slate-600">{stage.label}</span>
                          <span className="font-medium">{stage.count.toLocaleString()} ({formatPercent(stage.rate)})</span>
                        </div>
                        <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${stage.color} transition-all duration-500`}
                            style={{ width: `${Math.max(stage.rate * 100, 1)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 p-4 bg-blue-50 rounded-xl">
                    <div className="flex justify-between items-center">
                      <span className="text-blue-700 font-medium">Overall Conversion Rate</span>
                      <span className="text-xl font-bold text-blue-600">{result.conversionFunnel.totalConversionPercent}</span>
                    </div>
                  </div>
                </div>

                {/* Projections Range */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Contacts Needed (95% Confidence)</h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="p-4 bg-emerald-50 rounded-xl">
                      <p className="text-sm text-emerald-700">Optimistic</p>
                      <p className="text-2xl font-bold text-emerald-600">{result.projections.contactsRange.optimistic.toLocaleString()}</p>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-xl border-2 border-blue-200">
                      <p className="text-sm text-blue-700">Expected</p>
                      <p className="text-2xl font-bold text-blue-600">{result.projections.contactsRange.expected.toLocaleString()}</p>
                    </div>
                    <div className="p-4 bg-amber-50 rounded-xl">
                      <p className="text-sm text-amber-700">Conservative</p>
                      <p className="text-2xl font-bold text-amber-600">{result.projections.contactsRange.conservative.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* Cost & Timeline */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Cost Breakdown</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Per Contact</span>
                        <span className="font-medium">${result.costs.costPerContact.toFixed(4)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Per Deal</span>
                        <span className="font-medium">{formatCurrency(result.costs.costPerDeal)}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-200 pt-3">
                        <span className="text-slate-900 font-medium">Total Campaign Cost</span>
                        <span className="font-bold text-slate-900">{formatCurrency(result.costs.totalCost)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    <h3 className="text-lg font-semibold text-slate-900 mb-4">Timeline</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Days to Contact All</span>
                        <span className="font-medium">{result.timeline.daysToContact} days</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Avg Deal Close Time</span>
                        <span className="font-medium">{result.timeline.avgDealClosingDays} days</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-200 pt-3">
                        <span className="text-slate-900 font-medium">Total Timeline</span>
                        <span className="font-bold text-slate-900">{result.timeline.totalEstimatedDays} days</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* System Data Indicator */}
                {result.systemData && (
                  <div className={`p-4 rounded-xl ${result.systemData.dataUsed ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
                    <div className="flex items-center gap-2">
                      {result.systemData.dataUsed ? (
                        <>
                          <span className="text-emerald-600">Using system data</span>
                          <span className="text-emerald-700 font-medium">({result.systemData.sampleSize?.toLocaleString()} samples)</span>
                          <span className="text-emerald-600">- Observed response: {formatPercent(result.systemData.observedResponseRate || 0)}</span>
                        </>
                      ) : (
                        <span className="text-slate-600">Using industry benchmarks (insufficient system data)</span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
