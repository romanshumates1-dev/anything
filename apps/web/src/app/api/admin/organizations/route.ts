/**
 * Admin Organization Management API
 *
 * GET /api/admin/organizations - list all organizations with stats
 * PATCH /api/admin/organizations/:id - update organization status
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
    const organizations = await sql`
      SELECT
        o.id,
        o.name,
        o.slug,
        o."createdAt" as created_at,
        (SELECT COUNT(*)::int FROM "user" u WHERE u.organization_id = o.id) as member_count,
        (SELECT COUNT(*)::int FROM leads l WHERE l.organization_id = o.id) as lead_count,
        (SELECT os.status FROM organization_subscriptions os WHERE os.organization_id = o.id ORDER BY os.created_at DESC LIMIT 1) as subscription_status
      FROM organizations o
      ORDER BY o."createdAt" DESC
      LIMIT 500
    `;

    return Response.json(organizations);
  } catch (error) {
    console.error('GET /api/admin/organizations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('id');

  if (!orgId) {
    return Response.json({ error: 'Organization ID required' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { name, status } = body;

    // Verify organization exists
    const [existing] = await sql`
      SELECT id, name FROM organizations WHERE id = ${orgId} LIMIT 1
    `;

    if (!existing) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Build update query
    if (name !== undefined) {
      await sql`
        UPDATE organizations SET name = ${name} WHERE id = ${orgId}
      `;
    } else {
      return Response.json({ error: 'No valid update fields provided' }, { status: 400 });
    }

    await logEvent('admin_organization_updated', 'organization', orgId, {
      updatedBy: admin.userId,
      updates: Object.keys(body),
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('PATCH /api/admin/organizations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}