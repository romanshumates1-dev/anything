import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEVEL_CURVE,
  MAX_SPINS_PER_WEEK,
  MAX_USE_CODE_MULTIPLIER,
  ROLL_SPACE,
  SPIN_PRIZES,
  SPIN_WEIGHTS,
  assertNoMonetaryPrize,
  clampUseCodeMultiplier,
  computeSpinsAvailable,
  levelForXp,
  levelProgress,
  pickPrize,
  remainingGiveawayEntries,
  secureRoll,
  useCodeXp,
  validatePrizeTable,
} from '../gamificationRewards';

const MIGRATION = join(
  process.cwd(),
  'db',
  'migrations',
  '099_gamification_rewards.sql',
);

describe('Set V3 — reward economy invariants', () => {
  describe('prize table', () => {
    it('weights sum to the roll space', () => {
      expect(validatePrizeTable()).toBe(true);
    });

    it('detects a table whose weights do not sum', () => {
      expect(validatePrizeTable({ common: 1, rare: 1 })).toBe(false);
    });

    it('every prize is XP and cosmetic only — never money', () => {
      expect(() => assertNoMonetaryPrize(Object.values(SPIN_PRIZES))).not.toThrow();
    });

    it('rejects a prize that smuggles a monetary value', () => {
      const bad = [{ key: 'win_cash', xp: 0, cosmetic: 'credits', rarity: 'common' as const }];
      expect(() => assertNoMonetaryPrize(bad)).toThrow(/monetary/);
    });
  });

  describe('pickPrize', () => {
    it('is deterministic for a given roll', () => {
      for (const roll of [0, 1, 5999, 6000, 8500, 9600, 9950, 9999]) {
        expect(pickPrize(roll)).toEqual(pickPrize(roll));
      }
    });

    it('maps the roll bands to the documented rarities', () => {
      expect(pickPrize(0).rarity).toBe('common');
      expect(pickPrize(SPIN_WEIGHTS.common - 1).rarity).toBe('common');
      expect(pickPrize(SPIN_WEIGHTS.common).rarity).toBe('uncommon');
      expect(pickPrize(ROLL_SPACE - 1).rarity).toBe('legendary');
    });

    it('rejects an out-of-range roll instead of clamping it', () => {
      // Clamping would let a caller force `legendary` with a huge number.
      expect(() => pickPrize(ROLL_SPACE)).toThrow(RangeError);
      expect(() => pickPrize(-1)).toThrow(RangeError);
      expect(() => pickPrize(1.5)).toThrow(RangeError);
      expect(() => pickPrize(Number.NaN)).toThrow(RangeError);
    });

    it('never awards the top prize for an impossible roll', () => {
      // A huge roll must be REJECTED, not clamped — clamping to the top of the
      // table would hand the caller `legendary` every time.
      expect(() => pickPrize(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    });
  });

  describe('secureRoll', () => {
    it('produces integers inside the roll space', () => {
      for (let i = 0; i < 200; i++) {
        const roll = secureRoll();
        expect(Number.isInteger(roll)).toBe(true);
        expect(roll).toBeGreaterThanOrEqual(0);
        expect(roll).toBeLessThan(ROLL_SPACE);
      }
    });
  });

  describe('spin eligibility', () => {
    it('derives spins from earned achievement points', () => {
      expect(computeSpinsAvailable(0)).toBe(0);
      expect(computeSpinsAvailable(249)).toBe(0);
      expect(computeSpinsAvailable(250)).toBe(1);
      expect(computeSpinsAvailable(750)).toBe(3);
    });

    it('caps the weekly ceiling so spins cannot be farmed', () => {
      expect(computeSpinsAvailable(1_000_000)).toBe(MAX_SPINS_PER_WEEK);
    });

    it('treats nonsense input as zero rather than granting spins', () => {
      expect(computeSpinsAvailable(-5)).toBe(0);
      expect(computeSpinsAvailable(Number.NaN)).toBe(0);
    });
  });

  describe('use codes', () => {
    it('clamps to the documented 1x-10x band', () => {
      expect(clampUseCodeMultiplier(0)).toBe(1);
      expect(clampUseCodeMultiplier(1)).toBe(1);
      expect(clampUseCodeMultiplier(10)).toBe(10);
      expect(clampUseCodeMultiplier(11)).toBe(MAX_USE_CODE_MULTIPLIER);
      expect(clampUseCodeMultiplier(1_000_000)).toBe(MAX_USE_CODE_MULTIPLIER);
    });

    it('falls back to 1x for a typo rather than throwing a 500', () => {
      expect(clampUseCodeMultiplier('abc')).toBe(1);
      expect(clampUseCodeMultiplier('')).toBe(1);
      expect(clampUseCodeMultiplier(null)).toBe(1);
      expect(clampUseCodeMultiplier(undefined)).toBe(1);
      expect(clampUseCodeMultiplier(Number.NaN)).toBe(1);
    });

    it('parses a numeric string, as a user-typed code arrives', () => {
      expect(clampUseCodeMultiplier('5')).toBe(5);
      expect(clampUseCodeMultiplier(' 7 ')).toBe(7);
    });

    it('awards XP proportional to the multiplier', () => {
      expect(useCodeXp(1)).toBe(25);
      expect(useCodeXp(4)).toBe(100);
      expect(useCodeXp(10)).toBe(250);
      expect(useCodeXp(999)).toBe(250);
    });
  });

  describe('levels', () => {
    it('maps cumulative XP to the curve', () => {
      expect(levelForXp(0)).toBe(1);
      expect(levelForXp(99)).toBe(1);
      expect(levelForXp(100)).toBe(2);
      expect(levelForXp(250)).toBe(3);
    });

    it('clamps rather than falling off the end of the curve', () => {
      expect(levelForXp(10_000_000)).toBe(LEVEL_CURVE.length);
      expect(levelForXp(-1)).toBe(1);
    });

    it('reports bounded progress within the level', () => {
      expect(levelProgress(0)).toBe(0);
      expect(levelProgress(50)).toBeCloseTo(0.5);
      const beyond = levelProgress(10_000_000);
      expect(beyond).toBe(1);
      expect(beyond).toBeLessThanOrEqual(1);
    });
  });

  describe('giveaways', () => {
    it('never reports more remaining entries than the promotion allows', () => {
      expect(remainingGiveawayEntries(100, 0)).toBe(100);
      expect(remainingGiveawayEntries(100, 40)).toBe(60);
      expect(remainingGiveawayEntries(100, 100)).toBe(0);
      // Over-entry must floor at 0, never go negative: a negative count would
      // be a false public claim about the promotion.
      expect(remainingGiveawayEntries(100, 140)).toBe(0);
    });

    it('treats a nonsensical allowance as zero entries', () => {
      expect(remainingGiveawayEntries(0, 0)).toBe(0);
      expect(remainingGiveawayEntries(-5, 0)).toBe(0);
    });
  });
});

describe('Set V3 — schema guarantees', () => {
  const migration = readFileSync(MIGRATION, 'utf8');

  it('creates the reward tables', () => {
    for (const table of [
      'gamification_seasons',
      'user_season_progress',
      'battle_pass_tiers',
      'user_battle_pass_claims',
      'user_spin_wallet',
      'spin_wheel_spins',
      'user_crate_inventory',
      'user_crate_opens',
      'competitions',
      'use_codes',
      'user_use_code_redemptions',
      'giveaways',
      'giveaway_entries',
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`));
    }
  });

  it('makes every reward claim idempotent under replay', () => {
    // These UNIQUE constraints are what defeat a double-click or an N-way
    // parallel replay. Asserting them keeps the guarantee in the schema rather
    // than in application logic that a race can defeat.
    expect(migration).toMatch(/UNIQUE\(user_id, tier_id\)/);
    expect(migration).toMatch(/UNIQUE\(user_id, spin_number\)/);
    expect(migration).toMatch(/UNIQUE\(user_id, code_id\)/);
    expect(migration).toMatch(/UNIQUE\(giveaway_id, user_id\)/);
  });

  it('caps multipliers and balances in the database, not just the app', () => {
    expect(migration).toMatch(/CHECK \(multiplier BETWEEN 1 AND 10\)/);
    expect(migration).toMatch(/CHECK \(spins_remaining <= 7\)/);
    expect(migration).toMatch(/CHECK \(spins_remaining >= 0\)/);
  });

  it('contains no monetary wager column', () => {
    // roman.agent.md forbids monetary wagering. No price/cost/stake/wager may
    // appear as a column in this migration.
    expect(migration).not.toMatch(
      /\b(price|cost|stake|wager|bet_amount|entry_fee)\s+(integer|numeric|bigint)/i,
    );
  });

  it('is additive and re-runnable', () => {
    expect(migration).not.toMatch(/DROP TABLE/i);
    expect(migration).toMatch(/IF NOT EXISTS/g);
  });
});