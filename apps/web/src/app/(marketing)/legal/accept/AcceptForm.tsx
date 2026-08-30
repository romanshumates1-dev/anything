'use client';

import Link from 'next/link';
import { useState } from 'react';

export function AcceptForm({ termsVersion, privacyVersion }: { termsVersion: string; privacyVersion: string }) {
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/legal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: ['tos', 'privacy'] }),
      });
      if (res.ok) {
        // Full navigation so the middleware re-evaluates with the new rows.
        window.location.href = '/dashboard';
      } else if (res.status === 401) {
        window.location.href = '/account/signin?callbackUrl=%2Flegal%2Faccept';
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json?.error || 'Could not record your acceptance. Please try again.');
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-6 shadow-sm">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
        <span className="text-sm text-gray-700">
          I have read and agree to the{' '}
          <Link href="/legal/terms" className="text-blue-700 hover:underline" target="_blank">Terms of Service</Link>{' '}
          (v{termsVersion}) and{' '}
          <Link href="/legal/privacy" className="text-blue-700 hover:underline" target="_blank">Privacy Policy</Link>{' '}
          (v{privacyVersion}).
        </span>
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={accept}
        disabled={!checked || submitting}
        className="mt-6 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-blue-800"
      >
        {submitting ? 'Saving...' : 'Accept and continue'}
      </button>
    </div>
  );
}
