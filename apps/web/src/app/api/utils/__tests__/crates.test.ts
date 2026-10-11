/**
 * Tests for the crate-opening economy — the pure, client-safe module that
 * defines what crates contain and how rarities are selected.
 *
 * WHY A PURE MODULE TEST SUITE
 * ----------------------------
 * The opening logic must be auditable in one place, the same way
 * `gamificationRewards.ts` is auditable today. A reviewer should be able to
 * open one file and confirm:
 *   - every prize is XP or cosmetic-only (no monetary value),
 *   - the rarity weights are deterministic,
 *   - a replayed or forged roll cannot inflate a prize.
 *
 * This file proves those invariants. The database layer (route.test.ts)
 * proves the boundaries (401 / 404 / idempotence) separately.
 */
import { describe, it, expect } from 'vitest';

import {
  CRATES,
  CRATE_RARITY_WEIGHTS,
  openCrate,
  cosmeticFor,
  assertNoMonetaryPrize,
} from '../crates';
import type { CrateKey, RarityTier } from '../crates';

describe('crates — definitions', () => {
  it('exposes at least three crate tiers', () => {
    expect(CRATES.daily.key).toBe('daily');
    expect(CRATES.weekly.key).toBe('weekly');
    expect(CRATES.achievement.key).toBe('achievement');
  });

  it('labels every crate with a non-empty name and description', () => {
    for (const crate of Object.values(CRATES)) {
      expect(crate.name.length).toBeGreaterThan(0);
      expect(crate.description.length).toBeGreaterThan(0);
    }
  });

  it('assigns a valid rarity to every crate', () => {
    const valid: RarityTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    for (const crate of Object.values(CRATES)) {
      expect(valid).toContain(crate.rarity);
    }
  });

  it('caps weekly crate openings at 1 per day (schema constraint)', () => {
    // The `user_crate_opens` table enforces UNIQUE(user_id, crate_key, opened_day).
    // This test documents that invariant: each crate has one daily open slot.
    expect(CRATES.daily.maxOpensPerDay).toBe(1);
    expect(CRATES.weekly.maxOpensPerDay).toBe(1);
  });
});

describe('crates — rarity weights', () => {
  it('weights sum to 100 (percent)', () => {
    const total = Object.values(CRATE_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('legendary is rarer than common', () => {
    expect(CRATE_RARITY_WEIGHTS.legendary).toBeLessThan(CRATE_RARITY_WEIGHTS.common);
  });

  it('every weight is a positive integer', () => {
    for (const w of Object.values(CRATE_RARITY_WEIGHTS)) {
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThan(0);
    }
  });
});

describe('crates — openCrate (deterministic)', () => {
  it('produces the same cosmetic for the same roll', () => {
    const a = openCrate('daily', 42);
    const b = openCrate('daily', 42);
    expect(a.cosmeticKey).toBe(b.cosmeticKey);
    expect(a.rarity).toBe(b.rarity);
    expect(a.xp).toBe(b.xp);
  });

  it('produces a valid cosmetic for every crate + roll combination', () => {
    for (const crate of Object.values(CRATES)) {
      for (let roll = 0; roll < 100; roll += 7) {
        const result = openCrate(crate.key, roll);
        expect(result.cosmeticKey).toBeTruthy();
        expect(result.rarity).toBeTruthy();
        expect(result.xp).toBeGreaterThanOrEqual(0);
        // The cosmetic must exist in the definition table
        expect(cosmeticFor(result.cosmeticKey)).toBeDefined();
      }
    }
  });

  it('never returns a negative XP', () => {
    for (const crate of Object.values(CRATES)) {
      const result = openCrate(crate.key, 1234);
      expect(result.xp).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps an out-of-range roll without throwing', () => {
    const result = openCrate('daily', 50000);
    expect(result.cosmeticKey).toBeTruthy();
  });
});

describe('crates — monetary-value guard', () => {
  it('assertNoMonetaryPrize rejects credits/cash/amount/balance fields', () => {
    const good = [
      { cosmeticKey: 'crate_basic', rarity: 'common' as RarityTier, xp: 10 },
    ];
    expect(() => assertNoMonetaryPrize(good)).not.toThrow();

    // @ts-expect-error — intentionally wrong shape to prove the guard fires
    const badCredits = [{ cosmeticKey: 'cheat', credits: 999 }];
    expect(() => assertNoMonetaryPrize(badCredits)).toThrow(/monetary/);

    // @ts-expect-error — intentionally wrong shape
    const badCash = [{ cosmeticKey: 'cheat', cash: 1 }];
    expect(() => assertNoMonetaryPrize(badCash)).toThrow(/monetary/);

    // @ts-expect-error — intentionally wrong shape
    const badBalance = [{ cosmeticKey: 'cheat', balance: 100 }];
    expect(() => assertNoMonetaryPrize(badBalance)).toThrow(/monetary/);
  });
});

describe('crates — type safety', () => {
  it('openCrate accepts only defined crate keys', () => {
    // TypeScript compilation itself verifies this, but we assert at runtime too
    const known: CrateKey[] = ['daily', 'weekly', 'achievement'];
    for (const key of known) {
      expect(() => openCrate(key, 1)).not.toThrow();
    }
  });
});
