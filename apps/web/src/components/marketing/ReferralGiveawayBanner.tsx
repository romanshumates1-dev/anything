import Link from 'next/link';
import { ArrowRight, Gift, Users } from 'lucide-react';

/**
 * REFERRAL / FIRST 1,000 USERS BANNER (logged-out promotional banner).
 *
 * The only approved promotional facts are the ones the business supplied:
 * "First 1,000 users" and "referral-based cash-prize giveaway". This
 * component states exactly those and NOTHING else — no prize amounts, no
 * odds, no deadlines, no "winner will be chosen by…" mechanics, because
 * official giveaway terms have not been published yet. The small print says
 * so explicitly, so the banner can never read as a fabricated legal offer.
 *
 * Rendered only on logged-out marketing surfaces (the landing page redirects
 * authenticated users to /dashboard, so placement there is inherently
 * logged-out-only).
 *
 * The CTA points at /account/signup — the REAL signup route. The referral
 * link generator historically pointed at /signup, which 404s in production;
 * see `src/app/signup/route.ts` (legacy redirect) and the
 * referral-link-integrity test.
 */
export function ReferralGiveawayBanner() {
  return (
    <section
      data-testid="referral-giveaway-banner"
      aria-label="First 1,000 users referral cash-prize giveaway"
      className="border-b border-white/10 bg-[#0A0F1A]"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-3 text-center sm:px-6 lg:flex-row lg:justify-between lg:px-8 lg:text-left">
        <div className="flex flex-col items-center gap-1 lg:flex-row lg:items-center lg:gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-300">
            <Users className="h-3 w-3" aria-hidden="true" />
            First 1,000 users
          </span>
          <p className="text-sm text-slate-300">
            <span className="inline-flex items-center gap-1.5 font-semibold text-white">
              <Gift className="h-4 w-4 text-amber-300" aria-hidden="true" />
              Referral-based cash-prize giveaway
            </span>
            <span className="mx-2 hidden text-slate-600 sm:inline">|</span>
            <span className="text-slate-400">
              Join early, share your personal referral link, and qualify with the
              first 1,000 users.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/account/signup"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-1.5 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-slate-200"
            prefetch={false}
          >
            Claim your spot
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
      <p className="mx-auto max-w-7xl px-4 pb-2 text-center text-xs text-slate-500 sm:px-6 lg:px-8 lg:text-left">
        Giveaway terms, eligibility, and prize details will be published before
        any prize is awarded. No prize amounts or odds are stated here.
      </p>
    </section>
  );
}

export default ReferralGiveawayBanner;
