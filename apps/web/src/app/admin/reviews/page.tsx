'use client';

import { useEffect, useState, useCallback } from 'react';

type PendingReview = {
  id: string;
  rating: number;
  title: string;
  body: string;
  is_demo: boolean;
  user_name: string | null;
  user_email: string | null;
  created_at: string;
};

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/reviews');
      if (res.ok) setReviews(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const moderate = async (id: string, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? prompt('Rejection reason (optional):') || undefined : undefined;
    setBusy(id);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/reviews', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reviewId: id, action, reason }),
      });
      const body = await res.json().catch(() => ({}));
      setMsg(res.ok ? `${action}d` : (body?.error?.message || body?.error || `error ${res.status}`));
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Reviews Moderation ({reviews.length} pending)</h1>
      {msg && <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">{msg}</div>}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="text-gray-500">No pending reviews.</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="text-amber-500">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                {r.is_demo && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">DEMO</span>}
              </div>
              <h3 className="font-semibold text-gray-900">{r.title}</h3>
              <p className="text-sm text-gray-600 my-1">{r.body}</p>
              <p className="text-xs text-gray-400">{r.user_email || r.user_name || 'unknown'}</p>
              <div className="mt-3 flex gap-2">
                <button disabled={busy === r.id} onClick={() => moderate(r.id, 'approve')} className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Approve</button>
                <button disabled={busy === r.id} onClick={() => moderate(r.id, 'reject')} className="rounded bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40">Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
