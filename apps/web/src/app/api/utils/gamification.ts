/**
 * REQUIREMENT SET V — OPTIONAL GAMIFICATION SYSTEM: the ON/OFF setting.
 *
 * Source of truth: `.github/agents/roman.agent.md` lines 1254–1280.
 *
 *     Add an optional user setting: GAMIFICATION: ON/OFF
 *     When OFF: hide gamification features, remove unnecessary UI,
 *                avoid unnecessary queries, do not penalize the user.
 *
 * WHAT THIS MODULE IS, AND DELIBERATELY IS NOT
 * -------------------------------------------
 * It is the reading and normalisation of ONE boolean. It is not the award
 * logic, and it contains nothing that can grant, revoke or clear progress.
 *
 * That separation is the whole design. The tempting implementation of "when
 * OFF" is to stop awarding at the write site — and it is wrong in a way that is
 * invisible until a user notices:
 *
 *   * A user who switches the feature off for a week and back on finds their
 *     progress gone.
 *   * A user who earns progress while it is off and then enables it is credited
 *     with nothing.
 *
 * Both are the setting silently costing the user something they genuinely
 * earned, which is exactly the "do not penalize the user" clause. So the rule
 * enforced here is:
 *
 *     RECORDING is independent of the DISPLAY setting.
 *     The setting decides visibility and whether gamification queries run.
 *
 * Nothing in this file can clear progress, so nothing in this file can
 * penalise anyone. That is asserted by the test suite, not merely intended.
 *
 * Defaulting
 * ----------
 * ON. Gamification UI shipped visible to every existing account, so a user who
 * has never touched the setting must keep seeing what they always saw.
 * Defaulting to OFF would silently strip UI from accounts that never opted in.
 *
 * CLIENT-SAFE BY CONSTRUCTION
 * --------------------------
 * This module deliberately imports NOTHING — not the database driver, not
 * `next/headers`, not server-only modules. `Shell.tsx` is a `'use client'`
 * component and imports `isGamificationEnabled` from here to decide whether to
 * render the nav links, so a `sql` import in this file would pull the Neon
 * driver into the browser bundle. The database-backed gate lives in
 * `gamification.server.ts` instead.
 */

/** The stored preference key. Part of the user's own preferences blob. */
export const GAMIFICATION_PREF_KEY = 'gamification_enabled';

/**
 * Default state for a user with no stored preference.
 *
 * ON, so pre-existing accounts are unaffected.
 */
export const DEFAULT_GAMIFICATION_ENABLED = true;

/**
 * Coerce an arbitrary stored/read value to a boolean.
 *
 * Strictly `true`/`false` are honoured. Everything else — the STRING 'false',
 * 0, 1, null, an object, an array — resolves to the default rather than
 * being guessed at, because both guessing directions are harmful:
 * reading `'false'` as true leaves a user who tried to turn the feature off
 * stuck with it; reading it as false removes UI from someone who never
 * disabled anything.
 */
export function normalizeGamificationPreference(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  return DEFAULT_GAMIFICATION_ENABLED;
}

/**
 * Read the setting out of a user's preferences blob.
 *
 * Tolerates a blob of the wrong shape: a caller must never crash because a
 * partially-written preferences row came back as an array or a string.
 */
export function isGamificationEnabled(preferences: unknown): boolean {
  if (
    !preferences ||
    typeof preferences !== 'object' ||
    Array.isArray(preferences)
  ) {
    return DEFAULT_GAMIFICATION_ENABLED;
  }
  return normalizeGamificationPreference(
    (preferences as Record<string, unknown>)[GAMIFICATION_PREF_KEY],
  );
}
