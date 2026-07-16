/**
 * Beta integration flags (MVP v2 — P1).
 *
 * Four flags, one per Phase-2 integration. Persisted server-side in the
 * EXISTING `app_settings` table (key = 'beta_flags'), readable at
 * /api/system/health, toggled live from Settings → Beta Integrations.
 *
 * Defaults are ALL OFF, deliberately:
 *   - `voiceEscalation` MUST stay off until A2P/10DLC clears and the owner
 *     flips it (nothing dials before then).
 *   - "flag off ⇒ its integration produces zero events" is therefore the
 *     default state, which is what the P3 suite asserts.
 *
 * Cache TTL is 500ms + bust-on-write so a toggle is reflected in /api/health
 * well within the 1s gate.
 */
import sql from '@/app/api/utils/sql';

export const BETA_FLAG_KEYS = ['speedToLead', 'voiceEscalation', 'localPresence', 'cadenceEngine', 'negotiationProfiles'] as const;
export type BetaFlagKey = (typeof BETA_FLAG_KEYS)[number];
export type BetaFlags = Record<BetaFlagKey, boolean>;

export const DEFAULT_BETA_FLAGS: BetaFlags = {
  speedToLead: false,
  voiceEscalation: false,
  localPresence: false,
  cadenceEngine: false,
  // Phase N: per-list pricing/posture. OFF by default — unparks the DEFERRED
  // valuation item SAFELY (owner-only suggestions; AI still never emits a number).
  negotiationProfiles: false,
};

const SETTINGS_KEY = 'beta_flags';
const CACHE_TTL_MS = 500;
let cache: { at: number; flags: BetaFlags } | null = null;

function coerce(value: unknown): BetaFlags {
  const v = (value ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_BETA_FLAGS };
  for (const k of BETA_FLAG_KEYS) if (v[k] === true) out[k] = true;
  return out;
}

/** Current flags (DB → defaults). Never throws — a DB hiccup yields defaults (all off = safe). */
export async function getBetaFlags(nowMs: number = Date.now()): Promise<BetaFlags> {
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.flags;
  let flags = { ...DEFAULT_BETA_FLAGS };
  try {
    const [row] = await sql`SELECT value FROM app_settings WHERE key = ${SETTINGS_KEY} LIMIT 1`;
    flags = coerce(row?.value);
  } catch {
    flags = { ...DEFAULT_BETA_FLAGS }; // fail safe: off
  }
  cache = { at: nowMs, flags };
  return flags;
}

/** True iff a single flag is on. Used by every integration's entry point. */
export async function isBetaFlagOn(key: BetaFlagKey): Promise<boolean> {
  return (await getBetaFlags())[key] === true;
}

/** Persist a partial flag update (admin) and bust the cache immediately. */
export async function setBetaFlags(patch: Partial<BetaFlags>, updatedBy: string): Promise<BetaFlags> {
  const current = await getBetaFlags(0); // force fresh read
  const next: BetaFlags = { ...current };
  for (const k of BETA_FLAG_KEYS) if (typeof patch[k] === 'boolean') next[k] = patch[k] as boolean;
  await sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (${SETTINGS_KEY}, ${JSON.stringify(next)}, ${updatedBy}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `;
  cache = null;
  return next;
}

/** Test-only cache reset. */
export function __resetBetaFlagCache(): void {
  cache = null;
}
