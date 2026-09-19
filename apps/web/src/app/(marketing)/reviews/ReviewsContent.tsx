'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useSession } from '@/lib/auth-client';
import { CheckCircle, MessageSquare } from 'lucide-react';
import type { ReviewsPageResult } from '@/app/api/reviews/queries';

type ReviewsData = ReviewsPageResult;
type SortKey = 'newest' | 'oldest' | 'highest' | 'lowest';

// Privacy: never show a full account name publicly - "First L." only. Demo
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
        <svg key={n} className={`${cls} ${n <= rating ? 'text-amber-400' : 'text-slate-600'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.363 1.118l1.287 3.959c.299.921-.755 1.688-1.539 1.118l-3.368-2.448a1 1 0 00-1.176 0l-3.368 2.448c-.783.57-1.838-.197-1.539-1.118l1.287-3.96a1 1 0 00-.363-1.117L2.9 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.286-3.958z" />
        </svg>
      ))}
    </div>
  );
}

// Authenticated-customer submission form
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
        <Link href="/account/signin?callbackUrl=%2Freviews" className="text-sm text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
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
          className="rounded-lg border border-[#3B82F6] px-5 py-2.5 text-sm font-semibold text-[#3B82F6] hover:bg-[#3B82F6]/10 transition-colors"
        >
          Write a Review
        </button>
      </div>
    );
  }

  if (result) {
    return (
      <div className={`mb-10 rounded-lg border px-4 py-3 text-center text-sm ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
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
      setResult({ ok: false, message: 'Network error - please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mb-10 max-w-lg mx-auto rounded-xl border border-white/10 bg-[#1E293B]/50 p-6">
      <h3 className="font-semibold text-white mb-4">Write a Review</h3>
      <div className="flex gap-1 mb-4">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
            <svg className={`w-8 h-8 ${n <= rating ? 'text-amber-400' : 'text-slate-600'} transition-colors`} fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.363 1.118l1.287 3.959c.299.921-.755 1.688-1.539 1.118l-3.368-2.448a1 1 0 00-1.176 0l-3.368 2.448c-.783.57-1.838-.197-1.539-1.118l1.287-3.96a1 1 0 00-.363-1.117L2.9 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.286-3.958z" />
            </svg>
          </button>
        ))}
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, 200))}
        placeholder="Title"
        className="w-full mb-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] transition-colors"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, 5000))}
        placeholder="Tell us about your experience..."
        rows={4}
        className="w-full mb-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] transition-colors resize-none"
      />
      <div className="flex gap-3 justify-end">
        <button onClick={() => setOpen(false)} className="text-sm text-slate-400 px-4 py-2 hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || rating < 1 || !title.trim() || !body.trim()}
          className="rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-all"
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
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#1E293B] mb-6">
        <MessageSquare className="w-10 h-10 text-slate-500" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">Be the first to review DealFlow AI</h2>
      <p className="text-slate-400 mb-6 max-w-lg mx-auto">No reviews yet. Sign up to become our first verified customer and share your experience.</p>
      <Link href="/contact" className="inline-block rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/25">
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

  // Skip the redundant fetch on first mount - the server already fetched
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
        <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Reviews</span>
        <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">Customer Reviews</h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto">See what real customers have to say about DealFlow AI.</p>
      </div>
    );
  }

  const { aggregate, pagination, reviews, hasDemoData } = data;
  const refresh = () => load(1, sort, stars);

  if (aggregate.count === 0) {
    return (
      <>
        <div className="text-center mb-16">
          <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Reviews</span>
          <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">Customer Reviews</h1>
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
        <div className="mb-8 rounded-lg border-2 border-dashed border-amber-500/50 bg-amber-500/10 px-4 py-3 text-center text-sm font-medium text-amber-400">
          SAMPLE DATA - demo environment. These reviews are synthetic test data, not real customer feedback.
        </div>
      )}

      <div className="text-center mb-12">
        <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Reviews</span>
        <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-6">Customer Reviews</h1>
        <div className="flex items-center justify-center gap-4 mb-2">
          <span className="text-5xl font-bold text-white">{aggregate.average.toFixed(1)}</span>
          <div className="flex flex-col items-start">
            <Stars rating={Math.round(aggregate.average)} size="lg" />
            <span className="text-sm text-slate-500 mt-1">{aggregate.count.toLocaleString()} review{aggregate.count === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      <WriteReviewForm onSubmitted={refresh} />

      <div className="mb-12 max-w-md mx-auto space-y-2">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = aggregate.distribution[n] || 0;
          const pct = Math.round((count / maxBar) * 100);
          return (
            <button
              key={n}
              onClick={() => { setStars(stars === n ? null : n); setPage(1); }}
              className={`flex items-center gap-3 w-full text-left rounded-lg px-3 py-2 transition-colors ${stars === n ? 'bg-[#3B82F6]/10' : 'hover:bg-white/5'}`}
            >
              <span className="text-sm text-slate-400 w-3">{n}</span>
              <svg className="w-4 h-4 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.363 1.118l1.287 3.959c.299.921-.755 1.688-1.539 1.118l-3.368-2.448a1 1 0 00-1.176 0l-3.368 2.448c-.783.57-1.838-.197-1.539-1.118l1.287-3.96a1 1 0 00-.363-1.117L2.9 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.286-3.958z" />
              </svg>
              <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-sm text-slate-500 w-10 text-right">{count}</span>
            </button>
          );
        })}
        {stars && (
          <button onClick={() => { setStars(null); setPage(1); }} className="text-sm text-[#3B82F6] hover:text-[#60A5FA] pl-3 transition-colors">
            Clear filter
          </button>
        )}
      </div>

      <div className="flex justify-end mb-6">
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value as SortKey); setPage(1); }}
          className="rounded-lg border border-white/10 bg-[#1E293B] px-4 py-2 text-sm text-white outline-none focus:border-[#3B82F6]"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="highest">Highest rated</option>
          <option value="lowest">Lowest rated</option>
        </select>
      </div>

      <div className={`space-y-4 ${loading ? 'opacity-50' : ''}`}>
        {reviews.map((r) => (
          <div key={r.id} className="rounded-xl border border-white/10 bg-[#1E293B]/30 p-6">
            <div className="flex items-center justify-between mb-3">
              <Stars rating={r.rating} size="sm" />
              <span className="text-xs text-slate-500">{relativeDate(r.created_at)}</span>
            </div>
            <h3 className="font-semibold text-white mb-2">{r.title}</h3>
            <p className="text-sm text-slate-400 mb-4 leading-relaxed">{r.body}</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-slate-300">{displayName(r.user_name)}</span>
              {r.verified_customer && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-emerald-400 font-medium">
                  <CheckCircle className="w-3 h-3" />
                  Verified customer
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-6 mt-12">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={pagination.page <= 1}
            className="text-sm text-slate-400 disabled:text-slate-600 hover:text-white transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-slate-500">Page {pagination.page} of {pagination.pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
            disabled={pagination.page >= pagination.pages}
            className="text-sm text-slate-400 disabled:text-slate-600 hover:text-white transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
