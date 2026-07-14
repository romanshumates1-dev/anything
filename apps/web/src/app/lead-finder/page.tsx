'use client';

import { useState, Fragment } from 'react';
import { useSession } from '@/lib/auth-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Upload, ShieldCheck, ShieldAlert, ChevronDown, ChevronRight, Rocket } from 'lucide-react';

const money = (c?: number | null) => (c ? `$${(c / 100).toLocaleString()}` : '—');

function TermsBadge({ status }: { status: string }) {
  if (status === 'PERMITTED')
    return <Badge className="bg-green-100 text-green-800"><ShieldCheck className="h-3 w-3 mr-1" />PERMITTED</Badge>;
  if (status === 'PROHIBITED')
    return <Badge className="bg-red-100 text-red-800"><ShieldAlert className="h-3 w-3 mr-1" />PROHIBITED</Badge>;
  return <Badge className="bg-amber-100 text-amber-800">MANUAL-ONLY</Badge>;
}

export default function LeadFinderPage() {
  const { data: session, isPending: authLoading } = useSession();
  const qc = useQueryClient();

  const [uploadFor, setUploadFor] = useState<number | null>(null);
  const [uploadText, setUploadText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [justHandedOff, setJustHandedOff] = useState(false);

  const [county, setCounty] = useState('');
  const [category, setCategory] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: sources, isLoading: sourcesLoading } = useQuery({
    queryKey: ['lf-sources'],
    queryFn: async () => {
      const res = await fetch('/api/lead-finder/sources');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  const { data: prospects, isLoading: prospectsLoading } = useQuery({
    queryKey: ['lf-prospects', county, category, minScore],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (county) p.set('county', `%${county}%`);
      if (category) p.set('category', category);
      if (minScore) p.set('minScore', String(minScore));
      const res = await fetch(`/api/lead-finder/sourced-leads?${p.toString()}`);
      if (!res.ok) return { leads: [], counts: {} };
      return res.json();
    },
    enabled: !!session,
  });

  const doUpload = async (sourceId: number) => {
    if (!uploadText.trim()) { setMsg('Paste the county file (CSV) first.'); return; }
    setBusy(true); setMsg(null); setJustHandedOff(false);
    try {
      const res = await fetch('/api/lead-finder/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId, text: uploadText, filename: 'pasted.csv' }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Upload failed'); return; }
      setMsg(`Ingested: ${j.inserted} new, ${j.duplicates} duplicates, ${j.failed} failed (of ${j.totalRows}).`);
      setUploadText(''); setUploadFor(null);
      qc.invalidateQueries({ queryKey: ['lf-sources'] });
      qc.invalidateQueries({ queryKey: ['lf-prospects'] });
    } finally { setBusy(false); }
  };

  const createCampaign = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/lead-finder/create-campaign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filter: { county: county ? `%${county}%` : undefined, category: category || undefined, minScore } }),
      });
      const j = await res.json();
      if (!res.ok) { setMsg(j.error || 'Handoff failed'); setJustHandedOff(false); return; }
      setMsg(`Created ${j.created} contacts from the segment → next: skip-trace, DNC, then the campaign wizard.`);
      setJustHandedOff(true);
      qc.invalidateQueries({ queryKey: ['lf-prospects'] });
    } finally { setBusy(false); }
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const srcList: any[] = Array.isArray(sources) ? sources : [];
  const leads: any[] = prospects?.leads || [];
  const counts = prospects?.counts || {};

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Lead Finder</h1>
          <p className="text-gray-500 mt-1">
            High-distress seller + cash-buyer prospects from free public records (KY, NC, GA, MO, St. Louis).
          </p>
          <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded p-2">
            Compliance: property + owner-name records only — no phones/emails are ever gathered here (skip-trace resolves
            contact downstream). Sources marked MANUAL-ONLY are uploaded by you; PERMITTED sources were live robots-checked.
            Confirm each source's terms with an attorney per state (not legal advice). Scores are signal-based estimates.
          </p>
        </header>

        {msg && (
          <div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded p-3 flex items-center justify-between gap-3">
            <span>{msg}</span>
            {justHandedOff && (
              <a href="/campaigns/wizard" className="shrink-0 inline-flex items-center rounded bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700">
                Build campaign →
              </a>
            )}
          </div>
        )}

        {/* ── Source registry ── */}
        <Card className="border-none shadow-sm">
          <CardHeader><CardTitle>Source Registry</CardTitle></CardHeader>
          <CardContent>
            {sourcesLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin opacity-30" /></div>
            ) : srcList.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">No sources configured.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Source</th>
                      <th className="pr-3">Category</th>
                      <th className="pr-3">Access</th>
                      <th className="pr-3">Terms</th>
                      <th className="pr-3">Records</th>
                      <th className="pr-3">Weight</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {srcList.map((s) => (
                      <Fragment key={s.id}>
                        <tr className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <div className="font-medium text-gray-900">{s.name}</div>
                            <div className="text-xs text-gray-400">{s.jurisdiction} · {s.record_type}</div>
                          </td>
                          <td className="pr-3"><Badge variant="outline">{s.category}</Badge></td>
                          <td className="pr-3 text-gray-600">{s.access_method}</td>
                          <td className="pr-3"><TermsBadge status={s.terms_status} /></td>
                          <td className="pr-3">{s.record_count ?? 0}</td>
                          <td className="pr-3">{s.distress_weight}</td>
                          <td className="pr-3 text-right">
                            {s.terms_status !== 'PROHIBITED' && (
                              <Button variant="outline" size="sm" onClick={() => { setUploadFor(uploadFor === s.id ? null : s.id); setUploadText(''); setMsg(null); }}>
                                <Upload className="h-3 w-3 mr-1" />Upload
                              </Button>
                            )}
                          </td>
                        </tr>
                        {uploadFor === s.id && (
                          <tr>
                            <td colSpan={7} className="pb-3">
                              <div className="bg-gray-50 rounded p-3 space-y-2">
                                <p className="text-xs text-gray-500">
                                  Paste the county file as CSV (first row = headers). Any phone/email columns are
                                  stripped automatically — only property + owner-name fields are stored.
                                </p>
                                <Textarea
                                  rows={5}
                                  value={uploadText}
                                  onChange={(e) => setUploadText(e.target.value)}
                                  placeholder="Owner Name,Property Address,Mailing Address,Parcel ID,Assessed Value&#10;Jane Heir,123 Main St,PO Box 9,PID-001,$120000"
                                  className="font-mono text-xs"
                                />
                                <Button size="sm" disabled={busy} onClick={() => doUpload(s.id)}>
                                  {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                                  Ingest into {s.name}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Scored prospects ── */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Scored Prospects {counts.total ? <span className="text-sm font-normal text-gray-400">({counts.new_count ?? 0} new / {counts.total} total)</span> : null}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Input placeholder="County contains…" value={county} onChange={(e) => setCounty(e.target.value)} className="w-48" />
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded px-2 py-1 text-sm">
                <option value="">All categories</option>
                <option value="seller">Seller</option>
                <option value="buyer">Buyer</option>
              </select>
              <label className="text-sm text-gray-500">Min score</label>
              <Input type="number" value={minScore} onChange={(e) => setMinScore(Number(e.target.value) || 0)} className="w-20" />
              <Button size="sm" disabled={busy || leads.length === 0} onClick={createCampaign} className="ml-auto">
                {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Rocket className="h-3 w-3 mr-1" />}
                Create campaign from segment
              </Button>
            </div>

            {prospectsLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin opacity-30" /></div>
            ) : leads.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">
                No sourced leads yet. Upload a county file for a source above to populate this table.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Score</th>
                      <th className="pr-3">Owner</th>
                      <th className="pr-3">Property</th>
                      <th className="pr-3">County</th>
                      <th className="pr-3">Type</th>
                      <th className="pr-3">Assessed</th>
                      <th className="pr-3">Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => (
                      <Fragment key={l.id}>
                        <tr className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <span className={`font-semibold ${l.distress_score >= 70 ? 'text-red-600' : l.distress_score >= 40 ? 'text-amber-600' : 'text-gray-500'}`}>{l.distress_score}</span>
                          </td>
                          <td className="pr-3">{l.owner_name || '—'}</td>
                          <td className="pr-3 max-w-[220px] truncate">{l.property_address || '—'}</td>
                          <td className="pr-3">{l.county || '—'}</td>
                          <td className="pr-3"><Badge variant="outline">{l.record_type}</Badge></td>
                          <td className="pr-3">{money(l.assessed_value_cents)}</td>
                          <td className="pr-3">{l.status === 'handed_off' ? <Badge className="bg-blue-100 text-blue-700">handed off</Badge> : <Badge variant="outline">new</Badge>}</td>
                          <td className="pr-3">
                            <button className="text-gray-400 hover:text-gray-700" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                              {expanded === l.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                        </tr>
                        {expanded === l.id && (
                          <tr>
                            <td colSpan={8} className="pb-3">
                              <div className="bg-gray-50 rounded p-3 text-xs space-y-2">
                                <div>
                                  <div className="font-medium text-gray-700 mb-1">Why this scored {l.distress_score}</div>
                                  <ul className="list-disc pl-5 text-gray-600">
                                    {(l.score_reasons || []).map((r: string, i: number) => <li key={i}>{r}</li>)}
                                  </ul>
                                </div>
                                <div className="text-gray-500">
                                  <span className="font-medium">Provenance:</span> {l.source_name} · {l.provenance?.public_record_type} · fetched {l.provenance?.fetch_date ? new Date(l.provenance.fetch_date).toLocaleDateString() : '—'} · {l.provenance?.ingest}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
