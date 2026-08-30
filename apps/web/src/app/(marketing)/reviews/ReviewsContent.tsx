'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useSession } from '@/lib/auth-client';
import type { ReviewsPageResult } from '@/app/api/reviews/queries';

type ReviewsData = ReviewsPageResult;
type SortKey = 'newest' | 'oldest' | 'highest' | 'lowest';

// Privacy: never show a full account name publicly — "First L." only. Demo
// rows already come from the API as "First L." (demo_display_name), but real
// account names come through as full names, so this truncation is enforced
// once here for every row regardless of source.
function displayName(name: string | null): string {
  if (!name) return 'Anonymous';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

function Stars({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'w-6 h-6' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} className={`${cls} ${n <= rating ? 'text-amber-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.363 1.118l1.287 3.959c.299.921-.755 1.688-1.539 1.118l-3.368-2.448a1 1 0 00-1.176 0l-3.368 2.448c-.783.57-1.838-.197-1.539-1.118l1.287-3.96a1 1 0 00-.363-1.117L2.9 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.286-3.958z" />
        </svg>
      ))}
    </div>
  );
}

// Authenticated-customer submission form. The API is the real enforcement
// (auth + purchase-verification + rate limit + one-per-user) — this is just
// the UI surface, which previously did not exist anywhere in the app despite
// the endpoint being fully built (bug: a backend nothing could reach).
function WriteReviewForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (isPending) return null;

  if (!session) {
    return (
      <div className="text-center mb-10">
        <Link href="/account/signin?callbackUrl=%2Freviews" className="text-sm text-blue-600 hover:underline">
          Sign in as a customer to write a review
        </Link>
      </div>
    );
  }

  if (!open && !result) {
    return (
      <div className="text-center mb-10">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-blue-600 px-5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
        >
          Write a Review
        </button>
      </div>
    );
  }

  if (result) {
    return (
      <div className={`mb-10 rounded-lg border px-4 py-3 text-center text-sm ${result.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
        {result.message}
      </div>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, title, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult({ ok: true, message: 'Thanks! Your review has been submitted and is pending approval.' });
        setOpen(false);
        onSubmitted();
      } else {
        setResult({ ok: false, message: json?.error?.message || 'Could not submit your review.' });
      }
    } catch {
      setResult({ ok: false, message: 'Network error — please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-10 max-w-lg mx-auto rounded-xl border bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-gray-900 mb-3">Write a Review</h3>
      <div className="flex gap-1 mb-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
            <svg className={`w-7 h-7 ${n <= rating ? 'text-amber-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.363 1.118l1.287 3.959c.299.921-.755 1.688-1.539 1.118l-3.368-2.448a1 1 0 00-1.176 0l-3.368 2.448c-.783.57-1.838-.197-1.539-1.118l1.287-3.96a1 1 0 00-.363-1.117L2.9 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.286-3.958z" />
            </svg>
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 200))}
        placeholder="Title"
        className="w-full mb-3 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 5000))}
        placeholder="Tell us about your experience..."
        rows={4}
        className="w-full mb-3 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)} className="text-sm text-gray-500 px-3 py-2">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || rating < 1 || !title.trim() || !body.trim()}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {submitting ? 'Submitting...' : 'Submit Review'}
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-6">
        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.004 9.004 0 01-6.293-3.555L3 21l2.555-2.293A8.966 8.966 0 0112 20c5.523 0 10-3.36 10-7.5S17.523 5 12 5C6.477 5 2.457 8.36 2.457 12.5c0 1.41.457 2.71.97 3.879" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-3">Be the first to review DealFlow AI</h2>
      <p className="text-gray-600 mb-6 max-w-lg mx-auto">No reviews yet. Sign up to become our first verified customer and share your experience.</p>
      <Link href="/contact" className="inline-block rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700">
        Contact Us
      </Link>
    </div>
  );
}

export function ReviewsContent({ initialData }: { initialData: ReviewsData | null }) {
  const [data, setData] = useState<ReviewsData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortKey>('newest');
  const [stars, setStars] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(async (p: number, s: SortKey, starFilter: number | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), sort: s });
      if (starFilter) params.set('stars', String(starFilter));
      const res = await fetch(`/api/reviews?${params}`);
      if (res.ok) setData(await res.json());
    } catch {
      // keep whatever data is already on screen rather than blanking the page
    } finally {
      setLoading(false);
    }
  }, []);

  // Skip the redundant fetch on first mount — the server already fetched
  // page 1 / newest / no filter and passed it in as initialData.
  useEffect(() => {
    if (!hydrated) {
      setHydrated(true);
      return;
    }
    load(page, sort, stars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sort, stars]);

  if (!data) {
    return (
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Customer Reviews</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">See what real customers have to say about DealFlow AI.</p>
      </div>
    );
  }

  const { aggregate, pagination, reviews, hasDemoData } = data;
  const refresh = () => load(1, sort, stars);

  if (aggregate.count === 0) {
    return (
      <>
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Customer Reviews</h1>
        </div>
        <WriteReviewForm onSubmitted={refresh} />
        <EmptyState />
      </>
    );
  }

  const maxBar = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => aggregate.distribution[n] || 0));

  return (
    <div>
      {hasDemoData && (
        <div className="mb-8 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-800">
          SAMPLE DATA — demo environment. These reviews are synthetic test data, not real customer feedback.
        </div>
      )}

      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Customer Reviews</h1>
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-5xl font-bold text-gray-900">{aggregate.average.toFixed(1)}</span>
          <div className="flex flex-col items-start">
            <Stars rating={Math.round(aggregate.average)} size="lg" />
            <span className="text-sm text-gray-500">{aggregate.count.toLocaleString()} review{aggregate.count === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      <WriteReviewForm onSubmitted={refresh} />

      <div className="mb-12 max-w-md mx-auto space-y-1.5">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = aggregate.distribution[n] || 0;
          const pct = Math.round((count / maxBar) * 100);
          return (
            <button
              key={n}
              onClick={() => { setStars(stars === n ? null : n); setPage(1); }}
              className={`flex items-center gap-3 w-full text-left rounded px-2 py-1 hover:bg-gray-50 ${stars === n ? 'bg-blue-50' : ''}`}
            >
              <span className="text-sm text-gray-600 w-3">{n}</span>
              <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.363 1.118l1.287 3.959c.299.921-.755 1.688-1.539 1.118l-3.368-2.448a1 1 0 00-1.176 0l-3.368 2.448c-.783.57-1.838-.197-1.539-1.118l1.287-3.96a1 1 0 00-.363-1.117L2.9 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.286-3.958z" />
              </svg>
              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm text-gray-500 w-10 text-right">{count}</span>
            </button>
          );
        })}
        {stars && (
          <button onClick={() => { setStars(null); setPage(1); }} className="text-sm text-blue-600 hover:underline pl-2">
            Clear filter
          </button>
        )}
      </div>

      <div className="flex justify-end mb-4">
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as SortKey); setPage(1); }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="highest">Highest rated</option>
          <option value="lowest">Lowest rated</option>
        </select>
      </div>

      <div className={`space-y-4 ${loading ? 'opacity-50' : ''}`}>
        {reviews.map((r) => (
          <div key={r.id} className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <Stars rating={r.rating} size="sm" />
              <span className="text-xs text-gray-400">{relativeDate(r.created_at)}</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">{r.title}</h3>
            <p className="text-sm text-gray-600 mb-3">{r.body}</p>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-medium">{displayName(r.user_name)}</span>
              {r.verified_customer && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-green-700 font-medium">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                  Verified customer
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-10">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pagination.page <= 1}
            className="text-sm text-gray-600 disabled:text-gray-300 hover:text-gray-900"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {pagination.page} of {pagination.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
            disabled={pagination.page >= pagination.pages}
            className="text-sm text-gray-600 disabled:text-gray-300 hover:text-gray-900"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
