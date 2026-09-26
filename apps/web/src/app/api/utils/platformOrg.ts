import sql from '@/app/api/utils/sql';

/**
 * Resolve the platform's primary organization for public, session-less inbound
 * paths (public funnel capture, public keyword webhooks).
 *
 * WHY THIS EXISTS: `leads.organization_id` is NOT NULL (migration 030), so any
 * INSERT that omits it throws and the endpoint 500s — the same class of bug as
 * BREAKAGE_TABLE #35 (`/api/leads/bulk`, `/api/lead-finder/create-campaign`).
 * A public webhook/form cannot resolve a session, so captured data belongs to
 * the platform's primary organization — the same resolution
 * `lib/organization-context.ts` falls back to (first org, else `org_default`).
 *
 * Returns null when no organization exists, so callers can fail closed with a
 * precise 503 instead of a raw constraint violation.
 */
export async function resolvePlatformOrganizationId(): Promise<string | null> {
  const [org] = await sql`
    SELECT id FROM organizations
    ORDER BY created_at ASC NULLS LAST
    LIMIT 1
  `.catch(() => [null]);
  return (org?.id as string) ?? null;
}
