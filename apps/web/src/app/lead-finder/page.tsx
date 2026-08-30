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
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

const sources = [
  { id: 'propstream', name: 'PropStream', icon: Database, quality: 8.5, costPer: 0.02, enabled: true },
  { id: 'batchleads', name: 'BatchLeads', icon: FileSpreadsheet, quality: 7.8, costPer: 0.03, enabled: false },
  { id: 'csv', name: 'CSV Import', icon: Upload, quality: null, costPer: null, enabled: true },
];

const distressTypes = [
  { id: 'tax', label: 'Tax Delinquent', color: 'bg-[var(--color-error)]' },
  { id: 'preforec', label: 'Pre-Foreclosure', color: 'bg-[var(--color-warning)]' },
  { id: 'code', label: 'Code Violation', color: 'bg-[var(--accent-purple)]' },
  { id: 'probate', label: 'Probate', color: 'bg-[var(--accent-blue)]' },
];

const mockLeads = [
  { id: 1, address: '123 Main St', city: 'Miami', owner: 'John Smith', score: 85, equity: 125000, distress: ['tax'] },
  { id: 2, address: '456 Oak Ave', city: 'Tampa', owner: 'Sarah Johnson', score: 72, equity: 89000, distress: ['preforec'] },
  { id: 3, address: '789 Pine Rd', city: 'Orlando', owner: 'Bob Wilson', score: 91, equity: 200000, distress: ['probate', 'tax'] },
  { id: 4, address: '321 Elm St', city: 'Jacksonville', owner: 'Jane Doe', score: 68, equity: 75000, distress: ['code'] },
  { id: 5, address: '555 Cedar Ln', city: 'Miami', owner: 'Mike Brown', score: 78, equity: 150000, distress: ['tax'] },
  { id: 6, address: '777 Maple Dr', city: 'Tampa', owner: 'Lisa Davis', score: 82, equity: 110000, distress: ['preforec'] },
];

export default function LeadFinderPage() {
  const { data: session, isPending } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [selectedSources, setSelectedSources] = useState<string[]>(['propstream', 'csv']);
  const [selectedDistress, setSelectedDistress] = useState<string[]>([]);
  const [aiRecommended, setAiRecommended] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [listName, setListName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<{ name: string; count: number } | null>(null);

  const { data: realLeads } = useQuery({
    queryKey: ['lf-prospects'],
    queryFn: async () => {
      const res = await fetch('/api/lead-finder/sourced-leads');
      if (!res.ok) return { leads: [] };
      return res.json();
    },
    enabled: !!session,
  });

  // Save leads to a new contact list and hand off for campaign use
  const saveListMutation = useMutation({
    mutationFn: async () => {
      if (!listName.trim()) {
        throw new Error('Please enter a name for the list');
      }
      if (selectedLeads.length === 0) {
        throw new Error('Please select at least one lead');
      }

      // Create contact list
      const listRes = await fetch('/api/contact-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: listName.trim(),
          source_type: 'lead-finder',
          consent_mode: 'unverified',
        }),
      });

      if (!listRes.ok) {
        const err = await listRes.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create contact list');
      }

      const list = await listRes.json();

      // Hand off selected leads to create contacts
      const handoffRes = await fetch('/api/lead-finder/create-campaign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadIds: selectedLeads,
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
      setSaveSuccess({ name: data.list.name, count: data.handoff.created });
      setShowSaveDialog(false);
      setSelectedLeads([]);
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

  const leads = realLeads?.leads?.length > 0 ? realLeads.leads : mockLeads;

  const toggleSource = (id: string) => {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

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

  const selectAll = () => {
    if (selectedLeads.length === leads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(leads.map((l: any) => l.id));
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[var(--color-success)]';
    if (score >= 60) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-error)]';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Lead Finder</h1>
        <p className="text-[var(--text-secondary)] mt-1">Discover motivated sellers from public records</p>
      </div>

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
                    onClick={() => toggleSource(source.id)}
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

        {/* Main Content - Filters & Results */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filters */}
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

          {/* Results Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={selectAll}
                className="text-sm text-[var(--accent-blue)] hover:underline"
              >
                {selectedLeads.length === leads.length ? 'Deselect all' : 'Select all'}
              </button>
              <span className="text-sm text-[var(--text-muted)]">
                {leads.length} leads found
              </span>
            </div>
            <select className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-secondary)]">
              <option>Sort by: Score</option>
              <option>Sort by: Equity</option>
              <option>Sort by: Date Added</option>
            </select>
          </div>

          {/* Results Grid */}
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
                  {/* Map placeholder */}
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
                      <div className="flex gap-1">
                        {(lead.distress || []).map((d: string) => {
                          const type = distressTypes.find((t) => t.id === d);
                          return (
                            <span
                              key={d}
                              className={`px-2 py-0.5 rounded text-xs font-medium ${type?.color} text-white`}
                            >
                              {type?.label}
                            </span>
                          );
                        })}
                      </div>
                      <p className="text-sm font-mono text-[var(--color-success)]">
                        ${(lead.equity || lead.assessed_value_cents / 100 || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>

      {/* Success Banner */}
      {saveSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-[var(--color-success)] text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">
              Created list "{saveSuccess.name}" with {saveSuccess.count} leads
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
      {selectedLeads.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <GlassCard padding="none" className="flex items-center gap-4 px-6 py-3">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {selectedLeads.length} selected
            </span>
            <div className="h-4 w-px bg-[var(--border-subtle)]" />
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
            <div className="h-4 w-px bg-[var(--border-subtle)]" />
            <span className="text-sm text-[var(--text-muted)]">
              Est. ${(selectedLeads.length * 0.02).toFixed(2)}
            </span>
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
              <strong>{selectedLeads.length}</strong> leads for skip-tracing before campaign use.
            </p>

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

            <div className="bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/20 rounded-lg p-3 mb-6">
              <p className="text-sm text-[var(--accent-blue)]">
                After saving, you can select this list in the Campaign Wizard under "Lists" or "Lead Finder" tabs.
              </p>
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
