/**
 * Organization context - resolve the current organization from session.
 * 
 * This module provides the bridge between the session user and their
 * organization context for multi-tenant data isolation.
 */
import sql from '@/app/api/utils/sql';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { timingSafeSecretEqual } from '@/app/api/utils/secretCompare';

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export type MemberInfo = {
  userId: string;
  organizationId: string;
  role: string;
};

// Type for organization member row
type OrgMemberRow = {
  user_id: string;
  organization_id: string;
  role: string;
};

// Type for user role row
type UserRoleRow = {
  role: string;
};

/**
 * Get the current user's primary organization.
 * For now, uses a simple 'default' organization for backward compatibility.
 * Later, this will support user switching between organizations.
 */
export async function getOrganization(): Promise<Organization | null> {
  try {
    // LOCAL DEV BYPASS - Only works with explicit secret + development mode
    // SECURITY: Never rely on NODE_ENV alone as it could be misconfigured
    const headersList = await headers();
    const devSecret = process.env.LOCAL_DEV_SECRET;
    if (
      process.env.NODE_ENV === 'development' &&
      devSecret &&
      timingSafeSecretEqual(headersList.get('x-local-dev'), devSecret)
    ) {
      console.log('[ORG-CONTEXT] Local dev bypass active');

      try {
        // Return first available org or create org_default
        let [org] = await sql`SELECT id, name, slug FROM organizations LIMIT 1`;
        console.log('[ORG-CONTEXT] Query result:', org);

        if (!org) {
          console.log('[ORG-CONTEXT] No org found, creating default...');

          // Auto-create default org if none exists
          await sql`
            INSERT INTO organizations (id, name, slug, created_at)
            VALUES ('org_default', 'Default Organization', 'default', now())
            ON CONFLICT (id) DO NOTHING
          `;

          // Create test leads
          await sql`
            INSERT INTO leads (organization_id, name, email, phone, metadata, created_at)
            VALUES
              ('org_default', 'Test Lead 1', 'lead1@test.com', '+15551001', '{"address": "123 Main St"}', now()),
              ('org_default', 'Test Lead 2', 'lead2@test.com', '+15551002', '{"address": "456 Oak Ave"}', now()),
              ('org_default', 'Test Lead 3', 'lead3@test.com', '+15551003', '{"address": "789 Elm St"}', now())
            ON CONFLICT (organization_id, email) DO NOTHING
          `;

          // Create warmup config
          await sql`
            INSERT INTO email_warmup_config (organization_id, daily_limit, paused, created_at)
            VALUES ('org_default', 20, false, now())
            ON CONFLICT (organization_id) DO NOTHING
          `;

          [org] = await sql`SELECT id, name, slug FROM organizations WHERE id = 'org_default'`;
          console.log('[ORG-CONTEXT] Created org:', org);
        }

        if (org) {
          console.log('[ORG-CONTEXT] Returning org:', org.id);
          return { id: org.id, name: org.name, slug: org.slug };
        }

        console.log('[ORG-CONTEXT] WARNING: No org available, returning default');
        return { id: 'org_default', name: 'Default Org', slug: 'default' };
      } catch (error) {
        console.error('[ORG-CONTEXT] ERROR:', error);
        throw error;
      }
    }

    const session = await auth.api.getSession({ headers: headersList });
    if (!session?.user?.id) return null;

    // Try to get the user's organization via membership
    const rows = await sql`
      SELECT om.organization_id, o.name, o.slug
      FROM organization_members om
      JOIN organizations o ON o.id = om.organization_id
      WHERE om.user_id = ${session.user.id}
      ORDER BY om.created_at ASC
      LIMIT 1
    `;

    const member = rows[0] as any;
    if (member) {
      return {
        id: member.organization_id,
        name: member.name,
        slug: member.slug,
      };
    }

    // NO MEMBERSHIP, and NO CROSS-TENANT FALLBACK.
    //
    // DEFECT HISTORY (this change removes TWO separate fallbacks):
    //  1. It fell through to `org_default` unconditionally, so ANY authenticated
    //     membership-less session was handed the platform primary tenant
    //     (370k+ leads measured on the live database). Gated behind
    //     `role === 'ADMIN'` on 2026-09-26.
    //  2. That gate was STILL wrong. `role === 'ADMIN'` is not evidence of
    //     platform-wide authority: 16 accounts on the live database hold it
    //     while having NO organization at all, including the orphaned e2e/probe
    //     accounts left behind by the signup-hook defect (including the operator
    //     account). "Is an admin" and "may this session read the platform
    //     tenant" are different questions, and conflating them meant a stale or
    //     mis-set role silently conferred cross-tenant read access.
    //
    // THE FIX: the fallback is no longer role-derived at all. It requires BOTH
    // an explicit operator-curated allowlist (PLATFORM_ADMIN_EMAILS) AND an
    // existing `org_default` row. Everything else, including an admin who is
    // not on the allowlist, gets `null`, which every caller already translates
    // to 403.
    //
    // This is the "explicitly designed, documented, independently authorized
    // platform-global admin architecture" the security requirement calls for:
    // granting it is a deliberate, reviewable config change rather than a side
    // effect of a role column.
    if (!(await isPlatformOrgAdmin(session.user.id))) {
      return null;
    }

    // Platform admins may fall back to the default organization.
    const defaultOrgRows = await sql`
      SELECT id, name, slug FROM organizations WHERE id = 'org_default' LIMIT 1
    `;

    const defaultOrg = defaultOrgRows[0] as any;
    return defaultOrg || null;
  } catch (error) {
    console.error('getOrganization error:', error);
    return null;
  }
}

/**
 * Is this user an explicitly-authorized PLATFORM admin (allowed to fall back to
 * `org_default` when they hold no membership)?
 *
 * WHY AN ALLOWLIST AND NOT `role === 'ADMIN'`:
 * `role` answers "may this person administer the app's own admin surface", which
 * is a different question from "may this session read the platform's primary
 * tenant". Coupling them meant any account that ended up with an ADMIN role and
 * no organization — 16 of them on the live database — silently inherited
 * cross-tenant read access to `org_default` (370k+ leads). Authority to cross a
 * tenant boundary has to be explicit, reviewable and deliberate.
 *
 * Contract:
 *   - the user must actually hold `role = 'ADMIN'` in the database, AND
 *   - their email must appear in `PLATFORM_ADMIN_EMAILS`.
 * Requiring BOTH means demoting an allowlisted account actually removes the
 * fallback, so the allowlist can never outlive the role that justified it.
 *
 * Fails CLOSED on every error path, including an unset/empty variable: with no
 * allowlist configured, nobody gets the cross-tenant fallback.
 */
async function isPlatformOrgAdmin(userId: string): Promise<boolean> {
  try {
    const allowlist = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (allowlist.length === 0) return false;

    const rows = await sql`
      SELECT role, email FROM "user" WHERE id = ${userId} LIMIT 1
    `;
    const row = rows[0] as { role?: string; email?: string } | undefined;
    if (row?.role !== 'ADMIN') return false;
    return allowlist.includes((row.email ?? '').trim().toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Get all organizations the current user belongs to with their roles.
 */
export async function getUserOrganizations(userId: string): Promise<MemberInfo[]> {
  try {
    const rows = await sql`
      SELECT om.user_id, om.organization_id, om.role
      FROM organization_members om
      WHERE om.user_id = ${userId}
      ORDER BY om.created_at ASC
    `;

    // SAME DEFECT, LISTING PATH (fixed together with getOrganization above).
    // This synthesised a fake `org_default` membership for ANY role=ADMIN user,
    // which had two consequences: the org switcher would show a tenant the user
    // was never a member of, and any caller trusting this LIST to decide what a
    // user may reach would be told "yes, org_default" on the strength of a role
    // column. Now gated by the same explicit allowlist, so the listing and the
    // authorization path cannot disagree.
    if (await isPlatformOrgAdmin(userId)) {
      const hasMembership = rows.some((r: any) => r.organization_id === 'org_default');
      if (!hasMembership) {
        (rows as any[]).push({
          user_id: userId,
          organization_id: 'org_default',
          role: 'ADMIN',
        });
      }
    }

    return (rows as OrgMemberRow[]).map(r => ({
      userId: r.user_id,
      organizationId: r.organization_id,
      role: r.role,
    }));
  } catch (error) {
    console.error('getUserOrganizations error:', error);
    return [];
  }
}

/**
 * Check if a user has a specific role in an organization.
 */
export function hasRole(userRole: string | null, requiredRole: string): boolean {
  const roleHierarchy = ['VIEWER', 'MEMBER', 'AGENT', 'MANAGER', 'ADMIN', 'OWNER'];
  const userIndex = userRole ? roleHierarchy.indexOf(userRole as any) : -1;
  const requiredIndex = roleHierarchy.indexOf(requiredRole as any);
  return userIndex >= requiredIndex;
}

/**
 * Get effective organization ID, AUTHORIZED.
 *
 * SECURITY FIX (2026-09-26 adversarial review): this function previously read
 *
 *     if (explicitOrgId) return explicitOrgId;
 *
 * with NO membership check at all, and its docstring advertised exactly that
 * ("Priority: explicit orgId > session context"). Any route passing a
 * request-controlled value into it would therefore have been a textbook IDOR:
 * a caller could read or write another organization's data simply by
 * supplying its id.
 *
 * It had no callers, so nothing was exploitable today - but it was a loaded
 * gun with the safety off, and the next developer to use it would have
 * inherited a cross-tenant data leak.
 *
 * An explicit org id is now a REQUEST FOR ACCESS, not an answer: it is
 * honoured only when the session user is genuinely a member of that org (or
 * is a platform ADMIN). Anything else falls back to the session's own org.
 */
export async function getEffectiveOrganizationId(
  explicitOrgId?: string | null
): Promise<string | null> {
  const sessionOrg = await getOrganization();
  if (explicitOrgId) {
    const userId = await getSessionUserId();
    if (userId && (await isMemberOf(userId, explicitOrgId) || (await isPlatformAdmin(userId)))) {
      return explicitOrgId;
    }
    // Not entitled: refuse the explicit id rather than silently widening
    // access. The caller receives the org it actually belongs to.
  }

  return sessionOrg?.id || null;
}

/** The session user id, or null when unauthenticated. */
async function getSessionUserId(): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/** True only on a confirmed membership row. */
async function isMemberOf(userId: string, orgId: string): Promise<boolean> {
  try {
    const rows = await sql`
      SELECT 1 FROM organization_members
      WHERE user_id = ${userId} AND organization_id = ${orgId}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    // Fail CLOSED: a database error must never be read as "is a member".
    return false;
  }
}

/**
 * True only for an EXPLICITLY allowlisted platform admin.
 *
 * This replaced a bare `role === 'ADMIN'` check. It is the most dangerous of
 * the three role-derived fallbacks, because it authorises an org id that came
 * from the REQUEST: `getEffectiveOrganizationId(explicitOrgId)` will hand back
 * `explicitOrgId` whenever the caller is a platform admin. Combined with the
 * role gate, ANY admin account - including the 16 orphaned ones with no
 * organization - could name any tenant's id and be granted it. That is a direct
 * IDOR into every organization, not merely access to the default one.
 *
 * It now defers to the same `isPlatformOrgAdmin` allowlist as the other two
 * paths, so "may cross a tenant boundary" has exactly one definition.
 */
async function isPlatformAdmin(userId: string): Promise<boolean> {
  return isPlatformOrgAdmin(userId);
}
