'use client';

import { useEffect, useState, useCallback } from 'react';

type Suppression = { target: string; channel: string; metadata: any; created_at: string };

export default function AdminCompliancePage() {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const params = query ? `?q=${encodeURIComponent(query)}` : '';
      const res = await fetch(`/api/admin/compliance${params}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.suppressions);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(''); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Suppression List ({total} total)</h1>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
          <button onClick={() => load(q)} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">Search</button>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-500">Numbers that replied STOP (or otherwise opted out) — all future sends are blocked server-side.</p>
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">No suppressed numbers.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Number</th><th className="px-4 py-2">Channel</th><th className="px-4 py-2">Reason</th><th className="px-4 py-2">When</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-mono text-gray-900">{r.target}</td>
                  <td className="px-4 py-2">{r.channel}</td>
                  <td className="px-4 py-2 text-gray-500">{r.metadata?.reason || '—'}</td>
                  <td className="px-4 py-2 text-gray-400">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
