import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Update (toggle enabled / edit config) or delete a Lead Finder source.
 * Admin-only. Only fields explicitly provided are changed.
 */
const ACCESS_METHODS = ['API', 'CSV_DOWNLOAD', 'HTML_TABLE', 'MANUAL_ONLY'];
const TERMS_STATUSES = ['PERMITTED', 'MANUAL_ONLY', 'PROHIBITED'];

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await props.params;
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const [current] = await sql`
      SELECT * FROM lead_sources
      WHERE id = ${id} AND organization_id = ${organization.id}
      LIMIT 1
    `;
    if (!current) return Response.json({ error: 'Source not found' }, { status: 404 });

    const enabled = typeof b.enabled === 'boolean' ? b.enabled : current.enabled;
    const accessMethod = ACCESS_METHODS.includes(b.accessMethod as string) ? (b.accessMethod as string) : current.access_method;
    const robotsStatus = typeof b.robotsStatus === 'string' ? b.robotsStatus.trim() : current.robots_status;
    let termsStatus = TERMS_STATUSES.includes(b.termsStatus as string) ? (b.termsStatus as string) : current.terms_status;
    const distressWeight = Number.isFinite(Number(b.distressWeight))
      ? Math.max(0, Math.min(100, Math.round(Number(b.distressWeight))))
      : current.distress_weight;
    const notes = typeof b.notes === 'string' ? b.notes.trim() : current.notes;

    // Compliance guard: can't flip to PERMITTED without a recorded live robots check.
    if (termsStatus === 'PERMITTED' && (!robotsStatus || /^NOT_CHECKED$/i.test(robotsStatus))) {
      return Response.json(
        { error: 'Cannot set terms_status=PERMITTED without a recorded robots_status from a live check' },
        { status: 400 }
      );
    }

    const [row] = await sql`
      UPDATE lead_sources
      SET enabled = ${enabled},
          access_method = ${accessMethod},
          robots_status = ${robotsStatus},
          terms_status = ${termsStatus},
          distress_weight = ${distressWeight},
          notes = ${notes},
          updated_at = now()
      WHERE id = ${id} AND organization_id = ${organization.id}
      RETURNING *
    `;
    await logEvent('lead_source_updated', 'lead_source', String(id), { enabled, termsStatus, accessMethod }, admin.userId);
    return Response.json(row);
  } catch (error: any) {
    console.error('PATCH /api/lead-finder/sources/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await props.params;
    const [row] = await sql`
      DELETE FROM lead_sources
      WHERE id = ${id} AND organization_id = ${organization.id}
      RETURNING id, name
    `;
    if (!row) return Response.json({ error: 'Source not found' }, { status: 404 });
    await logEvent('lead_source_deleted', 'lead_source', String(id), { name: row.name }, admin.userId);
    return Response.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/lead-finder/sources/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
