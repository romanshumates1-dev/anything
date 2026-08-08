/**
 * Organization context - resolve the current organization from session.
 * 
 * This module provides the bridge between the session user and their
 * organization context for multi-tenant data isolation.
 */
import sql from '@/app/api/utils/sql';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';

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
    // LOCAL DEV BYPASS
    const headersList = await headers();
    if (process.env.NODE_ENV === 'development' && headersList.get('x-local-dev') === 'true') {
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

    // Fallback to default organization for backward compatibility
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
 * Get effective organization ID from various sources.
 * Priority: explicit orgId > session context > default
 */
export async function getEffectiveOrganizationId(
  explicitOrgId?: string | null
): Promise<string | null> {
  if (explicitOrgId) return explicitOrgId;
  
  const org = await getOrganization();
  return org?.id || null;
}