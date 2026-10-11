/**
 * REQUIREMENT SET V3 / EXP-GAME-01 — crate-opening economy definitions.
 *
 * roman.agent.md 1272-1284 asks for: "optional crates/rewards" as part of the
 * gamification system, and EXP-GAME-01 asks specifically for a 3D crate/shop
 * page.
 *
 * WHAT THIS FILE IS
 * -----------------
 * Pure, deterministic definitions for the crate layer. Like
 * `gamificationRewards.ts`, it imports NOTHING — no database driver, no
 * `next/headers`, no server-only module. It is client-safe so the crate shop
 * UI can import the rarity weights and crate metadata for rendering without
 * pulling the Neon driver into the browser bundle.
 *
 * The server-authoritative claim logic (actually opening a crate, recording
 * the cosmetic, enforcing the daily UNIQUE constraint) lives in
 * `crates.server.ts`. This file only decides what a legitimate crate contains.
 *
 * ANTI-ABUSE POSTURE (mirrors gamificationRewards.ts)
 * --------------------------------------------------
 * 1. NOTHING HERE CONVERTS TO MONEY. Crates drop XP and cosmetic-only items.
 *    `assertNoMonetaryPrize` enforces this at test time.
 * 2. CRATES ARE EARNED, NOT PURCHASED. `maxOpensPerDay` is 1 — one daily open
 *    per crate type — and the `user_crate_opens` table enforces this with a
 *    UNIQUE key on (user_id, crate_key, opened_day). No purchase path exists.
 * 3. DETERMINISTIC OUTCOMES. `openCrate` takes an explicit roll in 0..9999.
 *    It never calls `Math.random()` internally, so the result is reproducible,
 *    testable, and auditable. The roll source is the only input.
 * 4. BOUNDED RARITY. No crate contains a guaranteed "legendary" — the weights
 *    always leave a non-zero gap for lower tiers.
 */

/** Rarity tiers, matching the CHECK constraint in migration 099. */
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** A cosmetic item that can drop from a crate. */
export interface Cosmetic {
  key: string;
  name: string;
  description: string;
  rarity: RarityTier;
  icon: string;
}

/** A crate type the user can open. */
export interface CrateDefinition {
  key: string;
  name: string;
  description: string;
  rarity: RarityTier;
  maxOpensPerDay: number;
  baseXp: number;
}

/**
 * Rarity drop weights (percent). Must sum to 100.
 * Legendary is deliberately rare (2%) so it cannot be farmed.
 */
export const CRATE_RARITY_WEIGHTS: Record<RarityTier, number> = {
  common: 50,
  uncommon: 25,
  rare: 15,
  epic: 8,
  legendary: 2,
} as const;
/** Valid crate keys — the single source of truth for the key type. */
export type CrateKey = 'daily' | 'weekly' | 'achievement';

/**
 * The three crate types a user can earn and open.
 * Mirrors `crate_key` column in `user_crate_inventory` and `user_crate_opens`.
 */
export const CRATES: Record<CrateKey, CrateDefinition> = {
  daily: {
    key: 'daily',
    name: 'Daily Cache',
    description: 'A modest cache that refreshes each day. Cosmetics and XP only.',
    rarity: 'common',
    maxOpensPerDay: 1,
    baseXp: 10,
  },
  weekly: {
    key: 'weekly',
    name: 'Weekly Chest',
    description: 'A larger cache earned from weekly challenges. Better cosmetics await.',
    rarity: 'rare',
    maxOpensPerDay: 1,
    baseXp: 25,
  },
  achievement: {
    key: 'achievement',
    name: 'Milestone Crate',
    description: 'Rewarded for unlocking significant achievements. Premium cosmetics inside.',
    rarity: 'epic',
    maxOpensPerDay: 1,
    baseXp: 50,
  },
} as const;

/**
 * Cosmetic definitions keyed by their lookup string.
 * All are cosmetic — avatar frames, sidebar themes, dashboard skins — no monetary value.
 */
export const COSMETICS: Record<string, Cosmetic> = {
  // Common tier
  'avatar-frame:copper': { key: 'avatar-frame:copper', name: 'Copper Frame', description: 'A simple copper accent for your profile.', rarity: 'common', icon: 'User' },
  'sidebar-theme:copper': { key: 'sidebar-theme:copper', name: 'Copper Sidebar', description: 'Warm copper tones for your sidebar.', rarity: 'common', icon: 'LayoutSidebar' },
  // Uncommon tier
  'avatar-frame:silver': { key: 'avatar-frame:silver', name: 'Silver Frame', description: 'A polished silver frame for your profile.', rarity: 'uncommon', icon: 'User' },
  'sidebar-theme:silver': { key: 'sidebar-theme:silver', name: 'Silver Sidebar', description: 'Cool silver tones for your sidebar.', rarity: 'uncommon', icon: 'LayoutSidebar' },
  'dashboard-theme:twilight': { key: 'dashboard-theme:twilight', name: 'Twilight Dashboard', description: 'A twilight color scheme for your dashboard.', rarity: 'uncommon', icon: 'Palette' },
  // Rare tier
  'avatar-frame:gold': { key: 'avatar-frame:gold', name: 'Gold Frame', description: 'A radiant gold frame for your profile.', rarity: 'rare', icon: 'User' },
  'sidebar-theme:crimson': { key: 'sidebar-theme:crimson', name: 'Crimson Sidebar', description: 'Deep crimson tones for your sidebar.', rarity: 'rare', icon: 'LayoutSidebar' },
  'dashboard-theme:nebula': { key: 'dashboard-theme:nebula', name: 'Nebula Dashboard', description: 'A cosmic nebula theme for your dashboard.', rarity: 'rare', icon: 'Palette' },
  'badge:early-adopter': { key: 'badge:early-adopter', name: 'Early Adopter', description: 'A badge showing you were here from the start.', rarity: 'rare', icon: 'Award' },
  // Epic tier
  'avatar-frame:platinum': { key: 'avatar-frame:platinum', name: 'Platinum Frame', description: 'A sleek platinum frame for your profile.', rarity: 'epic', icon: 'User' },
  'sidebar-theme:obsidian': { key: 'sidebar-theme:obsidian', name: 'Obsidian Sidebar', description: 'A dark, elegant theme for your sidebar.', rarity: 'epic', icon: 'LayoutSidebar' },
  'dashboard-theme:aurora': { key: 'dashboard-theme:aurora', name: 'Aurora Dashboard', description: 'An aurora-inspired theme for your dashboard.', rarity: 'epic', icon: 'Palette' },
  'badge:pioneer': { key: 'badge:pioneer', name: 'Pioneer', description: 'Awarded for charting new territory.', rarity: 'epic', icon: 'Award' },
  // Legendary tier
  'avatar-frame:radiant': { key: 'avatar-frame:radiant', name: 'Radiant Frame', description: 'A frame that seems to glow from within.', rarity: 'legendary', icon: 'User' },
  'sidebar-theme:stellar': { key: 'sidebar-theme:stellar', name: 'Stellar Sidebar', description: 'A cosmic theme that shifts with the seasons.', rarity: 'legendary', icon: 'LayoutSidebar' },
  'dashboard-theme:prismatic': { key: 'dashboard-theme:prismatic', name: 'Prismatic Dashboard', description: 'A dashboard theme that refracts light.', rarity: 'legendary', icon: 'Palette' },
  'badge:cosmic-navigator': { key: 'badge:cosmic-navigator', name: 'Cosmic Navigator', description: 'For those who see the whole picture.', rarity: 'legendary', icon: 'Award' },
} as const;
/**
 * Resolve a rarity tier from a 0..9999 roll using the weight table.
 * Deterministic: the same roll always maps to the same tier.
 */
export function rarityForRoll(roll: number): RarityTier {
  const clamped = Math.max(0, Math.min(9999, roll)) / 10000;
  let cumulative = 0;
  const tiers: RarityTier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  for (const tier of tiers) {
    cumulative += CRATE_RARITY_WEIGHTS[tier] / 100;
    if (clamped < cumulative) return tier;
  }
  return 'legendary';
}

/** Cosmetics filtered to a single rarity tier. */
const COSMETICS_BY_RARITY: Record<RarityTier, Cosmetic[]> = (() => {
  const bucket: Record<RarityTier, Cosmetic[]> = {
    common: [], uncommon: [], rare: [], epic: [], legendary: [],
  };
  for (const c of Object.values(COSMETICS)) bucket[c.rarity].push(c);
  return bucket;
})();

/**
 * Deterministically pick a cosmetic from a rarity tier using the roll.
 * The roll is reduced modulo the tier's length so the same roll always picks
 * the same cosmetic.
 */
export function cosmeticForTier(tier: RarityTier, roll: number): Cosmetic {
  const pool = COSMETICS_BY_RARITY[tier];
  const index = Math.abs(Math.floor(roll)) % pool.length;
  return pool[index];
}

/**
 * Open a crate for a user, deterministically.
 * @param crateKey  The crate type to open
 * @param roll      A caller-supplied roll in 0..9999 (never Math.random)
 * @returns The cosmetic dropped, its rarity, and base XP
 * This is PURE logic. The server module enforces constraints and credits XP.
 */
export function openCrate(
  crateKey: CrateKey,
  roll: number,
): { cosmeticKey: string; cosmeticName: string; rarity: RarityTier; xp: number } {
  const crate = CRATES[crateKey];
  const tier = rarityForRoll(roll);
  const cosmetic = cosmeticForTier(tier, roll);
  return {
    cosmeticKey: cosmetic.key,
    cosmeticName: cosmetic.name,
    rarity: tier,
    xp: crate.baseXp,
  };
}

/** Look up a cosmetic definition by its key. Returns undefined if not found. */
export function cosmeticFor(key: string): Cosmetic | undefined {
  return COSMETICS[key];
}

/**
 * Assert that a prize set contains nothing monetary.
 * Runs in the test suite and would fail if someone added a monetary field.
 */
export function assertNoMonetaryPrize(
  prizes: readonly { cosmeticKey: string; rarity: RarityTier; xp?: number }[],
): void {
  const forbidden = ['credit', 'cash', 'usd', 'amount', 'money', 'balance', 'payout'];
  for (const prize of prizes) {
    const haystack = `${prize.cosmeticKey} ${prize.rarity}`.toLowerCase();
    for (const word of forbidden) {
      if (haystack.includes(word)) {
        throw new Error(`prize "${prize.cosmeticKey}" looks monetary ("${word}")`);
      }
    }
    for (const key of Object.keys(prize)) {
      for (const word of forbidden) {
        if (key.toLowerCase().includes(word)) {
          throw new Error(`prize "${prize.cosmeticKey}" has monetary field "${key}"`);
        }
      }
    }
  }
}

/** XP a crate awards on opening. */
export function crateXp(crateKey: CrateKey): number {
  return CRATES[crateKey]?.baseXp ?? 0;
}

/** Cosmetics filtered by rarity, for UI rendering. Stable array order. */
export function cosmeticsByRarity(tier: RarityTier): readonly Cosmetic[] {
  return COSMETICS_BY_RARITY[tier];
}
