'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Download, X, PhoneOff, Users } from 'lucide-react';

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString() : '—');

export default function CrmPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-contacts', status, campaignId, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (status) p.set('status', status);
      if (campaignId) p.set('campaignId', campaignId);
      if (q) p.set('q', q);
      const res = await fetch(`/api/crm/contacts?${p.toString()}`);
      if (!res.ok) return { contacts: [], statuses: [], campaigns: [] };
      return res.json();
    },
    enabled: !!session,
  });

  const contacts: any[] = data?.contacts || [];
  const statuses: string[] = data?.statuses || [];
  const campaigns: any[] = data?.campaigns || [];

  const exportCsv = () => {
    const header = ['Name', 'Phone', 'Status', 'Campaign', 'Follow-ups', 'Last activity'];
    const rows = contacts.map((c) => [c.name, c.phone, c.status, c.campaignName || '', c.followUpsSent ?? 0, fmt(c.lastMessageAt)]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crm-contacts-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (authLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" /></div>;
  if (!session) return null;

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">CRM</h1>
          <p className="text-[var(--text-secondary)] mt-1">{contacts.length} contacts</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!contacts.length} className="border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Input placeholder="Search name or phone..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 text-sm text-[var(--text-primary)]">
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="h-10 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 text-sm text-[var(--text-primary)]">
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" /></div>
          ) : contacts.length === 0 ? (
            <div className="py-12 text-center text-[var(--text-muted)]">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>No contacts match these filters.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                  <th className="py-2 px-4">Name</th>
                  <th className="py-2 px-2">Phone</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2">Campaign</th>
                  <th className="py-2 px-2 text-right">Follow-ups</th>
                  <th className="py-2 px-4">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} onClick={() => setSelected(c.id)} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-tertiary)] cursor-pointer">
                    <td className="py-2 px-4 font-medium text-[var(--text-primary)]">{c.name}</td>
                    <td className="py-2 px-2 text-[var(--text-secondary)]">{c.phone}</td>
                    <td className="py-2 px-2"><Badge variant="outline" className="border-[var(--border-subtle)] text-[var(--text-muted)]">{c.status}</Badge></td>
                    <td className="py-2 px-2 text-[var(--text-secondary)]">{c.campaignName || '-'}</td>
                    <td className="py-2 px-2 text-right text-[var(--text-primary)]">{c.followUpsSent ?? 0}</td>
                    <td className="py-2 px-4 text-[var(--text-muted)]">{fmt(c.lastMessageAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <ContactDrawer
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => queryClient.invalidateQueries({ queryKey: ['crm-contacts'] })}
        />
      )}
    </div>
  );
}

function ContactDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['crm-contact', id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/contacts/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
  });
  const [optingOut, setOptingOut] = useState(false);

  const optOut = async () => {
    setOptingOut(true);
    await fetch(`/api/crm/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'opt_out' }),
    });
    await queryClient.invalidateQueries({ queryKey: ['crm-contact', id] });
    onChanged();
    setOptingOut(false);
  };

  const c = data?.contact;
  const convo: any[] = data?.conversation || [];
  const neg = data?.negotiation;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-md bg-[var(--bg-secondary)] h-full shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] p-4 flex items-center justify-between">
          <h2 className="font-semibold text-lg text-[var(--text-primary)]">{c?.name || 'Contact'}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-5 w-5" /></button>
        </div>
        {isLoading || !c ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" /></div>
        ) : (
          <div className="p-4 space-y-5">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Phone</span><span className="text-[var(--text-primary)]">{c.phone}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Status</span><Badge variant="outline" className="border-[var(--border-subtle)] text-[var(--text-secondary)]">{c.status}</Badge></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Campaign</span><span className="text-[var(--text-primary)]">{c.campaignName || '-'}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Follow-ups sent</span><span className="text-[var(--text-primary)]">{c.followUpsSent ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-[var(--text-muted)]">Last reply</span><span className="text-[var(--text-primary)]">{fmt(c.lastReplyAt)}</span></div>
            </div>

            {c.status !== 'OPTED_OUT' && (
              <Button variant="outline" size="sm" onClick={optOut} disabled={optingOut} className="text-[var(--color-error)] border-[var(--color-error)]/30 hover:bg-[var(--color-error)]/10">
                <PhoneOff className="h-4 w-4 mr-1" /> {optingOut ? 'Opting out...' : 'Manual opt-out'}
              </Button>
            )}

            {neg && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Negotiation ladder</h3>
                <div className="text-sm space-y-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] p-3">
                  <div className="flex justify-between"><span className="text-[var(--text-muted)]">Owner range</span><span className="text-[var(--text-primary)]">${neg.min_price?.toLocaleString()}-${neg.max_price?.toLocaleString()}</span></div>
                  {[neg.tier1_price, neg.tier2_price, neg.tier3_price, neg.tier4_price].map((t: number, i: number) => (
                    <div key={i} className="flex justify-between"><span className="text-[var(--text-muted)]">Tier {i + 1}{neg.current_tier === i + 1 ? ' (current)' : ''}</span><span className="text-[var(--text-primary)]">${t?.toLocaleString()}</span></div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Conversation ({convo.length})</h3>
              {convo.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No messages yet.</p>
              ) : (
                <div className="space-y-2">
                  {convo.map((m: any, i: number) => (
                    <div key={i} className={`rounded-lg p-2.5 text-sm max-w-[85%] ${m.role === 'assistant' ? 'bg-[var(--accent-blue)]/10 ml-auto text-right text-[var(--text-primary)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'}`}>
                      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-0.5">{m.role === 'assistant' ? 'AI' : 'Lead'}</div>
                      {m.content}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
