'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

interface Message {
  id: string;
  type: 'outbound' | 'inbound';
  subject?: string;
  content: string;
  status: string;
  sentAt: string;
  channel: 'email' | 'sms' | 'call';
}

interface Prospect {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  phase: string;
  tier: string;
  score: number;
  expectedValue: number;
  lastContact: string;
  messageCount: number;
  lastMessage?: { type: string; status: string; when: string };
  createdAt: string;
  updatedAt: string;
  messages?: Message[];
}

interface PipelineAnalytics {
  totalExpectedValue: number;
  avgExpectedValue: number;
  avgScore: number;
  totalMessages: number;
  leadsWithReplies: number;
  replyRate: string;
  responseByTier: Record<string, { total: number; replied: number }>;
  topPerformers: number;
  inNegotiation: number;
  underContract: number;
  closing: number;
  won: number;
  conversionRate: string;
  avgMessagesPerLead: string;
}

interface PipelineData {
  phases: Array<{ id: string; label: string; color: string }>;
  tiers: Array<{ id: string; label: string; color: string }>;
  phaseCounts: Record<string, number>;
  tierCounts: Record<string, number>;
  prospects: Prospect[];
  totalProspects: number;
  recentMessages: Array<{ id: string; type: string; status: string; when: string }>;
  analytics?: PipelineAnalytics;
}

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  new: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  outreach: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  engaged: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200' },
  qualifying: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200' },
  negotiating: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  contract: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
  closing: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  won: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  lost: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
};

const TIER_CONFIG: Record<string, { emoji: string; bg: string; text: string }> = {
  hot: { emoji: '🔥', bg: 'bg-rose-100', text: 'text-rose-700' },
  warm: { emoji: '☀️', bg: 'bg-amber-100', text: 'text-amber-700' },
  cold: { emoji: '❄️', bg: 'bg-blue-100', text: 'text-blue-700' },
};

function formatTime(date: string): string {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return d.toLocaleDateString();
}

function formatCurrency(value: number): string {
  if (!value) return '$0';
  if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return '$' + (value / 1000).toFixed(0) + 'K';
  return '$' + value.toLocaleString();
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-slate-500';
}

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#94a3b8';

  return (
    <div className="relative w-10 h-10">
      <svg className="w-10 h-10 -rotate-90">
        <circle cx="20" cy="20" r="16" stroke="#e2e8f0" strokeWidth="3" fill="none" />
        <circle
          cx="20" cy="20" r="16"
          stroke={color}
          strokeWidth="3"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${getScoreColor(score)}`}>
        {score}
      </span>
    </div>
  );
}

function PhaseIcon({ phase }: { phase: string }) {
  const icons: Record<string, React.ReactNode> = {
    new: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />,
    outreach: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />,
    engaged: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
    qualifying: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />,
    negotiating: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />,
    contract: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    closing: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
    won: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />,
    lost: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />,
  };

  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {icons[phase] || icons.new}
    </svg>
  );
}

export default function PipelinePage() {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [phaseFilter, setPhaseFilter] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('score');
  const [selectedProspect, setSelectedProspect] = useState<Prospect | null>(null);
  const [prospectMessages, setProspectMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const fetchData = async () => {
    try {
      let res = await fetch('http://localhost:4001/api/campaigns/pipeline').catch(() => null);
      if (!res || !res.ok) {
        res = await fetch('/api/campaigns/pipeline');
      }
      if (!res || !res.ok) {
        throw new Error('API error: ' + (res?.status || 'no response'));
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Pipeline fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchProspectMessages = async (prospect: Prospect) => {
    setLoadingMessages(true);
    try {
      let res = await fetch(`http://localhost:4001/api/prospects/${prospect.id}/messages`).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch(`/api/prospects/${prospect.id}/messages`).catch(() => null);
      }
      if (res && res.ok) {
        const msgData = await res.json();
        setProspectMessages(msgData.messages || []);
      } else {
        setProspectMessages([]);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
      setProspectMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSelectProspect = (prospect: Prospect) => {
    setSelectedProspect(prospect);
    setProspectMessages([]);
    fetchProspectMessages(prospect);
  };

  const filteredProspects = useMemo(() => {
    if (!data) return [];

    return data.prospects
      .filter((p) => {
        if (tierFilter !== 'all' && p.tier !== tierFilter) return false;
        if (phaseFilter && p.phase !== phaseFilter) return false;
        if (searchTerm) {
          const searchable = [p.name, p.email, p.phone, p.address].filter(Boolean).join(' ').toLowerCase();
          if (!searchable.includes(searchTerm.toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const tierOrder: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
        switch (sortBy) {
          case 'score': return b.score - a.score;
          case 'recent': return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          case 'value': return (b.expectedValue || 0) - (a.expectedValue || 0);
          case 'name': return (a.name || '').localeCompare(b.name || '');
          case 'tier-hot': return (tierOrder[a.tier] || 2) - (tierOrder[b.tier] || 2);
          case 'tier-cold': return (tierOrder[b.tier] || 2) - (tierOrder[a.tier] || 2);
          case 'messages': return (b.messageCount || 0) - (a.messageCount || 0);
          default: return 0;
        }
      });
  }, [data, tierFilter, phaseFilter, searchTerm, sortBy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-violet-200 border-t-violet-500 rounded-full animate-spin" />
          <p className="text-slate-600 font-medium">Loading pipeline data...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <p className="text-slate-600">Failed to load pipeline data</p>
          <button onClick={fetchData} className="mt-4 px-4 py-2 bg-violet-600 text-white rounded-lg">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/25">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Pipeline Monitor</h1>
                <p className="text-sm text-slate-500">Track prospects through your sales funnel</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/monitor" className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Campaign Monitor
              </Link>
              <button onClick={fetchData} className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="text-sm font-medium text-slate-700">Refresh</span>
              </button>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-sm font-medium text-emerald-700">Live</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
        {/* Tier Filters */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-600">Filter by Tier:</span>
              <div className="flex gap-2">
                {[
                  { id: 'all', label: 'All Prospects', count: data.totalProspects },
                  { id: 'hot', label: '🔥 Hot', count: data.tierCounts.hot || 0 },
                  { id: 'warm', label: '☀️ Warm', count: data.tierCounts.warm || 0 },
                  { id: 'cold', label: '❄️ Cold', count: data.tierCounts.cold || 0 },
                ].map((tier) => (
                  <button
                    key={tier.id}
                    onClick={() => setTierFilter(tier.id)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      tierFilter === tier.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {tier.label}
                    <span className={`ml-1.5 px-1.5 py-0.5 rounded text-xs ${
                      tierFilter === tier.id ? 'bg-white/20' : 'bg-slate-200'
                    }`}>
                      {tier.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search prospects..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 w-64 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="score">Sort by Score</option>
                <option value="tier-hot">Tier: Hot First</option>
                <option value="tier-cold">Tier: Cold First</option>
                <option value="recent">Most Recent</option>
                <option value="value">Expected Value</option>
                <option value="messages">Most Messages</option>
                <option value="name">Name A-Z</option>
              </select>
            </div>
          </div>
        </section>

        {/* Phase Cards */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Pipeline Phases</h2>
              <p className="text-sm text-slate-500">Click a phase to filter prospects</p>
            </div>
            <div className="text-sm text-slate-500">{data.totalProspects} total prospects</div>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
            {data.phases.map((phase) => {
              const count = data.phaseCounts[phase.id] || 0;
              const colors = PHASE_COLORS[phase.id] || PHASE_COLORS.new;
              const isActive = phaseFilter === phase.id;

              return (
                <button
                  key={phase.id}
                  onClick={() => setPhaseFilter(isActive ? null : phase.id)}
                  className={`p-4 rounded-xl border-2 transition-all hover:scale-105 ${
                    isActive ? `${colors.border} ring-2 ring-offset-2` : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-2xl font-bold ${colors.text}`}>{count}</span>
                    <span className={`w-8 h-8 ${colors.bg} rounded-lg flex items-center justify-center`}>
                      <PhaseIcon phase={phase.id} />
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-600 truncate">{phase.label}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Prospects Table */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Prospects</h2>
              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-sm">
                {filteredProspects.length} shown
              </span>
            </div>
            {(tierFilter !== 'all' || phaseFilter) && (
              <button
                onClick={() => { setTierFilter('all'); setPhaseFilter(null); setSearchTerm(''); }}
                className="text-sm text-violet-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
            <div className="col-span-3">Prospect</div>
            <div className="col-span-2">Phase</div>
            <div className="col-span-1 text-center">Tier</div>
            <div className="col-span-1 text-center">Score</div>
            <div className="col-span-2">Last Contact</div>
            <div className="col-span-2">Expected Value</div>
            <div className="col-span-1 text-center">Messages</div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
            {filteredProspects.length === 0 ? (
              <div className="py-16 text-center">
                <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p className="text-slate-500 font-medium">No prospects match your filters</p>
              </div>
            ) : (
              filteredProspects.map((prospect) => {
                const phaseColor = PHASE_COLORS[prospect.phase] || PHASE_COLORS.new;
                const tierConf = TIER_CONFIG[prospect.tier] || TIER_CONFIG.cold;

                return (
                  <div
                    key={prospect.id}
                    onClick={() => handleSelectProspect(prospect)}
                    className="grid grid-cols-12 gap-4 px-6 py-4 items-center cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div className="col-span-3 flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                        {(prospect.name || 'U')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{prospect.name || 'Unknown'}</p>
                        <p className="text-xs text-slate-500 truncate">{prospect.email || prospect.phone || 'No contact'}</p>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${phaseColor.bg} ${phaseColor.text}`}>
                        <PhaseIcon phase={prospect.phase} />
                        <span className="capitalize">{prospect.phase}</span>
                      </span>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${tierConf.bg} ${tierConf.text}`}>
                        {tierConf.emoji}
                      </span>
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <ScoreRing score={prospect.score} />
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm text-slate-600">{formatTime(prospect.lastContact)}</p>
                      {prospect.lastMessage && (
                        <p className="text-xs text-slate-400">{prospect.lastMessage.type.replace('_', ' ')}</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <p className="text-sm font-semibold text-slate-900">{formatCurrency(prospect.expectedValue)}</p>
                      {prospect.address && <p className="text-xs text-slate-400 truncate">{prospect.address}</p>}
                    </div>
                    <div className="col-span-1 text-center">
                      <span className="inline-flex items-center justify-center w-8 h-8 bg-slate-100 rounded-full text-sm font-medium text-slate-600">
                        {prospect.messageCount || 0}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Summary */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Pipeline Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Pipeline Value', value: formatCurrency(data.analytics?.totalExpectedValue || filteredProspects.reduce((sum, p) => sum + (p.expectedValue || 0), 0)), color: 'text-emerald-600' },
                { label: 'Avg Expected Value', value: formatCurrency(data.analytics?.avgExpectedValue || (filteredProspects.length > 0 ? Math.round(filteredProspects.reduce((sum, p) => sum + (p.expectedValue || 0), 0) / filteredProspects.length) : 0)), color: 'text-emerald-500' },
                { label: 'Average Score', value: (data.analytics?.avgScore || (filteredProspects.length > 0 ? Math.round(filteredProspects.reduce((sum, p) => sum + p.score, 0) / filteredProspects.length) : 0)) + '/100', color: 'text-blue-600' },
                { label: 'Total Messages', value: data.analytics?.totalMessages || filteredProspects.reduce((sum, p) => sum + (p.messageCount || 0), 0), color: 'text-violet-600' },
                { label: 'Hot Prospects', value: data.tierCounts.hot || 0, color: 'text-rose-600' },
                { label: 'Warm Prospects', value: data.tierCounts.warm || 0, color: 'text-amber-600' },
                { label: 'Cold Prospects', value: data.tierCounts.cold || 0, color: 'text-blue-600' },
                { label: 'Reply Rate', value: (data.analytics?.replyRate || '0.0') + '%', color: 'text-cyan-600' },
                { label: 'In Negotiation', value: data.phaseCounts.negotiating || 0, color: 'text-amber-600' },
                { label: 'Under Contract', value: data.phaseCounts.contract || 0, color: 'text-orange-600' },
                { label: 'Closing', value: data.phaseCounts.closing || 0, color: 'text-emerald-600' },
                { label: 'Won Deals', value: data.phaseCounts.won || 0, color: 'text-green-600' },
              ].map((item, i) => (
                <div key={i} className="p-4 bg-slate-50 rounded-xl">
                  <p className="text-sm text-slate-500">{item.label}</p>
                  <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                </div>
              ))}
            </div>

            {/* Response Rate by Tier */}
            {data.analytics?.responseByTier && (
              <div className="mt-6">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">Response Rate by Tier</h4>
                <div className="grid grid-cols-3 gap-4">
                  {(['hot', 'warm', 'cold'] as const).map((tier) => {
                    const tierData = data.analytics?.responseByTier?.[tier] || { total: 0, replied: 0 };
                    const rate = tierData.total > 0 ? ((tierData.replied / tierData.total) * 100).toFixed(1) : '0.0';
                    const tierConf = TIER_CONFIG[tier];
                    return (
                      <div key={tier} className={`p-3 rounded-xl ${tierConf.bg}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span>{tierConf.emoji}</span>
                          <span className={`text-sm font-medium ${tierConf.text} capitalize`}>{tier}</span>
                        </div>
                        <p className={`text-lg font-bold ${tierConf.text}`}>{rate}%</p>
                        <p className="text-xs text-slate-500">{tierData.replied}/{tierData.total} replied</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Conversion Funnel */}
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-slate-700 mb-3">Conversion Funnel</h4>
              <div className="flex items-center gap-2">
                {[
                  { label: 'New', count: data.phaseCounts.new || 0, color: 'bg-slate-400' },
                  { label: 'Outreach', count: data.phaseCounts.outreach || 0, color: 'bg-blue-400' },
                  { label: 'Engaged', count: data.phaseCounts.engaged || 0, color: 'bg-cyan-400' },
                  { label: 'Qualifying', count: data.phaseCounts.qualifying || 0, color: 'bg-violet-400' },
                  { label: 'Negotiating', count: data.phaseCounts.negotiating || 0, color: 'bg-amber-400' },
                  { label: 'Contract', count: data.phaseCounts.contract || 0, color: 'bg-orange-400' },
                  { label: 'Won', count: data.phaseCounts.won || 0, color: 'bg-green-500' },
                ].map((stage, i, arr) => (
                  <div key={stage.label} className="flex items-center flex-1">
                    <div className="flex-1 text-center">
                      <div className={`h-8 ${stage.color} rounded flex items-center justify-center`}>
                        <span className="text-xs font-bold text-white">{stage.count}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 truncate">{stage.label}</p>
                    </div>
                    {i < arr.length - 1 && (
                      <svg className="w-4 h-4 text-slate-300 mx-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
              {data.analytics?.conversionRate && (
                <p className="text-sm text-slate-500 mt-2 text-center">
                  Overall Conversion: <span className="font-semibold text-emerald-600">{data.analytics.conversionRate}%</span>
                </p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Recent Activity</h3>
            <div className="space-y-3 max-h-[250px] overflow-y-auto">
              {data.recentMessages.slice(0, 10).map((msg) => (
                <div key={msg.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg">
                  <div className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {msg.type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-slate-400">{formatTime(msg.when)}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    msg.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {msg.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Prospect Modal with Conversation Thread */}
      {selectedProspect && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="h-full flex">
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedProspect(null)} />
            <div className="relative ml-auto bg-white shadow-2xl w-full max-w-4xl h-full flex flex-col">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white text-xl font-bold">
                    {(selectedProspect.name || 'U')[0].toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{selectedProspect.name || 'Unknown'}</h3>
                    <p className="text-sm text-slate-500">{selectedProspect.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${PHASE_COLORS[selectedProspect.phase]?.bg} ${PHASE_COLORS[selectedProspect.phase]?.text}`}>
                    {selectedProspect.phase}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${TIER_CONFIG[selectedProspect.tier]?.bg} ${TIER_CONFIG[selectedProspect.tier]?.text}`}>
                    {TIER_CONFIG[selectedProspect.tier]?.emoji} {selectedProspect.tier}
                  </span>
                  <button onClick={() => setSelectedProspect(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                    <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Content Grid */}
              <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - Prospect Details */}
                <div className="w-80 border-r border-slate-200 bg-slate-50 p-4 overflow-y-auto">
                  <div className="space-y-4">
                    <div className="bg-white rounded-xl p-4 shadow-sm">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">Contact Info</h4>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span className="text-slate-700 truncate">{selectedProspect.email || 'No email'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <span className="text-slate-700">{selectedProspect.phone || 'No phone'}</span>
                        </div>
                        {selectedProspect.address && (
                          <div className="flex items-start gap-2 text-sm">
                            <svg className="w-4 h-4 text-slate-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            <span className="text-slate-700">{selectedProspect.address}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-4 shadow-sm">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">Deal Info</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-slate-500">Expected Value</p>
                          <p className="text-lg font-bold text-emerald-600">{formatCurrency(selectedProspect.expectedValue)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Score</p>
                          <p className="text-lg font-bold text-violet-600">{selectedProspect.score}/100</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Messages</p>
                          <p className="text-lg font-bold text-slate-700">{selectedProspect.messageCount || 0}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Last Contact</p>
                          <p className="text-sm font-medium text-slate-700">{formatTime(selectedProspect.lastContact)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-4 shadow-sm">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">Timeline</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Created</span>
                          <span className="text-slate-700">{formatTime(selectedProspect.createdAt)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Updated</span>
                          <span className="text-slate-700">{formatTime(selectedProspect.updatedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <button className="w-full px-4 py-2.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-medium text-sm flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                        Send Message
                      </button>
                      <button className="w-full px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 font-medium text-sm flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Update Phase
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Panel - Conversation Thread */}
                <div className="flex-1 flex flex-col bg-white">
                  <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
                    <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Conversation Thread
                    </h4>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {loadingMessages ? (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                          <div className="w-8 h-8 border-2 border-violet-200 border-t-violet-500 rounded-full animate-spin mx-auto mb-2" />
                          <p className="text-sm text-slate-500">Loading messages...</p>
                        </div>
                      </div>
                    ) : prospectMessages.length === 0 ? (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                          <svg className="w-16 h-16 text-slate-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          <p className="text-slate-500 font-medium">No messages yet</p>
                          <p className="text-sm text-slate-400 mt-1">Start the conversation by sending a message</p>
                        </div>
                      </div>
                    ) : (
                      prospectMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.type === 'outbound' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-[80%] ${msg.type === 'outbound' ? 'order-2' : 'order-1'}`}>
                            {msg.type === 'inbound' && (
                              <div className="flex items-center gap-2 mb-1">
                                <div className="w-6 h-6 bg-slate-300 rounded-full flex items-center justify-center text-xs text-white font-medium">
                                  {(selectedProspect.name || 'P')[0]}
                                </div>
                                <span className="text-xs text-slate-500">{selectedProspect.name?.split(' ')[0] || 'Prospect'}</span>
                              </div>
                            )}
                            {msg.type === 'outbound' && (
                              <div className="flex items-center gap-2 mb-1 justify-end">
                                <span className="text-xs text-slate-500">DealFlow AI</span>
                                <div className="w-6 h-6 bg-violet-500 rounded-full flex items-center justify-center text-xs text-white font-medium">
                                  AI
                                </div>
                              </div>
                            )}
                            <div
                              className={`rounded-2xl px-4 py-3 ${
                                msg.type === 'outbound'
                                  ? 'bg-violet-600 text-white rounded-br-md'
                                  : 'bg-slate-100 text-slate-800 rounded-bl-md'
                              }`}
                            >
                              {msg.subject && (
                                <p className={`text-sm font-medium mb-1 ${msg.type === 'outbound' ? 'text-violet-100' : 'text-slate-600'}`}>
                                  {msg.subject}
                                </p>
                              )}
                              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                            </div>
                            <div className={`flex items-center gap-2 mt-1 ${msg.type === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                              <span className="text-xs text-slate-400">
                                {new Date(msg.sentAt).toLocaleString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                              {msg.type === 'outbound' && (
                                <span className={`text-xs ${msg.status === 'delivered' ? 'text-emerald-500' : 'text-slate-400'}`}>
                                  {msg.status === 'delivered' ? '✓✓' : '✓'}
                                </span>
                              )}
                              <span className="text-xs text-slate-400 capitalize">{msg.channel}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Message Input */}
                  <div className="p-4 border-t border-slate-200 bg-white">
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <textarea
                          placeholder="Type a message..."
                          className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                          rows={2}
                        />
                      </div>
                      <button className="px-4 py-3 bg-violet-600 text-white rounded-xl hover:bg-violet-700 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
