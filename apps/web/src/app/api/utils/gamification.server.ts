/**
 * REQUIREMENT SET V — server-side gate for gamification endpoints.
 *
 * SEPARATE FILE ON PURPOSE
 * -----------------------
 * The pure setting logic lives in `gamification.ts`, which imports nothing so
 * it is safe to use from a `'use client'` component. This file is the
 * database-backed half and must never be imported from the client: it pulls in
 * the Neon driver via `sql`.
 *
 * roman.agent.md 1262-1267, "When OFF": hide gamification features, remove
 * unnecessary UI, avoid unnecessary queries, do not penalize the user.
 *
 * WHY THIS IS SERVER-SIDE AND NOT ONLY UI
 * --------------------------------------
 * Hiding the nav links satisfies "remove unnecessary UI" and nothing else. A
 * user who has switched the feature off could still call the endpoint directly
 * and the query would still run. "Hide" and "avoid unnecessary queries" are
 * both about the effect, not about a CSS property, so the check belongs where
 * the data is produced.
 *
 * WHY 404 AND NOT 403
 * -------------------
 * A 403 confirms "gamification exists, you have it switched off" — exactly the
 * information the user asked not to be shown — and invites a client to keep
 * retrying. 404 simply does not exist for this user.
 *
 * NOTE ON "DO NOT PENALIZE": this gate only refuses to SERVE gamification
 * data. It never writes to `user_achievements` or any progress store. Progress
 * earned while the feature was off is intact when the user turns it back on.
 *
 * Must run AFTER authentication: an unauthenticated caller gets 401, not 404,
 * because the route genuinely does exist and is session-gated.
 */
import sql from '@/app/api/utils/sql';
import { isGamificationEnabled } from '@/app/api/utils/gamification';

/**
 * Read the user's preferences blob.
 *
 * Returns an empty object on failure, which callers resolve to the ON default:
 * the safe direction, since failing closed would hide gamification from
 * everyone during a transient database blip.
 */
async function readUserPreferences(userId: string): Promise<Record<string, unknown>> {
  try {
    const [row] = await sql`
      SELECT preferences FROM "user" WHERE id = ${userId} LIMIT 1
    `;
    const prefs = row?.preferences;
    return prefs && typeof prefs === 'object' && !Array.isArray(prefs)
      ? (prefs as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Returns a 404 Response when gamification is switched off for this user, or
 * null when the request may proceed.
 */
export async function requireGamificationEnabled(userId: string): Promise<Response | null> {
  const preferences = await readUserPreferences(userId);
  if (isGamificationEnabled(preferences)) return null;
  return Response.json({ error: 'Not found' }, { status: 404 });
}