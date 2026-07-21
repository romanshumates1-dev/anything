'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function ReviewsContent() {
  const [stats, setStats] = useState<{ average: number; count: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reviews')
      .then(res => res.json())
      .then(data => {
        setStats(data.aggregate);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Customer Reviews</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">Loading...</p>
      </div>
    );
  }

  if (!stats || stats.count === 0) {
    return (
      <div className="text-center mb-16">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Customer Reviews</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          See what real customers have to say about DealFlow AI.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center py-20">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 mb-6">
        <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.004 9.004 0 01-6.293-3.555L3 21l2.555-2.293A8.966 8.966 0 0112 20c5.523 0 10-3.36 10-7.5S17.523 5 12 5C6.477 5 2.457 8.36 2.457 12.5c0 1.41.457 2.71.97 3.879" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-3">
        Be the first to review DealFlow AI
      </h2>
      <p className="text-gray-600 mb-6 max-w-lg mx-auto">
        No reviews yet. Sign up to become our first verified customer and share your experience.
      </p>
      <Link
        href="/contact"
        className="inline-block rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Contact Us
      </Link>
    </div>
  );
}