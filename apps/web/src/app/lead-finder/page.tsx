'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Search,
  Database,
  FileSpreadsheet,
  Upload,
  Filter,
  Sparkles,
  MapPin,
  Plus,
  Download,
  Loader2,
  Rocket,
  Save,
  CheckCircle2,
  X,
  Globe,
  Users,
  AlertCircle,
  RefreshCw,
  Eye,
  Clock,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

const sources = [
  { id: 'propstream', name: 'PropStream', icon: Database, quality: 8.5, costPer: 0.02, enabled: true },
  { id: 'batchleads', name: 'BatchLeads', icon: FileSpreadsheet, quality: 7.8, costPer: 0.03, enabled: false },
  { id: 'csv', name: 'CSV Import', icon: Upload, quality: null, costPer: null, enabled: true },
];

const distressTypes = [
  { id: 'tax_delinquent', label: 'Tax Delinquent', color: 'bg-[var(--color-error)]' },
  { id: 'pre_foreclosure', label: 'Pre-Foreclosure', color: 'bg-[var(--color-warning)]' },
  { id: 'code_violation', label: 'Code Violation', color: 'bg-[var(--accent-purple)]' },
  { id: 'probate', label: 'Probate', color: 'bg-[var(--accent-blue)]' },
];

const contactStatusColors: Record<string, { bg: string; text: string; label: string }> = {
  fresh: { bg: 'bg-[var(--color-success)]/20', text: 'text-[var(--color-success)]', label: 'Fresh' },
  lightly_contacted: { bg: 'bg-[var(--accent-blue)]/20', text: 'text-[var(--accent-blue)]', label: '1-2 Users' },
  moderately_contacted: { bg: 'bg-[var(--color-warning)]/20', text: 'text-[var(--color-warning)]', label: '3-9 Users' },
  heavily_contacted: { bg: 'bg-[var(--color-error)]/20', text: 'text-[var(--color-error)]', label: '10+ Users' },
};

export default function LeadFinderPage() {
  const { data: session, isPending } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Tab state
  const [activeTab, setActiveTab] = useState<'private' | 'public'>('public');

  // Private leads state
  const [selectedSources, setSelectedSources] = useState<string[]>(['propstream', 'csv']);
  const [selectedDistress, setSelectedDistress] = useState<string[]>([]);
  const [aiRecommended, setAiRecommended] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [listName, setListName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<{ name: string; count: number } | null>(null);

  // Public pool state
  const [publicFilters, setPublicFilters] = useState({
    state: '',
    sourceType: '',
    contactStatus: '',
    excludeContacted: false,
    minScore: 0,
  });
  const [selectedPublicLeads, setSelectedPublicLeads] = useState<number[]>([]);

  // Private leads query
  const { data: realLeads } = useQuery({
    queryKey: ['lf-prospects'],
    queryFn: async () => {
      const res = await fetch('/api/lead-finder/sourced-leads');
      if (!res.ok) return { leads: [] };
      return res.json();
    },
    enabled: !!session && activeTab === 'private',
  });

  // Public pool query
  const { data: publicPoolData, isLoading: publicPoolLoading, refetch: refetchPublicPool } = useQuery({
    queryKey: ['public-lead-pool', publicFilters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (publicFilters.state) params.set('state', publicFilters.state);
      if (publicFilters.sourceType) params.set('sourceType', publicFilters.sourceType);
      if (publicFilters.contactStatus) params.set('contactStatus', publicFilters.contactStatus);
      if (publicFilters.excludeContacted) params.set('excludeContacted', 'true');
      if (publicFilters.minScore > 0) params.set('minScore', String(publicFilters.minScore));
      params.set('limit', '100');

      const res = await fetch(`/api/lead-finder/public-pool?${params}`);
      if (!res.ok) return { leads: [], stats: { totalLeads: 0, freshLeads: 0 }, sourceTypes: [] };
      return res.json();
    },
    enabled: !!session && activeTab === 'public',
  });

  // Record outreach mutation
  const recordOutreachMutation = useMutation({
    mutationFn: async ({ leadIds, channel }: { leadIds: number[]; channel: string }) => {
      const res = await fetch('/api/lead-finder/public-pool/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds, channel }),
      });
      if (!res.ok) throw new Error('Failed to record outreach');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['public-lead-pool'] });
      setSelectedPublicLeads([]);
    },
  });

  // Save leads to a new contact list
  const saveListMutation = useMutation({
    mutationFn: async () => {
      if (!listName.trim()) throw new Error('Please enter a name for the list');
      if (selectedLeads.length === 0 && selectedPublicLeads.length === 0) {
        throw new Error('Please select at least one lead');
      }

      const listRes = await fetch('/api/contact-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: listName.trim(),
          source_type: activeTab === 'public' ? 'public-pool' : 'lead-finder',
          consent_mode: 'unverified',
        }),
      });

      if (!listRes.ok) {
        const err = await listRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create contact list');
      }

      const list = await listRes.json();
      const leadIdsToUse = activeTab === 'public' ? selectedPublicLeads : selectedLeads;

      const handoffRes = await fetch('/api/lead-finder/create-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: leadIdsToUse,
          fromPublicPool: activeTab === 'public',
        }),
      });

      if (!handoffRes.ok) {
        const err = await handoffRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to hand off leads');
      }

      const handoff = await handoffRes.json();
      return { list, handoff };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contact-lists'] });
      queryClient.invalidateQueries({ queryKey: ['lf-prospects'] });
      queryClient.invalidateQueries({ queryKey: ['public-lead-pool'] });
      setSaveSuccess({ name: data.list.name, count: data.handoff.created });
      setShowSaveDialog(false);
      setSelectedLeads([]);
      setSelectedPublicLeads([]);
      setListName('');
    },
    onError: (err: Error) => {
      setSaveError(err.message);
    },
  });

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const leads = realLeads?.leads || [];
  const publicLeads = publicPoolData?.leads || [];
  const publicStats = publicPoolData?.stats || { totalLeads: 0, freshLeads: 0 };
  const publicSourceTypes = publicPoolData?.sourceTypes || [];

  const toggleDistress = (id: string) => {
    setSelectedDistress((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const toggleLead = (id: number) => {
    setSelectedLeads((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  };

  const togglePublicLead = (id: number) => {
    setSelectedPublicLeads((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  };

  const selectAllPublic = () => {
    if (selectedPublicLeads.length === publicLeads.length) {
      setSelectedPublicLeads([]);
    } else {
      setSelectedPublicLeads(publicLeads.map((l: any) => l.id));
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[var(--color-success)]';
    if (score >= 60) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-error)]';
  };

  const currentSelectedCount = activeTab === 'public' ? selectedPublicLeads.length : selectedLeads.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Lead Finder</h1>
          <p className="text-[var(--text-secondary)] mt-1">Discover motivated sellers from public records</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-[var(--bg-tertiary)] rounded-lg p-1">
          <button
            onClick={() => setActiveTab('public')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'public'
                ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Globe className="h-4 w-4" />
            Public Pool
            {publicStats.freshLeads > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-xs">
                {publicStats.freshLeads} fresh
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('private')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'private'
                ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Database className="h-4 w-4" />
            Private Sources
          </button>
        </div>
      </div>

      {/* Public Lead Pool Tab */}
      {activeTab === 'public' && (
        <div className="space-y-4">
          {/* Info Banner */}
          <GlassCard padding="sm" className="border-l-4 border-l-[var(--accent-blue)]">
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 text-[var(--accent-blue)] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-[var(--text-primary)] font-medium">Public Lead Pool</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Leads from public records shared with all users. When you outreach to a lead, it&apos;s marked globally so others can see it&apos;s been contacted.
                  Fresh leads haven&apos;t been contacted by anyone yet.
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Filters */}
          <GlassCard padding="md">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-sm text-[var(--text-secondary)]">Filters:</span>
              </div>

              <select
                value={publicFilters.state}
                onChange={(e) => setPublicFilters(f => ({ ...f, state: e.target.value }))}
                className="bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-secondary)]"
              >
                <option value="">All States</option>
                <option value="FL">Florida</option>
                <option value="TX">Texas</option>
                <option value="GA">Georgia</option>
                <option value="NC">North Carolina</option>
                <option value="AZ">Arizona</option>
              </select>

              <select
                value={publicFilters.sourceType}
                onChange={(e) => setPublicFilters(f => ({ ...f, sourceType: e.target.value }))}
                className="bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-secondary)]"
              >
                <option value="">All Types</option>
                {distressTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>

              <select
                value={publicFilters.contactStatus}
                onChange={(e) => setPublicFilters(f => ({ ...f, contactStatus: e.target.value }))}
                className="bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-secondary)]"
              >
                <option value="">All Contact Status</option>
                <option value="fresh">Fresh (Not Contacted)</option>
                <option value="lightly_contacted">Lightly Contacted (1-2)</option>
                <option value="moderately_contacted">Moderately (3-9)</option>
                <option value="heavily_contacted">Heavily (10+)</option>
              </select>

              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={publicFilters.excludeContacted}
                  onChange={(e) => setPublicFilters(f => ({ ...f, excludeContacted: e.target.checked }))}
                  className="rounded border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
                />
                Fresh Only
              </label>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => refetchPublicPool()}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
                >
                  <RefreshCw className={`h-4 w-4 ${publicPoolLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>
          </GlassCard>

          {/* Stats Bar */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-[var(--color-success)]" />
              <span className="text-[var(--text-muted)]">Fresh: <strong className="text-[var(--text-primary)]">{publicStats.freshLeads}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-[var(--text-muted)]" />
              <span className="text-[var(--text-muted)]">Total: <strong className="text-[var(--text-primary)]">{publicStats.totalLeads}</strong></span>
            </div>
            <div className="ml-auto flex items-center gap-4">
              <button
                onClick={selectAllPublic}
                className="text-sm text-[var(--accent-blue)] hover:underline"
              >
                {selectedPublicLeads.length === publicLeads.length && publicLeads.length > 0 ? 'Deselect all' : 'Select all'}
              </button>
              <span className="text-sm text-[var(--text-muted)]">
                {publicLeads.length} leads shown
              </span>
            </div>
          </div>

          {/* Results Grid */}
          {publicPoolLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
            </div>
          ) : publicLeads.length === 0 ? (
            <GlassCard padding="lg" className="text-center">
              <Globe className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">No Public Leads Yet</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-2">
                The public lead pool is empty. Leads will appear here as they&apos;re sourced from public records.
              </p>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {publicLeads.map((lead: any) => {
                const statusInfo = contactStatusColors[lead.contactStatus] || contactStatusColors.fresh;
                const distressType = distressTypes.find(t => t.id === lead.sourceType);

                return (
                  <GlassCard
                    key={lead.id}
                    padding="none"
                    className={`overflow-hidden cursor-pointer transition-all ${
                      selectedPublicLeads.includes(lead.id)
                        ? 'ring-2 ring-[var(--accent-blue)]'
                        : 'hover:border-[var(--border-medium)]'
                    }`}
                  >
                    <div onClick={() => togglePublicLead(lead.id)}>
                      {/* Header with status badge */}
                      <div className="px-4 pt-4 flex items-center justify-between">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.bg} ${statusInfo.text}`}>
                          {lead.contactStatus === 'fresh' ? (
                            <span className="flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              Fresh
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {lead.outreachCount} contacted
                            </span>
                          )}
                        </span>
                        {lead.userHasOutreached && (
                          <span className="flex items-center gap-1 text-xs text-[var(--accent-purple)]">
                            <Eye className="h-3 w-3" />
                            You contacted
                          </span>
                        )}
                      </div>

                      <div className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">{lead.propertyAddress}</p>
                            <p className="text-sm text-[var(--text-muted)]">
                              {lead.city}, {lead.stateCode} {lead.zipCode}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-2xl font-mono font-bold ${getScoreColor(lead.distressScore)}`}>
                              {lead.distressScore}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">Score</p>
                          </div>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mb-3">{lead.ownerName}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex gap-1">
                            {distressType && (
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${distressType.color} text-white`}>
                                {distressType.label}
                              </span>
                            )}
                          </div>
                          {lead.assessedValue && (
                            <p className="text-sm font-mono text-[var(--color-success)]">
                              ${lead.assessedValue.toLocaleString()}
                            </p>
                          )}
                        </div>
                        {lead.lastOutreachAt && (
                          <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex items-center gap-1 text-xs text-[var(--text-muted)]">
                            <Clock className="h-3 w-3" />
                            Last contacted: {new Date(lead.lastOutreachAt).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Private Sources Tab */}
      {activeTab === 'private' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar - Sources */}
          <div className="space-y-4">
            <GlassCard padding="sm">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 px-2">Sources</h3>
              <div className="space-y-2">
                {sources.map((source) => {
                  const Icon = source.icon;
                  const isSelected = selectedSources.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      onClick={() => setSelectedSources((prev) =>
                        prev.includes(source.id) ? prev.filter((s) => s !== source.id) : [...prev, source.id]
                      )}
                      className={`w-full p-3 rounded-lg text-left transition-all ${
                        isSelected
                          ? 'bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30'
                          : 'bg-[var(--bg-tertiary)] border border-transparent hover:border-[var(--border-medium)]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isSelected ? 'bg-[var(--accent-blue)]/20' : 'bg-[var(--bg-primary)]'}`}>
                          <Icon className={`h-4 w-4 ${isSelected ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'}`} />
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                            {source.name}
                          </p>
                          {source.quality && (
                            <p className="text-xs text-[var(--text-muted)]">
                              Quality: {source.quality} · ${source.costPer}/lead
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </GlassCard>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-4">
            <GlassCard padding="md">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-secondary)]">Distress Type:</span>
                </div>
                {distressTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => toggleDistress(type.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      selectedDistress.includes(type.id)
                        ? `${type.color} text-white`
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setAiRecommended(!aiRecommended)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      aiRecommended
                        ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <Sparkles className="h-4 w-4" />
                    AI Recommended
                  </button>
                  <button className="btn-gradient px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Search
                  </button>
                </div>
              </div>
            </GlassCard>

            {leads.length === 0 ? (
              <GlassCard padding="lg" className="text-center">
                <Database className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">No Private Leads</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-2">
                  Connect your data sources or import a CSV to find leads privately.
                </p>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {leads.map((lead: any) => (
                  <GlassCard
                    key={lead.id}
                    padding="none"
                    className={`overflow-hidden cursor-pointer transition-all ${
                      selectedLeads.includes(lead.id)
                        ? 'ring-2 ring-[var(--accent-blue)]'
                        : 'hover:border-[var(--border-medium)]'
                    }`}
                  >
                    <div onClick={() => toggleLead(lead.id)}>
                      <div className="h-24 bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <MapPin className="h-8 w-8 text-[var(--text-muted)]" />
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-medium text-[var(--text-primary)]">{lead.address || lead.property_address}</p>
                            <p className="text-sm text-[var(--text-muted)]">{lead.city || lead.county}, FL</p>
                          </div>
                          <div className="text-right">
                            <p className={`text-2xl font-mono font-bold ${getScoreColor(lead.score || lead.distress_score || 50)}`}>
                              {lead.score || lead.distress_score || 50}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">Score</p>
                          </div>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mb-3">{lead.owner || lead.owner_name}</p>
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-mono text-[var(--color-success)]">
                            ${(lead.equity || lead.assessed_value_cents / 100 || 0).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Banner */}
      {saveSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-[var(--color-success)] text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">
              Created list &quot;{saveSuccess.name}&quot; with {saveSuccess.count} leads
            </span>
            <button
              onClick={() => router.push('/campaigns/wizard')}
              className="ml-2 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm font-medium flex items-center gap-1"
            >
              <Rocket className="h-4 w-4" />
              Create Campaign
            </button>
            <button onClick={() => setSaveSuccess(null)} className="ml-2 opacity-70 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Action Bar */}
      {currentSelectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <GlassCard padding="none" className="flex items-center gap-4 px-6 py-3">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {currentSelectedCount} selected
            </span>
            <div className="h-4 w-px bg-[var(--border-subtle)]" />

            {activeTab === 'public' && (
              <>
                <button
                  onClick={() => recordOutreachMutation.mutate({ leadIds: selectedPublicLeads, channel: 'email' })}
                  disabled={recordOutreachMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-purple)]/20 text-[var(--accent-purple)] hover:bg-[var(--accent-purple)]/30 flex items-center gap-2"
                >
                  {recordOutreachMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  Mark as Outreached
                </button>
                <div className="h-4 w-px bg-[var(--border-subtle)]" />
              </>
            )}

            <button
              onClick={() => setShowSaveDialog(true)}
              className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add to Campaign
            </button>
            <button className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export
            </button>
          </GlassCard>
        </div>
      )}

      {/* Save to List Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <GlassCard padding="md" className="max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <Save className="h-5 w-5" />
                Save Lead List
              </h3>
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setSaveError(null);
                }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Create a contact list from your selected leads. This will hand off{' '}
              <strong>{currentSelectedCount}</strong> leads for skip-tracing before campaign use.
            </p>

            {activeTab === 'public' && (
              <div className="bg-[var(--accent-purple)]/10 border border-[var(--accent-purple)]/20 rounded-lg p-3 mb-4">
                <p className="text-sm text-[var(--accent-purple)] flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  These leads will be marked as contacted in the public pool.
                </p>
              </div>
            )}

            {saveError && (
              <div className="bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 text-[var(--color-error)] px-3 py-2 rounded-lg text-sm mb-4">
                {saveError}
              </div>
            )}

            <div className="space-y-3 mb-6">
              <label className="block">
                <span className="text-sm font-medium text-[var(--text-primary)]">List Name</span>
                <input
                  type="text"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="e.g., Q1 Distressed Sellers - Miami"
                  className="mt-1 w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setSaveError(null);
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={() => saveListMutation.mutate()}
                disabled={saveListMutation.isPending || !listName.trim()}
                className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {saveListMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Create List
                  </>
                )}
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
