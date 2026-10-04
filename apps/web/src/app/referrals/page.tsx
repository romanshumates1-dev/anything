'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { Loader2, Gift } from 'lucide-react';
import { ReferralDashboard } from '@/components/referrals/ReferralDashboard';

/**
 * REFERRALS — authenticated referral dashboard.
 *
 * Surfacing fix (final acceptance audit, 2026-10-04): `ReferralDashboard`
 * existed as a component but was imported by no route, so the referral
 * program had a backend (`/api/referrals*`), share links, rewards and a
 * dashboard component that NO user could ever reach. This page mounts it
 * behind the same session guard the leaderboard uses.
 *
 * The dashboard reads GET /api/referrals itself (React Query) and renders
 * its honest empty/error states, so no data is fabricated here.
 */
export default function ReferralsPage() {
  const { data: session, isPending: authLoading } = useSession();

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" aria-hidden="true" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#3B82F6]/10">
          <Gift className="h-5 w-5 text-[#3B82F6]" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Referrals</h1>
          <p className="text-sm text-slate-400">
            Share your link, track signups, and earn referral credits.
          </p>
        </div>
      </div>
      <ReferralDashboard />
    </div>
  );
}
