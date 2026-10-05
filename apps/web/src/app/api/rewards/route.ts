/**
 * REQUIREMENT SET V3 — reward surface: spin wheel, use codes, battle pass,
 * giveaways.
 *
 * Mounted at `/api/rewards`. This is the only place the reward economy is
 * reachable from the browser, so this is where the security boundaries sit:
 *
 *   1. `requireSession` first — an unauthenticated caller gets 401 and never
 *      reaches a query.
 *   2. `requireGamificationEnabled` second — roman.agent.md V: "When OFF: hide
 *      gamification features, avoid unnecessary queries." Server-side, not just
 *      a hidden nav link, because hiding the link does not stop a caller who
 *      knows the URL. Returns 404 so it does not confirm the feature exists.
 *   3. Every mutating action delegates to `gamificationRewards.server.ts`,
 *      whose claims are `INSERT ... ON CONFLICT DO NOTHING`. Nothing here does
 *      its own check-then-grant, because that pattern is a race.
 *
 * WHAT THIS ROUTE DELIBERATELY DOES NOT DO
 * ----------------------------------------
 * No action here touches AI credits, balances, withdrawals, or any monetary
 * value. An action response is XP and cosmetic keys only. The one monetary item
 * in the schema (`giveaways`) is entered here at no cost and its draw is
 * operator-run, so this route cannot be used to win or lose money.
 */
import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import { requireGamificationEnabled } from '@/app/api/utils/gamification.server';
import sql from '@/app/api/utils/sql';
import { levelForXp, remainingGiveawayEntries } from '@/app/api/utils/gamificationRewards';
import {
  claimBattlePassTier,
  currentAchievementPoints,
  currentXp,
  enterGiveaway,
  redeemUseCode,
  spinOnce,
  syncEarnedSpins,
} from '@/app/api/utils/gamificationRewards.server';

/** The actions this route accepts. Anything else is a 400 before any query. */
const ACTIONS = ['spin', 'redeem', 'claim-tier', 'enter-giveaway'] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return ACTIONS.includes(value as Action);
}

/** Read the caller's reward state. Never mutates anything except spin sync. */
export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const disabled = await requireGamificationEnabled(session.userId);
  if (disabled) return disabled;

  try {
    const xp = await currentXp(session.userId);
    const achievementPoints = await currentAchievementPoints(session.userId);
    const spins = await syncEarnedSpins(session.userId);

    const [wallet] = await sql`
      SELECT spins_remaining FROM public.user_spin_wallet WHERE user_id = ${session.userId}
    `;

    const tiers = await sql`
      SELECT t.id, t.tier, t.xp_required, t.reward_xp, t.label,
             (c.id IS NOT NULL) AS claimed
        FROM public.battle_pass_tiers t
        LEFT JOIN public.user_battle_pass_claims c
          ON c.tier_id = t.id AND c.user_id = ${session.userId}
       ORDER BY t.tier ASC
    `;

    const giveaways = await sql`
      SELECT g.id, g.name, g.description, g.prize_description,
             g.entries_required, g.draws_at,
             (e.entry_number IS NOT NULL) AS entered,
             (SELECT count(*) FROM public.giveaway_entries x
               WHERE x.giveaway_id = g.id)::int AS total_entries
        FROM public.giveaways g
        LEFT JOIN public.giveaway_entries e
          ON e.giveaway_id = g.id AND e.user_id = ${session.userId}
       WHERE g.is_active = true AND g.draws_at > now()
       ORDER BY g.draws_at ASC
    `;

    return NextResponse.json({
      xp,
      level: levelForXp(xp),
      achievementPoints,
      spinsRemaining:
        typeof wallet?.spins_remaining === 'number' ? wallet.spins_remaining : spins,
      battlePass: tiers.map((tier: Record<string, unknown>) => ({
        id: Number(tier.id),
        tier: Number(tier.tier),
        xpRequired: Number(tier.xp_required),
        rewardXp: Number(tier.reward_xp),
        label: String(tier.label ?? ''),
        claimed: tier.claimed === true,
        eligible: xp >= Number(tier.xp_required),
      })),
      giveaways: giveaways.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        name: String(row.name),
        description: String(row.description),
        prizeDescription: String(row.prize_description),
        entriesRequired: Number(row.entries_required),
        drawsAt: String(row.draws_at),
        entered: row.entered === true,
        remaining: remainingGiveawayEntries(
          Number(row.entries_required),
          Number(row.total_entries),
        ),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load rewards',
        detail: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}

/**
 * Perform a reward action.
 *
 * The body is validated BEFORE it reaches a query: an unknown action is a 400
 * and never touches the database, so the route cannot be used to probe state
 * through error differences.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const disabled = await requireGamificationEnabled(session.userId);
  if (disabled) return disabled;

  let body: { action?: unknown; code?: unknown; tierId?: unknown; giveawayId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isAction(body.action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'spin': {
        const result = await spinOnce(session.userId);
        if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
        return NextResponse.json({ prizeKey: result.prizeKey, xp: result.xp });
      }

      case 'redeem': {
        const code = typeof body.code === 'string' ? body.code : '';
        const result = await redeemUseCode(session.userId, code);
        if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
        return NextResponse.json({ multiplier: result.multiplier, xp: result.xp });
      }

      case 'claim-tier': {
        const tierId = Number(body.tierId);
        if (!Number.isInteger(tierId) || tierId <= 0) {
          return NextResponse.json({ error: 'Invalid tierId' }, { status: 400 });
        }
        const result = await claimBattlePassTier(session.userId, tierId);
        if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
        return NextResponse.json({ xp: result.xp });
      }

      case 'enter-giveaway': {
        const giveawayId = Number(body.giveawayId);
        if (!Number.isInteger(giveawayId) || giveawayId <= 0) {
          return NextResponse.json({ error: 'Invalid giveawayId' }, { status: 400 });
        }
        const result = await enterGiveaway(session.userId, giveawayId);
        if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
        return NextResponse.json({ entered: true });
      }
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Reward action failed',
        detail: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}