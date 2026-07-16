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

  if (authLoading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">CRM</h1>
            <p className="text-gray-500 mt-1">{contacts.length} contacts</p>
          </div>
          <Button variant="outline" onClick={exportCsv} disabled={!contacts.length}>
            <Download className="h-4 w-4 mr-1" /> Export CSV
          </Button>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Input placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <Card className="border-none shadow-sm">
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin opacity-30" /></div>
            ) : contacts.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>No contacts match these filters.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
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
                    <tr key={c.id} onClick={() => setSelected(c.id)} className="border-b last:border-0 hover:bg-gray-50 cursor-pointer">
                      <td className="py-2 px-4 font-medium text-gray-900">{c.name}</td>
                      <td className="py-2 px-2 text-gray-600">{c.phone}</td>
                      <td className="py-2 px-2"><Badge variant="outline">{c.status}</Badge></td>
                      <td className="py-2 px-2 text-gray-600">{c.campaignName || '—'}</td>
                      <td className="py-2 px-2 text-right">{c.followUpsSent ?? 0}</td>
                      <td className="py-2 px-4 text-gray-500">{fmt(c.lastMessageAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

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
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white h-full shadow-xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b p-4 flex items-center justify-between">
          <h2 className="font-semibold text-lg">{c?.name || 'Contact'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        {isLoading || !c ? (
          <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin opacity-30" /></div>
        ) : (
          <div className="p-4 space-y-5">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Phone</span><span>{c.phone}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Status</span><Badge variant="outline">{c.status}</Badge></div>
              <div className="flex justify-between"><span className="text-gray-500">Campaign</span><span>{c.campaignName || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Follow-ups sent</span><span>{c.followUpsSent ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Last reply</span><span>{fmt(c.lastReplyAt)}</span></div>
            </div>

            {c.status !== 'OPTED_OUT' && (
              <Button variant="outline" size="sm" onClick={optOut} disabled={optingOut} className="text-red-600 border-red-200">
                <PhoneOff className="h-4 w-4 mr-1" /> {optingOut ? 'Opting out…' : 'Manual opt-out'}
              </Button>
            )}

            {neg && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Negotiation ladder</h3>
                <div className="text-sm space-y-1 rounded-md bg-gray-50 border p-3">
                  <div className="flex justify-between"><span className="text-gray-500">Owner range</span><span>${neg.min_price?.toLocaleString()}–${neg.max_price?.toLocaleString()}</span></div>
                  {[neg.tier1_price, neg.tier2_price, neg.tier3_price, neg.tier4_price].map((t: number, i: number) => (
                    <div key={i} className="flex justify-between"><span className="text-gray-500">Tier {i + 1}{neg.current_tier === i + 1 ? ' (current)' : ''}</span><span>${t?.toLocaleString()}</span></div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold mb-2">Conversation ({convo.length})</h3>
              {convo.length === 0 ? (
                <p className="text-sm text-gray-400">No messages yet.</p>
              ) : (
                <div className="space-y-2">
                  {convo.map((m: any, i: number) => (
                    <div key={i} className={`rounded-lg p-2.5 text-sm max-w-[85%] ${m.role === 'assistant' ? 'bg-blue-50 ml-auto text-right' : 'bg-gray-100'}`}>
                      <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">{m.role === 'assistant' ? 'AI' : 'Lead'}</div>
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
