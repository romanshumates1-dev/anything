'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Search,
  Filter,
  Sparkles,
  MapPin,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Save,
} from 'lucide-react';

const distressTypes = [
  { id: 'tax', label: 'Tax Delinquent', color: 'bg-red-500' },
  { id: 'preforec', label: 'Pre-Foreclosure', color: 'bg-amber-500' },
  { id: 'code', label: 'Code Violation', color: 'bg-purple-500' },
  { id: 'probate', label: 'Probate', color: 'bg-blue-500' },
];

interface Lead {
  id: number;
  owner_name?: string;
  property_address?: string;
  county?: string;
  distress_score?: number;
  assessed_value_cents?: number;
  signals?: string[];
  category?: string;
  status?: string;
}

interface LeadFinderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeadsSelected?: (listId: string, listName: string, leadCount: number) => void;
}

export function LeadFinderModal({
  open,
  onOpenChange,
  onLeadsSelected,
}: LeadFinderModalProps) {
  const queryClient = useQueryClient();
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);
  const [selectedDistress, setSelectedDistress] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(50);
  const [county] = useState('');
  const [aiRecommended, setAiRecommended] = useState(false);
  const [listName, setListName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: leadsData, isLoading } = useQuery({
    queryKey: ['lead-finder-modal', minScore, county],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('minScore', String(minScore));
      params.set('status', 'new');
      params.set('limit', '100');
      if (county) params.set('county', county);

      const res = await fetch(`/api/lead-finder/sourced-leads?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch leads');
      }
      return res.json();
    },
    enabled: open,
  });

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

      // Update list with row counts
      await fetch(`/api/contact-lists/${list.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_rows: handoff.created,
          inserted_rows: handoff.created,
        }),
      }).catch(() => {}); // Best effort

      return { list, handoff };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contact-lists'] });
      queryClient.invalidateQueries({ queryKey: ['lead-finder-modal'] });
      queryClient.invalidateQueries({ queryKey: ['sourced-leads-counts'] });

      if (onLeadsSelected) {
        onLeadsSelected(data.list.id, data.list.name, data.handoff.created);
      }

      setShowSaveDialog(false);
      setSelectedLeads([]);
      setListName('');
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const leads: Lead[] = leadsData?.leads || [];
  const counts = leadsData?.counts || { total: 0, new_count: 0 };

  const toggleLead = (id: number) => {
    setSelectedLeads((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedLeads.length === leads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(leads.map((l) => l.id));
    }
  };

  const toggleDistress = (id: string) => {
    setSelectedDistress((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const filteredLeads = leads.filter((lead) => {
    if (selectedDistress.length === 0) return true;
    const leadSignals = lead.signals || [];
    return selectedDistress.some((d) =>
      leadSignals.some((s) => s.toLowerCase().includes(d))
    );
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Lead Finder
            </DialogTitle>
            <DialogDescription>
              Select leads from public records to add to your campaign. {counts.new_count} leads available.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive" className="mx-0">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 py-3 border-b">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <span className="text-sm text-gray-500">Filters:</span>
            </div>

            <div className="flex items-center gap-1">
              {distressTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => toggleDistress(type.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                    selectedDistress.includes(type.id)
                      ? `${type.color} text-white`
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Label className="text-xs text-gray-500">Min Score:</Label>
              <Input
                type="number"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-16 h-7 text-xs"
                min={0}
                max={100}
              />
            </div>

            <button
              onClick={() => setAiRecommended(!aiRecommended)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                aiRecommended
                  ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Pick
            </button>
          </div>

          {/* Results Header */}
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <button
                onClick={selectAll}
                className="text-sm text-blue-600 hover:underline"
              >
                {selectedLeads.length === filteredLeads.length ? 'Deselect all' : 'Select all'}
              </button>
              <span className="text-sm text-gray-500">
                {filteredLeads.length} leads shown
              </span>
              {selectedLeads.length > 0 && (
                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                  {selectedLeads.length} selected
                </Badge>
              )}
            </div>
          </div>

          {/* Results Grid */}
          <div className="flex-1 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="text-center py-12">
                <Search className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">No leads match your criteria</p>
                <p className="text-sm text-gray-400 mt-1">
                  Try lowering the minimum score or removing filters
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pb-4">
                {filteredLeads.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => toggleLead(lead.id)}
                    className={`border rounded-lg p-3 cursor-pointer transition-all ${
                      selectedLeads.includes(lead.id)
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {lead.property_address || 'Unknown Address'}
                        </p>
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {lead.county || 'Unknown'}, FL
                        </p>
                      </div>
                      <div className="text-right ml-2">
                        <p className={`text-lg font-mono font-bold ${getScoreColor(lead.distress_score || 0)}`}>
                          {lead.distress_score || 0}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-gray-600 truncate mb-2">
                      {lead.owner_name || 'Unknown Owner'}
                    </p>

                    <div className="flex items-center justify-between">
                      <div className="flex gap-1">
                        {(lead.signals || []).slice(0, 2).map((signal, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {signal}
                          </Badge>
                        ))}
                      </div>
                      {lead.assessed_value_cents && (
                        <span className="text-xs font-mono text-green-600">
                          ${Math.round(lead.assessed_value_cents / 100).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {selectedLeads.includes(lead.id) && (
                      <div className="absolute top-2 right-2">
                        <CheckCircle2 className="h-5 w-5 text-blue-600" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
            <div className="flex items-center justify-between w-full">
              <div className="text-sm text-gray-500">
                {selectedLeads.length > 0 && (
                  <>Est. skip-trace cost: ${(selectedLeads.length * 0.02).toFixed(2)}</>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => setShowSaveDialog(true)}
                  disabled={selectedLeads.length === 0}
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add {selectedLeads.length} to Campaign
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save List Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5" />
              Save Lead List
            </DialogTitle>
            <DialogDescription>
              Create a contact list from your selected leads. This will hand off {selectedLeads.length} leads for skip-tracing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="list-name">List Name</Label>
              <Input
                id="list-name"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="e.g., Q1 Distressed Sellers - Miami"
              />
            </div>

            <Alert>
              <AlertDescription className="text-sm">
                <strong>{selectedLeads.length}</strong> leads will be handed off to the skip-trace pipeline.
                Contact info will be resolved before your campaign sends.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveListMutation.mutate()}
              disabled={saveListMutation.isPending || !listName.trim()}
            >
              {saveListMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  Create List & Add to Campaign
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LeadFinderModal;
