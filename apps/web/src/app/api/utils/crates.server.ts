/**
 * Server-side crate operations. These are the database-backed write/read paths
 * for the crate economy. The pure definitions remain in `crates.ts`.
 */
import sql from '@/app/api/utils/sql';
import { awardXp } from '@/app/api/utils/gamificationRewards.server';
import { randomInt } from 'node:crypto';
import {
  CRATES,
  COSMETICS,
  openCrate,
  type CrateKey,
  type RarityTier,
} from '@/app/api/utils/crates';

export type CrateInventoryItem = {
  cosmeticKey: string;
  rarity: RarityTier;
  isEquipped: boolean;
};

export type AvailableCrate = {
  key: string;
  name: string;
  canOpen: boolean;
  opensToday: number;
};

/**
 * Cryptographically secure roll in 0..9999 — the sole entropy source for a
 * crate opening. `openCrate(crateKey, roll)` consumes it deterministically, so
 * the randomness is isolated here and auditable in one place.
 *
 * Server-only by design: the roll must never be produced (or replayable) in
 * the browser. `node:crypto.randomInt` gives a uniform integer in [min, max).
 */
export function secureRoll(): number {
  return randomInt(0, 10000);
}

export async function getUserCrateInventory(userId: string): Promise<{
  availableCrates: AvailableCrate[];
  inventory: CrateInventoryItem[];
  equipped: CrateInventoryItem[];
  xp: number;
}> {
  const [xpRow] = await sql`
    SELECT COALESCE(points, 0)::int AS xp
    FROM public.user_stats
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  const inventoryRows = await sql`
    SELECT cosmetic_key, crate_key, rarity, is_equipped
    FROM public.user_crate_inventory
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `;

  const opensRows = await sql`
    SELECT crate_key, COUNT(*)::int AS opens_today
    FROM public.user_crate_opens
    WHERE user_id = ${userId}
      AND opened_day = CURRENT_DATE
    GROUP BY crate_key
  `;

  const opensToday: Record<string, number> = {};
  for (const row of opensRows) {
    opensToday[String(row.crate_key)] = Number(row.opens_today ?? 0);
  }

  const inventory: CrateInventoryItem[] = inventoryRows.map((row) => ({
    cosmeticKey: String(row.cosmetic_key),
    rarity: String(row.rarity) as RarityTier,
    isEquipped: row.is_equipped === true,
  }));

  const equipped = inventory.filter((item) => item.isEquipped);

  const availableCrates = Object.values(CRATES).map((crate) => ({
    key: crate.key,
    name: crate.name,
    canOpen: (opensToday[crate.key] ?? 0) < crate.maxOpensPerDay,
    opensToday: Number(opensToday[crate.key] ?? 0),
  }));

  return {
    availableCrates,
    inventory,
    equipped,
    xp: Number(xpRow?.xp ?? 0),
  };
}

export async function openCrateForUser(
  userId: string,
  crateKey: string,
): Promise<{ ok: true; cosmeticKey: string; cosmeticName: string; rarity: RarityTier; xpAwarded: number } | { ok: false; reason: string }> {
  if (!crateKey || !(crateKey in CRATES)) {
    return { ok: false, reason: 'invalid crateKey' };
  }

  const validKey = crateKey as CrateKey;

  const openRows = await sql`
    SELECT 1
    FROM public.user_crate_opens
    WHERE user_id = ${userId}
      AND crate_key = ${validKey}
      AND opened_day = CURRENT_DATE
    LIMIT 1
  `;

  if (openRows.length > 0) {
    return { ok: false, reason: 'already opened today' };
  }

  const award = openCrate(validKey, secureRoll());
  const insertOpen = await sql`
    INSERT INTO public.user_crate_opens (user_id, crate_key)
    VALUES (${userId}, ${validKey})
    ON CONFLICT (user_id, crate_key, opened_day) DO NOTHING
    RETURNING id
  `;

  if (insertOpen.length === 0) {
    return { ok: false, reason: 'already opened today' };
  }

  await sql`
    INSERT INTO public.user_crate_inventory (user_id, crate_key, cosmetic_key, rarity)
    VALUES (${userId}, ${validKey}, ${award.cosmeticKey}, ${award.rarity})
    ON CONFLICT (user_id, crate_key, cosmetic_key) DO NOTHING
  `;

  await awardXp(userId, award.xp);

  return {
    ok: true,
    cosmeticKey: award.cosmeticKey,
    cosmeticName: award.cosmeticName,
    rarity: award.rarity,
    xpAwarded: award.xp,
  };
}

export async function equipCosmetic(
  userId: string,
  cosmeticKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!cosmeticKey || !COSMETICS[cosmeticKey]) {
    return { ok: false, reason: 'unknown cosmetic' };
  }

  const owned = await sql`
    UPDATE public.user_crate_inventory
       SET is_equipped = true
     WHERE user_id = ${userId}
       AND cosmetic_key = ${cosmeticKey}
     RETURNING id
  `;

  if (owned.length === 0) {
    return { ok: false, reason: 'cosmetic not owned' };
  }

  await sql`
    UPDATE public.user_crate_inventory
       SET is_equipped = false
     WHERE user_id = ${userId}
       AND cosmetic_key <> ${cosmeticKey}
       AND is_equipped = true
  `;

  return { ok: true };
}
