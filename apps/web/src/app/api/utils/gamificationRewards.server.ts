/**
 * REQUIREMENT SET V3 — server-side reward claims.
 *
 * SERVER-ONLY. Pulls in the Neon driver via `sql`, so it must never be
 * imported from a `'use client'` component — the same split as
 * `gamification.server.ts` versus `gamification.ts`.
 *
 * WHAT THIS FILE IS
 * -----------------
 * The write paths that actually move a balance. `gamificationRewards.ts` decides
 * what an award is worth; this file makes the award happen exactly once.
 *
 * WHY EVERY CLAIM IS AN INSERT-THEN-CREDIT
 * ----------------------------------------
 * The tempting shape is "check, then grant". That is a time-of-check /
 * time-of-use race: a double-click, a retried request, or N parallel tabs all
 * observe "not yet claimed" and all grant.
 *
 * Every function here instead attempts an `INSERT ... ON CONFLICT DO NOTHING`
 * into a table whose UNIQUE key defines "this user has been credited for this
 * exact thing", and only credits XP if that insert actually created a row.
 * The database decides the winner of the race, so N concurrent requests produce
 * exactly one award. This is the same reasoning as migration 097 (one in-flight
 * withdrawal), applied to rewards.
 *
 * XP CREDITS GO TO `user_stats.points`, WHICH ALREADY EXISTS
 * ---------------------------------------------------------
 * Migration 068 created `user_stats(points)` and the achievements system, and
 * `api/achievements` already reads `user_stats.points`. Writing there keeps one
 * XP balance rather than introducing a second one that could drift.
 */
import sql from '@/app/api/utils/sql';
import {
  clampUseCodeMultiplier,
  computeSpinsAvailable,
  pickPrize,
  secureRoll,
  useCodeXp,
} from '@/app/api/utils/gamificationRewards';

/**
 * Add XP to a user's balance, atomically.
 *
 * When an event is passed, it is protected by a unique `(user_id, event_key)`
 * ledger so the same logical action cannot be replayed under a double-click,
 * refresh, or duplicated API request. Passing no key keeps the legacy balance
 * update for callers that are not naturally idempotent, but all reward surfaces
 * that represent an exact event should pass a stable key.
 *
 * Uses `GREATEST(points + n, 0)` so a corrupted negative input cannot drive the
 * balance below zero even if a caller passes one. Mirrors the non-negative
 * intent of migration 096.
 */
export async function awardXp(userId: string, xp: number, eventKey?: string): Promise<boolean> {
  if (!Number.isFinite(xp) || xp <= 0) return false;

  const amount = Math.floor(xp);
  const normalizedKey = typeof eventKey === 'string' ? eventKey.trim() : '';

  if (normalizedKey) {
    const rows = await sql`
      WITH inserted AS (
        INSERT INTO public.user_xp_events (user_id, event_key, xp)
        VALUES (${userId}, ${normalizedKey}, ${amount})
        ON CONFLICT (user_id, event_key) DO NOTHING
        RETURNING 1
      ),
      upserted AS (
        INSERT INTO public.user_stats (user_id, points)
        VALUES (${userId}, ${amount})
        ON CONFLICT (user_id) DO UPDATE
          SET points = GREATEST(public.user_stats.points + ${amount}, 0)
        WHERE EXISTS (SELECT 1 FROM inserted)
        RETURNING user_id
      )
      SELECT 1
      FROM inserted
      LIMIT 1
    `;
    return rows.length > 0;
  }

  const [row] = await sql`
    INSERT INTO public.user_stats (user_id, points)
    VALUES (${userId}, ${amount})
    ON CONFLICT (user_id) DO UPDATE
      SET points = GREATEST(public.user_stats.points + ${amount}, 0)
    RETURNING user_id
  `;
  return Boolean(row);
}

/** Current XP/points balance. Returns 0 when the user has no row yet. */
export async function currentXp(userId: string): Promise<number> {
  const [row] = await sql`
    SELECT points FROM public.user_stats WHERE user_id = ${userId} LIMIT 1
  `;
  const points = row?.points;
  return typeof points === 'number' ? points : 0;
}

/**
 * Award the spins a user has EARNED but not yet received.
 *
 * Grants only the difference between earned and held, so calling this
 * repeatedly is harmless and cannot inflate the wallet.
 */
export async function syncEarnedSpins(userId: string): Promise<number> {
  const entitlement = computeSpinsAvailable(await currentAchievementPoints(userId));
  if (entitlement <= 0) return 0;

  const [row] = await sql`
    INSERT INTO public.user_spin_wallet (user_id, spins_remaining)
    VALUES (${userId}, ${entitlement})
    ON CONFLICT (user_id) DO UPDATE
      SET spins_remaining = LEAST(${entitlement}, public.user_spin_wallet.spins_remaining + ${entitlement}),
          week_started_at = now()
    RETURNING spins_remaining
  `;
  return typeof row?.spins_remaining === 'number' ? row.spins_remaining : 0;
}

/**
 * Total points across the user's unlocked achievements.
 *
 * This is the EARNED input to `computeSpinsAvailable`. It is derived from
 * persisted achievement progress, not from a click count, which is what makes
 * spins unbuyable.
 */
export async function currentAchievementPoints(userId: string): Promise<number> {
  const [row] = await sql`
    SELECT COALESCE(SUM(a.points), 0)::int AS total
    FROM public.user_achievements ua
    JOIN public.achievements a ON a.id = ua.achievement_id
    WHERE ua.user_id = ${userId} AND ua.unlocked = true
  `;
  return typeof row?.total === 'number' ? row.total : 0;
}

/**
 * Spend one spin and award the resulting prize, exactly once.
 *
 * Order matters and is deliberate:
 *   1. Decrement the wallet. The `spins_remaining > 0` predicate is inside the
 *      UPDATE, so the decrement is conditional on the balance — a concurrent
 *      caller that already emptied the wallet updates zero rows and is refused.
 *   2. Roll and record the spin. `UNIQUE(user_id, spin_number)` plus the
 *      spin number allocated from the wallet means a replayed request collides
 *      and grants nothing.
 *
 * The spin is recorded BEFORE the XP is credited, so a crash between the two
 * loses the prize rather than duplicating it. Duplication is the worse failure:
 * it is unbounded and user-visible, whereas a lost spin is recoverable and the
 * user still holds their remaining spins.
 */
export async function spinOnce(
  userId: string,
): Promise<{ ok: true; prizeKey: string; xp: number } | { ok: false; reason: string }> {
  const [wallet] = await sql`
    UPDATE public.user_spin_wallet
       SET spins_remaining = spins_remaining - 1,
           updated_at = now()
     WHERE user_id = ${userId} AND spins_remaining > 0
     RETURNING spins_remaining
  `;

  if (!wallet) return { ok: false, reason: 'no spins available' };

  const spinNumber = wallet.spins_remaining;
  const prize = pickPrize(secureRoll());

  const inserted = await sql`
    INSERT INTO public.spin_wheel_spins (user_id, spin_number, prize_key, prize_xp)
    VALUES (${userId}, ${spinNumber}, ${prize.key}, ${prize.xp})
    ON CONFLICT (user_id, spin_number) DO NOTHING
    RETURNING id
  `;

  if (inserted.length === 0) {
    // Replay of a spin already consumed: refund the decrement so the spin is
    // not silently lost, and report the refusal.
    await sql`
      UPDATE public.user_spin_wallet
         SET spins_remaining = spins_remaining + 1
       WHERE user_id = ${userId}
    `;
    return { ok: false, reason: 'spin already recorded' };
  }

  await awardXp(userId, prize.xp);
  return { ok: true, prizeKey: prize.key, xp: prize.xp };
}

/**
 * Redeem a use code, exactly once per user.
 *
 * `UNIQUE(user_id, code_id)` makes a code single-use per account no matter how
 * many times the request is replayed. The `redeemed_count < max_redemptions`
 * predicate lives inside the UPDATE so a shared code cannot be over-redeemed by
 * concurrent callers either.
 *
 * Awards XP only. There is no code path here that mints AI credits.
 */
export async function redeemUseCode(
  userId: string,
  rawCode: string,
): Promise<{ ok: true; multiplier: number; xp: number } | { ok: false; reason: string }> {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'missing code' };

  const [definition] = await sql`
    SELECT id, multiplier
      FROM public.use_codes
     WHERE code = ${code} AND is_active = true
     LIMIT 1
  `;
  if (!definition) return { ok: false, reason: 'unknown or inactive code' };

  // Atomically consume one of the global redemptions. Returning zero rows means
  // the code is exhausted, so this caller must not be credited.
  const consumed = await sql`
    UPDATE public.use_codes
       SET redeemed_count = redeemed_count + 1
     WHERE id = ${definition.id} AND redeemed_count < max_redemptions
     RETURNING id
  `;
  if (consumed.length === 0) return { ok: false, reason: 'code fully redeemed' };

  const multiplier = clampUseCodeMultiplier(definition.multiplier);
  const xp = useCodeXp(multiplier);

  const ledger = await sql`
    INSERT INTO public.user_use_code_redemptions (user_id, code_id, multiplier, xp_awarded)
    VALUES (${userId}, ${definition.id}, ${multiplier}, ${xp})
    ON CONFLICT (user_id, code_id) DO NOTHING
    RETURNING id
  `;

  if (ledger.length === 0) {
    // This account already redeemed it. Give the global redemption back so one
    // user's replay cannot exhaust a shared code for everyone else.
    await sql`
      UPDATE public.use_codes
         SET redeemed_count = GREATEST(redeemed_count - 1, 0)
       WHERE id = ${definition.id}
    `;
    return { ok: false, reason: 'code already redeemed by this account' };
  }

  await awardXp(userId, xp);
  return { ok: true, multiplier, xp };
}

/**
 * Claim a battle-pass tier, exactly once.
 *
 * `UNIQUE(user_id, tier_id)` is the idempotency guard. A tier is only claimable
 * once the user's XP meets its threshold, which is checked against the stored
 * balance rather than a client-supplied number.
 */
export async function claimBattlePassTier(
  userId: string,
  tierId: number,
): Promise<{ ok: true; xp: number } | { ok: false; reason: string }> {
  const [tier] = await sql`
    SELECT t.id, t.reward_xp, t.xp_required
      FROM public.battle_pass_tiers t
     WHERE t.id = ${tierId}
     LIMIT 1
  `;
  if (!tier) return { ok: false, reason: 'unknown tier' };

  const xp = await currentXp(userId);
  if (xp < tier.xp_required) return { ok: false, reason: 'xp requirement not met' };

  const claim = await sql`
    INSERT INTO public.user_battle_pass_claims (user_id, tier_id)
    VALUES (${userId}, ${tierId})
    ON CONFLICT (user_id, tier_id) DO NOTHING
     RETURNING id
  `;
  if (claim.length === 0) return { ok: false, reason: 'tier already claimed' };

  if (tier.reward_xp > 0) await awardXp(userId, tier.reward_xp);
  return { ok: true, xp: tier.reward_xp };
}

/**
 * Enter a user into a giveaway, at most once per giveaway.
 *
 * `UNIQUE(giveaway_id, user_id)` is the guard. Entries are free and the draw is
 * operator-run; there is no purchase path and no stake, so this cannot become a
 * wagering mechanic.
 */
export async function enterGiveaway(
  userId: string,
  giveawayId: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [entry] = await sql`
    INSERT INTO public.giveaway_entries (giveaway_id, user_id)
    VALUES (${giveawayId}, ${userId})
    ON CONFLICT (giveaway_id, user_id) DO NOTHING
     RETURNING id
  `;
  if (entry.length === 0) return { ok: false, reason: 'already entered' };
  return { ok: true };
}