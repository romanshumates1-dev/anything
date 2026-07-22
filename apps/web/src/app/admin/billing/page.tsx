'use client';

import { useEffect, useState, useCallback } from 'react';

type Sub = {
  id: string;
  status: string;
  organization_name: string;
  plan_name: string;
  price_cents: number;
  current_period_end: string | null;
  stripe_subscription_id: string | null;
};

type Payment = {
  id: string;
  contract_id: string;
  amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
};

export default function AdminBillingPage() {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        fetch('/api/admin/subscriptions').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/payments?status=paid').then((r) => (r.ok ? r.json() : { payments: [] })),
      ]);
      setSubs(Array.isArray(s) ? s : []);
      setPayments(Array.isArray(p?.payments) ? p.payments : Array.isArray(p) ? p : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refund = async (p: Payment) => {
    const reason = prompt(`Refund payment ${p.id} — reason (required):`);
    if (!reason) return;
    setBusy(p.id);
    setMsg(null);
    try {
      const res = await fetch('/api/payments/refund', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId: p.id, reason }),
      });
      const body = await res.json().catch(() => ({}));
      setMsg(res.ok ? `Refunded via ${body.provider} (${body.refundId})` : (body?.error || `error ${res.status}`));
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Billing & Refunds</h1>
        <a href="/api/admin/exports/finance" className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">Export finance CSV</a>
      </div>
      {msg && <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">{msg}</div>}

      <h2 className="text-sm font-semibold uppercase text-gray-500 mb-2">Subscriptions</h2>
      {loading ? <p className="text-gray-500">Loading…</p> : subs.length === 0 ? (
        <p className="text-gray-500 mb-6">No subscriptions.</p>
      ) : (
        <div className="mb-8 overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Organization</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Renews</th></tr>
            </thead>
            <tbody className="divide-y">
              {subs.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-gray-900">{s.organization_name}</td>
                  <td className="px-4 py-2">{s.plan_name} (${(s.price_cents / 100).toFixed(0)})</td>
                  <td className="px-4 py-2">{s.status}</td>
                  <td className="px-4 py-2 text-gray-400">{s.current_period_end ? new Date(s.current_period_end).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase text-gray-500 mb-2">Paid Payments (refundable)</h2>
      {payments.length === 0 ? (
        <p className="text-gray-500">No paid payments.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Payment</th><th className="px-4 py-2">Contract</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Action</th></tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{p.id.slice(0, 16)}</td>
                  <td className="px-4 py-2 text-gray-500">{p.contract_id}</td>
                  <td className="px-4 py-2">${(p.amount_cents / 100).toFixed(2)}</td>
                  <td className="px-4 py-2">{p.status}</td>
                  <td className="px-4 py-2">
                    <button disabled={busy === p.id} onClick={() => refund(p)} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 disabled:opacity-40">Refund</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
