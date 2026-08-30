'use client';

import { useEffect, useState } from 'react';

type AuditRow = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: any;
  created_at: string;
};

export default function AdminAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/audit-log?limit=200')
      .then((r) => r.json())
      .then((d) => { setRows(d.logs || []); setTotal(d.pagination?.total ?? 0); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Audit Log ({total} entries)</h1>
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500">No audit entries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Actor</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Target</th><th className="px-4 py-2">Details</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-gray-600">{r.actor_email || '—'}</td>
                  <td className="px-4 py-2"><span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{r.action}</span></td>
                  <td className="px-4 py-2 text-gray-500">{r.target_type}{r.target_id ? `:${r.target_id.slice(0, 12)}` : ''}</td>
                  <td className="px-4 py-2 text-xs text-gray-400 max-w-xs truncate">{r.metadata ? JSON.stringify(r.metadata) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
