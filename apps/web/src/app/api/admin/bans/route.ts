/**
 * Admin Ban/Suspension Management API
 *
 * POST /api/admin/bans - suspend an organization (temporary ban)
 * DELETE /api/admin/bans?id=xxx - restore a suspended organization
 * GET /api/admin/bans - list suspended organizations
 *
 * ADMIN-only via requireAdmin middleware.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const suspended = await sql`
      SELECT
        o.id,
        o.name,
        o.slug,
        o."createdAt" as created_at,
        b.suspended_at,
        b.reason,
        b.expires_at
      FROM organizations o
      JOIN bans b ON b.organization_id = o.id
      WHERE b.active = true
      ORDER BY b.suspended_at DESC
      LIMIT 100
    `;

    return Response.json(suspended);
  } catch (error) {
    console.error('GET /api/admin/bans error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json();
    const { organizationId, reason, durationHours } = body;

    if (!organizationId) {
      return Response.json({ error: 'Organization ID required' }, { status: 400 });
    }

    // Verify organization exists
    const [org] = await sql`
      SELECT id FROM organizations WHERE id = ${organizationId} LIMIT 1
    `;

    if (!org) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Check if already suspended
    const [existing] = await sql`
      SELECT id FROM bans WHERE organization_id = ${organizationId} AND active = true LIMIT 1
    `;

    if (existing) {
      return Response.json({ error: 'Organization already suspended' }, { status: 409 });
    }

    const banId = `ban_${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = durationHours
      ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString()
      : null;

    await sql`
      INSERT INTO bans (id, organization_id, reason, expires_at)
      VALUES (${banId}, ${organizationId}, ${reason || 'Policy violation'}, ${expiresAt})
    `;

    await logEvent('admin_organization_suspended', 'organization', organizationId, {
      suspendedBy: admin.userId,
      reason,
      expiresAt,
    });

    return Response.json({ success: true, banId, expiresAt }, { status: 201 });
  } catch (error) {
    console.error('POST /api/admin/bans error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get('id');

  if (!organizationId) {
    return Response.json({ error: 'Organization ID required' }, { status: 400 });
  }

  try {
    // Deactivate ban
    const result = await sql`
      UPDATE bans
      SET active = false,
          restored_at = NOW(),
          restored_by = ${admin.userId}
      WHERE organization_id = ${organizationId} AND active = true
    `;

    if (result.length === 0) {
      return Response.json({ error: 'No active ban found for this organization' }, { status: 404 });
    }

    await logEvent('admin_organization_restored', 'organization', organizationId, {
      restoredBy: admin.userId,
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/admin/bans error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}