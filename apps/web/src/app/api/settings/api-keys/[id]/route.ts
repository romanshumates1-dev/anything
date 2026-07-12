import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { requireAdmin } from '@/app/api/utils/authz';

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  // Key revocation is a destructive admin-only action.
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Next 16: route-handler params is a Promise and MUST be awaited — reading
    // props.params.id synchronously yields undefined (revocation always 404'd).
    const { id } = await props.params;
    const orgId = session.user.id;

    const [key] = await sql`
      SELECT * FROM api_keys WHERE id = ${id} AND organization_id = ${orgId} LIMIT 1
    `;

    if (!key) return Response.json({ error: 'Not found' }, { status: 404 });

    await sql`UPDATE api_keys SET revoked = true WHERE id = ${id} AND organization_id = ${orgId}`;

    await logEvent('api_key_revoked', 'api_key', key.id, { name: key.name, prefix: key.prefix }, orgId);

    return Response.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/settings/api-keys error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}