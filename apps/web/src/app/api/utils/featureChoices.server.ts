/**
 * REQUIREMENT SET AB (slice 2) - server-side gate for onboarding feature choices.
 *
 * Mirrors `gamification.server.ts` on purpose: the pure read logic lives in
 * `featureChoices.ts` (client-safe, imports nothing), and this file is the
 * database-backed half that must never be imported from the client (pulls in
 * the Neon driver via `sql`).
 *
 * roman.agent.md SET AB: "Respect those choices. Do not force-enable
 * unnecessary features." Hiding a nav link satisfies nothing by itself - a
 * user who switched the feature off could still call the endpoint directly
 * and the query would still run. So the check belongs where the data is
 * produced, same as the gamification gate.
 *
 * WHY 404 AND NOT 403: same reasoning as `requireGamificationEnabled`. A 403
 * confirms the surface exists and invites retry; 404 simply does not exist
 * for this user. Fail-OPEN on read errors (empty preferences resolve to the
 * ON default): a transient DB blip must not hide product surfaces from
 * everyone, and a user who never answered keeps exactly what they had.
 *
 * Must run AFTER authentication: an unauthenticated caller gets 401, not 404,
 * because the route genuinely does exist and is session-gated.
 */
import sql from "@/app/api/utils/sql";
import {
  resolveFeatureChoice,
  type FeatureChoiceId,
} from "@/app/api/utils/featureChoices";

/**
 * Read the caller\'s preferences blob.
 *
 * Returns an empty object on failure, which callers resolve to the ON default:
 * the safe direction, since failing closed would hide product surfaces from
 * everyone during a transient database blip.
 */
async function readUserPreferences(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const [row] = await sql`
      SELECT preferences FROM "user" WHERE id = ${userId} LIMIT 1
    `;
    const prefs = (row as { preferences?: unknown } | undefined)?.preferences;
    return prefs && typeof prefs === "object" && !Array.isArray(prefs)
      ? (prefs as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Returns true when the caller\'s stored choices enable `id` (default ON for
 * users who never answered), false when they explicitly declined it.
 */
export async function isFeatureEnabledForUser(
  userId: string,
  id: FeatureChoiceId,
): Promise<boolean> {
  const preferences = await readUserPreferences(userId);
  return resolveFeatureChoice(preferences, id);
}

/**
 * Returns a 404 Response when `id` is switched off for this user, or null
 * when the request may proceed.
 */
export async function requireFeatureEnabled(
  userId: string,
  id: FeatureChoiceId,
): Promise<Response | null> {
  const enabled = await isFeatureEnabledForUser(userId, id);
  if (enabled) return null;
  return Response.json({ error: "Not found" }, { status: 404 });
}
