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

    // NO MEMBERSHIP.
    //
    // DEFECT (tenant isolation): this used to fall through to `org_default`
    // unconditionally, so ANY authenticated user with no organization membership
    // was handed the default organization instead of being refused. `org_default`
    // holds the bulk of the platform's leads (370k+ rows) and has zero members,
    // so the fallback was a mass data exposure for every membership-less session
    // - including the orphaned CI/E2E accounts still holding live sessions.
    //
    // `getUserOrganizations` (below) has always gated `org_default` behind
    // `role === 'ADMIN'`; this authorization path now applies the same gate, so
    // the two can no longer disagree. A membership-less non-admin gets `null`,
    // which every caller already translates to 403.
    const userRows = (await sql`
      SELECT role FROM "user" WHERE id = ${session.user.id} LIMIT 1
    `) as UserRoleRow[];
    if (userRows[0]?.role !== 'ADMIN') {
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

    // Also check if user has admin platform access (can access default org)
    const userRows = await sql`
      SELECT role FROM "user" WHERE id = ${userId} LIMIT 1
    `;
    
    const userRoleRows = userRows as UserRoleRow[];
    if (userRoleRows[0]?.role === 'ADMIN') {
      // Admin users get access to default org if not already a member
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

async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await sql`SELECT role FROM "user" WHERE id = ${userId} LIMIT 1`;
    return rows[0]?.role === 'ADMIN';
  } catch {
    return false;
  }
}
