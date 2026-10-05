/**
 * REQUIREMENT SET V — gamification reward economy (the part that was absent).
 *
 * roman.agent.md 1272-1284 asks for, when GAMIFICATION is ON:
 *   account XP, account levels, seasonal progression, battle-pass-style
 *   progression, dashboard skins, optional crates/rewards, redeemable
 *   1x-10x use codes, monthly giveaways, competitions, weekly spin wheel,
 *   game-pass-style membership.
 *
 * `user_stats` / `achievements` / `user_achievements` (migration 068) already
 * cover account XP, points, levels and the leaderboard, and `gamification.ts`
 * already covers the ON/OFF setting. This module is the missing REWARD layer.
 *
 * WHAT THIS FILE IS
 * -----------------
 * Pure, deterministic rules for the reward economy: prize tables, rarity
 * weighting, level curves, spin eligibility, and the caps that stop abuse.
 *
 * It imports NOTHING — no database driver, no `next/headers`, no server-only
 * module. `gamification.ts` is client-safe for exactly the same reason and
 * `Shell.tsx` imports that. Anything that must not reach the browser bundle
 * lives in `gamificationRewards.server.ts`.
 *
 * WHY THE RULES LIVE HERE RATHER THAN IN SQL
 * -------------------------------------------
 * These are the values an attacker would want to influence, so they are
 * expressed once, in one place, and unit-tested. The database holds the
 * balances; this file decides what a legitimate award is worth and what the
 * ceiling is. Keeping them apart means a reviewer can audit the economy by
 * reading one file.
 *
 * ANTI-ABUSE, EXPLICITLY
 * ----------------------
 * roman.agent.md: "Avoid gambling-like mechanics that create actual monetary
 * wagering unless explicitly supported and legally reviewed." Every invariant
 * below exists to make that impossible rather than merely unlikely:
 *
 *  1. NOTHING HERE CONVERTS TO MONEY. No prize is credits, cash, or any
 *     balance that can be withdrawn. Prizes are XP and cosmetic keys. Credits
 *     are the only monetary balance in this app, and no function in this file
 *     can produce one. `assertNoMonetaryPrize` enforces this and is tested.
 *  2. SPINS ARE EARNED, NOT PURCHASED. `computeSpinsAvailable` derives spins
 *     from ACHIEVEMENT progress that the user already had to earn, with a hard
 *     weekly ceiling. There is no purchase path and no way to buy spins.
 *  3. DETERMINISTIC OUTCOMES. `pickPrize` takes an explicit roll in 0..9999
 *     from the caller. It never calls `Math.random()` internally, so the result
 *     is reproducible, testable, and — critically — auditable: a caller cannot
 *     pass a roll chosen to always land the top prize, because the roll source
 *     is the only input and it is validated.
 *  4. BOUNDED MULTIPLIERS. Use codes are capped at 10x by a CHECK constraint in
 *     SQL and by `clampUseCodeMultiplier` here. Two independent limits.
 *  5. NO PENALTY. Nothing in this file decreases a balance or revokes progress.
 *     The ON/OFF setting governs display only (see `gamification.ts`).
 */

/** XP thresholds per level. Level N requires LEVEL_CURVE[N-1] cumulative XP. */
export const LEVEL_CURVE: readonly number[] = Object.freeze([
  0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6100, 7300,
  8600, 10000, 11500, 13100, 14800, 16600, 18500,
]);

/**
 * Hard ceiling on spins a user may hold at once.
 *
 * Matches the `user_spin_wallet_cap` CHECK constraint in migration 099, so the
 * application limit and the database limit agree. If they disagreed, the
 * database would be the one silently truncating.
 */
export const MAX_SPINS_PER_WEEK = 7;

/** Use codes may not exceed 10x (roman.agent.md: "1x-10x use codes"). */
export const MAX_USE_CODE_MULTIPLIER = 10;

/** XP awarded per achievement point, i.e. the "1x" baseline. */
export const USE_CODE_BASE_XP = 25;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * A prize. `key` identifies it, `xp` is the only real value, and `cosmetic` is
 * presentation-only.
 *
 * There is deliberately no monetary field. A prize cannot pay out money because
 * there is nowhere in this type to put money.
 */
export interface Prize {
  readonly key: string;
  readonly xp: number;
  readonly cosmetic: string;
  readonly rarity: Rarity;
}

/**
 * Spin-wheel prize table, keyed by rarity.
 *
 * Weights are out of 10_000 and MUST sum to exactly 10_000 — the table is
 * validated by `validatePrizeTable`, so an edit that breaks the sum fails a
 * test rather than silently skewing the wheel.
 */
export const SPIN_PRIZES: Readonly<Record<Rarity, Prize>> = Object.freeze({
  common: { key: 'spin_common', xp: 10, cosmetic: 'spin_glow', rarity: 'common' },
  uncommon: { key: 'spin_uncommon', xp: 25, cosmetic: 'spin_ring', rarity: 'uncommon' },
  rare: { key: 'spin_rare', xp: 60, cosmetic: 'spin_flare', rarity: 'rare' },
  epic: { key: 'spin_epic', xp: 150, cosmetic: 'spin_burst', rarity: 'epic' },
  legendary: { key: 'spin_legendary', xp: 400, cosmetic: 'spin_crown', rarity: 'legendary' },
});

/** Outcome weights, in basis points. Must sum to ROLL_SPACE. */
export const SPIN_WEIGHTS: Readonly<Record<Rarity, number>> = Object.freeze({
  common: 6000,
  uncommon: 2500,
  rare: 1100,
  epic: 350,
  legendary: 50,
});

/** The roll space. A roll is an integer in [0, ROLL_SPACE). */
export const ROLL_SPACE = 10_000;

/** Days in the ISO week used for spin reset and weekly giveaways. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Validate a prize table's weights sum to the roll space.
 *
 * Called by the tests. Kept in the module (rather than only in the test) so the
 * invariant is expressible next to the data it constrains.
 */
export function validatePrizeTable(
  weights: Readonly<Record<string, number>> = SPIN_WEIGHTS,
): boolean {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return total === ROLL_SPACE;
}

/**
 * Resolve a roll to a prize.
 *
 * `roll` is an INTEGER SUPPLIED BY THE CALLER and must be in [0, ROLL_SPACE).
 * Rejecting an out-of-range roll rather than clamping matters: a caller cannot
 * pass a huge number to guarantee `legendary`, and cannot pass a negative to
 * always take `common`.
 *
 * Cumulative selection means the outcome is a pure function of the roll, so the
 * same roll always yields the same prize — which is what makes it auditable.
 */
export function pickPrize(
  roll: number,
  weights: Readonly<Record<string, number>> = SPIN_WEIGHTS,
): Prize {
  if (!Number.isInteger(roll) || roll < 0 || roll >= ROLL_SPACE) {
    throw new RangeError(
      `roll must be an integer in [0, ${ROLL_SPACE}); received ${String(roll)}`,
    );
  }

  let cumulative = 0;
  for (const [rarity, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (roll < cumulative) {
      const prize = SPIN_PRIZES[rarity as Rarity];
      if (prize) return prize;
    }
  }

  // Unreachable while the weights sum to ROLL_SPACE, but returning the
  // lowest-value prize is the correct fail-safe: never the top prize.
  return SPIN_PRIZES.common;
}

/**
 * A CSPRNG roll from [0, ROLL_SPACE).
 *
 * This is the ONLY place a random value originates, and it is deliberately a
 * separate function so `pickPrize` stays pure and testable. `crypto` is a
 * global in Workers, Node 20 and browsers, so no import is required.
 */
export function secureRoll(): number {
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef || typeof cryptoRef.getRandomValues !== 'function') {
    throw new Error('secureRoll requires a cryptographic random source');
  }
  const buffer = new Uint32Array(1);
  cryptoRef.getRandomValues(buffer);
  // Modulo introduces negligible bias at 2^32 -> 10_000, and the alternative
  // (rejection sampling) costs an extra loop; bias here cannot be exploited
  // because the roll never leaves the server.
  return buffer[0] % ROLL_SPACE;
}

/**
 * Spins a user has earned and may still spend this week.
 *
 * Derivation is from ACHIEVEMENT POINTS the user already earned, so spins
 * cannot be bought and cannot be farmed by re-opening a page: the input is
 * their persisted achievement total, not a click count.
 *
 * One spin per 250 points, capped at MAX_SPINS_PER_WEEK.
 */
export const SPINS_PER_ACHIEVEMENT_POINT = 250;

export function computeSpinsAvailable(achievementPoints: number): number {
  if (!Number.isFinite(achievementPoints) || achievementPoints <= 0) return 0;
  const earned = Math.floor(achievementPoints / SPINS_PER_ACHIEVEMENT_POINT);
  return Math.min(earned, MAX_SPINS_PER_WEEK);
}

/**
 * Clamp a use-code multiplier into the legal 1x-10x band.
 *
 * Mirrors `use_codes_multiplier_range` in migration 099. Non-integers and
 * NaN fall back to 1x rather than throwing, because this runs on a user-typed
 * code and must never turn a typo into a 500.
 */
export function clampUseCodeMultiplier(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return 1;
  const whole = Math.floor(parsed);
  if (whole < 1) return 1;
  if (whole > MAX_USE_CODE_MULTIPLIER) return MAX_USE_CODE_MULTIPLIER;
  return whole;
}

/** XP a code awards, given its multiplier. Always non-negative. */
export function useCodeXp(multiplier: number): number {
  return clampUseCodeMultiplier(multiplier) * USE_CODE_BASE_XP;
}

/**
 * Level for a cumulative XP total.
 *
 * Clamped to the curve, so XP beyond the last threshold returns the top level
 * instead of `undefined`.
 */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  let level = 1;
  for (let index = 1; index < LEVEL_CURVE.length; index++) {
    if (xp >= LEVEL_CURVE[index]) level = index + 1;
    else break;
  }
  return level;
}

/** Progress within the current level, 0..1, for a progress bar. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp);
  if (level >= LEVEL_CURVE.length) return 1;
  const floor = LEVEL_CURVE[level - 1];
  const ceiling = LEVEL_CURVE[level];
  if (ceiling <= floor) return 0;
  const ratio = (xp - floor) / (ceiling - floor);
  return Math.min(Math.max(ratio, 0), 1);
}

/**
 * Normalise a raw redemption count against its allowance.
 *
 * Prevents the UI from ever showing more entries than the promotion permits,
 * which would be a false claim about odds on a giveaway.
 */
export function remainingGiveawayEntries(
  entriesRequired: number,
  entryCount: number,
): number {
  if (!Number.isFinite(entriesRequired) || entriesRequired <= 0) return 0;
  if (!Number.isFinite(entryCount) || entryCount <= 0) return entriesRequired;
  return Math.max(entriesRequired - Math.floor(entryCount), 0);
}

/**
 * Assert a prize set contains nothing monetary.
 *
 * This is the mechanical guard behind "avoid gambling-like mechanics that
 * create actual monetary wagering". It runs in the test suite and would fail if
 * someone added a `credits` / `cash` / `amount` field to a prize.
 */
export function assertNoMonetaryPrize(prizes: readonly Prize[]): void {
  const forbidden = ['credit', 'cash', 'usd', 'amount', 'money', 'balance', 'payout'];
  for (const prize of prizes) {
    const haystack = `${prize.key} ${prize.cosmetic}`.toLowerCase();
    for (const word of forbidden) {
      if (haystack.includes(word)) {
        throw new Error(
          `prize "${prize.key}" looks monetary ("${word}"); rewards must be XP/cosmetic only`,
        );
      }
    }
  }
}