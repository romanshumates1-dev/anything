'use client';

/**
 * REQUIREMENT SET V3 — rewards UI: weekly spin wheel, battle pass, use codes and
 * giveaways.
 *
 * HONESTY RULES THIS PAGE ENFORCES (roman.agent.md)
 * --------------------------------------------------
 * 1. "Avoid gambling-like mechanics that create actual monetary wagering." Every
 *    reward rendered here is XP or a cosmetic key. Nothing on this page displays
 *    a cash value, a credit amount, or an "expected return". The one monetary
 *    item in the schema is the giveaway, and it is shown as *operator-run and
 *    funded by us*, with no odds and no purchase.
 * 2. "Do NOT claim they are empirically '10/10 optimized' unless verified with
 *    actual product data." No projected/estimated earnings appear anywhere.
 * 3. Gamification OFF is handled explicitly. `/api/rewards` returns 404 (not
 *    403) so the feature's existence is not disclosed, so a 404 is rendered as
 *    "turned off" rather than a generic failure — matching `app/achievements`.
 * 4. Server is authoritative. `claimed`, `eligible`, `entered` and
 *    `spinsRemaining` come from the API; this page never recomputes or guesses
 *    them. A mutation refetches rather than optimistically inventing a result,
 *    so the UI can never claim a prize the backend refused.
 */
import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { MetricValue } from '@/components/ui/MetricValue';
// Client-safe pure module: same file the server uses, so the cap shown here and
// the cap enforced in SQL can never drift apart.
import { MAX_SPINS_PER_WEEK, SPINS_PER_ACHIEVEMENT_POINT } from '@/app/api/utils/gamificationRewards';
import {
  Loader2,
  Gift,
  Ticket,
  CheckCircle2,
  Lock,
  Sparkles,
  Info,
} from 'lucide-react';

interface BattlePassTier {
  id: number;
  tier: number;
  xpRequired: number;
  rewardXp: number;
  label: string;
  claimed: boolean;
  eligible: boolean;
}

interface Giveaway {
  id: number;
  name: string;
  description: string;
  prizeDescription: string;
  entriesRequired: number;
  drawsAt: string;
  entered: boolean;
  remaining: number;
}

interface RewardsData {
  xp: number;
  level: number;
  achievementPoints: number;
  spinsRemaining: number;
  battlePass: BattlePassTier[];
  giveaways: Giveaway[];
}

/**
 * Read an error response's JSON body without swallowing a parse failure.
 *
 * WHY NOT `.catch(() => ({}))`
 * ----------------------------
 * That is the swallowed-error class the guard at
 * api/__tests__/security/swallowed-error.guard.test.ts exists to prevent, and it
 * made this file fail the suite. It is worse than it looks here: if the server
 * returns HTML (a proxy 502, a Workers error page) the parse throws, `{}` is
 * substituted, and the page reports a generic "Request failed" — hiding the fact
 * that the response was not the API at all. The user sees a wrong error and
 * nobody investigates.
 *
 * `app/achievements/page.tsx` has no such site for the same reason: it reads the
 * status code, which is always available, and only trusts the body when it
 * really parsed.
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error || fallback;
  } catch (cause) {
    // Logged, not hidden: a non-JSON error body means something upstream of this
    // page failed, and that is exactly what has to be diagnosable.
    console.error(`[rewards] non-JSON error body (HTTP ${res.status})`, cause);
    return fallback;
  }
}

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/rewards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Request failed'));
  }
  // No catch: a malformed SUCCESS body must surface, not render as an empty
  // wallet. Swallowing it here is how a broken deploy looks like a new account.
  return res.json();
}

export default function RewardsPage() {
  // `useSession` here exposes `isPending`, not `isLoading` — matches how
  // app/achievements reads it.
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [lastPrize, setLastPrize] = useState<string | null>(null);

  const {
    data: rewards,
    isLoading,
    error,
  } = useQuery<RewardsData>({
    queryKey: ['rewards'],
    queryFn: async () => {
      const res = await fetch('/api/rewards');
      if (!res.ok) {
        // Surface the server's own message so a 404 (gamification OFF) is
        // distinguishable from a 500 here, exactly as achievements does.
        throw new Error(
          res.status === 404
            ? 'Rewards are turned off for your account.'
            : await errorMessage(res, 'Could not load your rewards.'),
        );
      }
      return res.json();
    },
    enabled: !!session,
    retry: false,
  });

  const act = useMutation({
    mutationFn: post,
    // Refetch rather than patch local state: the server decides whether a spin,
    // code or tier was actually granted, and the page must not claim otherwise.
    // Clear the code field only when the server confirmed the redemption.
    // `mutate` returns void in this react-query version, so clearing here (in
    // onSuccess) is the only correct place — clearing before the response would
    // imply success the backend may not have granted.
    onSuccess: async (_result, variables) => {
      if (variables.action === 'spin') {
        setLastPrize(String(_result?.prizeKey ?? 'reward'));
      }
      if (variables.action === 'redeem') {
        setCode('');
      }
      await queryClient.invalidateQueries({ queryKey: ['rewards'] });
    },
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">Rewards</h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          Earn XP as you work. Rewards are cosmetic and experience-based — they
          never convert to money or AI credits.
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : error ? (
        <GlassCard className="py-12 text-center">
          <p className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
            {error instanceof Error ? error.message : 'Could not load your rewards.'}
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            You can turn rewards back on in Settings → Preferences.
          </p>
        </GlassCard>
      ) : (
        <>
          {/* Balances. `MetricValue` has no `label` prop, so the caption is
              rendered alongside it rather than passed in. */}
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <GlassCard className="text-center">
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Total XP
              </p>
              <MetricValue value={rewards?.xp ?? 0} />
            </GlassCard>
            <GlassCard className="text-center">
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Level
              </p>
              <MetricValue value={rewards?.level ?? 1} />
            </GlassCard>
            <GlassCard className="text-center">
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Spins available
              </p>
              <MetricValue value={rewards?.spinsRemaining ?? 0} />
            </GlassCard>
          </div>

          {/* Weekly spin wheel */}
          <GlassCard className="mb-6">
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[var(--accent-blue)]" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Weekly spin
              </h2>
            </div>
            <p className="mb-4 text-sm text-[var(--text-muted)]">
              Spins are earned from your achievement progress — one per{' '}
              {SPINS_PER_ACHIEVEMENT_POINT} points, up to {MAX_SPINS_PER_WEEK} in
              total. They reset weekly and cannot be bought.
            </p>
            <button
              type="button"
              disabled={
                act.isPending || (rewards?.spinsRemaining ?? 0) <= 0 || act.isError
              }
              onClick={() => act.mutate({ action: 'spin' })}
              className="rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {act.isPending ? 'Spinning…' : 'Spin'}
            </button>
            {lastPrize && (
              <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                You won: {lastPrize.replace(/_/g, ' ')}
              </p>
            )}
            {act.isError && (
              <p className="mt-3 text-sm text-red-400">
                {act.error instanceof Error ? act.error.message : 'Spin failed.'}
              </p>
            )}
          </GlassCard>

          {/* Battle pass */}
          <GlassCard className="mb-6">
            <h2 className="mb-4 text-lg font-semibold text-[var(--text-primary)]">
              Season pass
            </h2>
            {!rewards?.battlePass?.length ? (
              <p className="text-sm text-[var(--text-muted)]">
                No season is running right now. Tiers appear here when a season
                opens.
              </p>
            ) : (
              <ul className="space-y-2">
                {rewards.battlePass.map((tier) => (
                  <li
                    key={tier.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] p-3"
                  >
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">
                        Tier {tier.tier}
                        {tier.label ? ` — ${tier.label}` : ''}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {tier.xpRequired} XP required
                        {tier.rewardXp > 0 ? ` · rewards ${tier.rewardXp} XP` : ''}
                      </p>
                    </div>
                    {tier.claimed ? (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <CheckCircle2 className="h-4 w-4" /> Claimed
                      </span>
                    ) : tier.eligible ? (
                      <button
                        type="button"
                        disabled={act.isPending}
                        onClick={() =>
                          act.mutate({ action: 'claim-tier', tierId: tier.id })
                        }
                        className="rounded-lg bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Claim
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <Lock className="h-4 w-4" /> Locked
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {/* Use codes */}
          <GlassCard className="mb-6">
            <div className="mb-1 flex items-center gap-2">
              <Ticket className="h-5 w-5 text-[var(--accent-blue)]" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Redeem a code
              </h2>
            </div>
            <p className="mb-4 text-sm text-[var(--text-muted)]">
              Codes grant XP only (up to 10x). Each code can be redeemed once per
              account.
            </p>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter code"
                aria-label="Reward code"
                className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
              />
              <button
                type="button"
                disabled={act.isPending || !code.trim()}
                onClick={() => act.mutate({ action: 'redeem', code: code.trim() })}
                className="rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Redeem
              </button>
            </div>
            {act.isError && (
              <p className="mt-3 text-sm text-red-400">
                {act.error instanceof Error ? act.error.message : 'Could not redeem.'}
              </p>
            )}
          </GlassCard>

          {/* Giveaways */}
          <GlassCard>
            <div className="mb-1 flex items-center gap-2">
              <Gift className="h-5 w-5 text-[var(--accent-blue)]" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Giveaways
              </h2>
            </div>
            <p className="mb-4 flex items-start gap-2 text-sm text-[var(--text-muted)]">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Giveaways are promotions we fund ourselves. Entering is free,
                one entry per person, and the draw is run by us — there is no
                purchase and no stake.
              </span>
            </p>
            {!rewards?.giveaways?.length ? (
              <p className="text-sm text-[var(--text-muted)]">
                No giveaways are open right now.
              </p>
            ) : (
              <ul className="space-y-2">
                {rewards.giveaways.map((giveaway) => (
                  <li
                    key={giveaway.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] p-3"
                  >
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">
                        {giveaway.name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {giveaway.prizeDescription} · draw {new Date(
                          giveaway.drawsAt,
                        ).toLocaleDateString()}
                        {giveaway.remaining > 0
                          ? ` · ${giveaway.remaining} entries left`
                          : ''}
                      </p>
                    </div>
                    {giveaway.entered ? (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <CheckCircle2 className="h-4 w-4" /> Entered
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={act.isPending}
                        onClick={() =>
                          act.mutate({ action: 'enter-giveaway', giveawayId: giveaway.id })
                        }
                        className="rounded-lg bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Enter
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}