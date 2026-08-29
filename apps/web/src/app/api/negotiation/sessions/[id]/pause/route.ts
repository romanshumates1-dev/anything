import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { pauseSession } from '@/app/api/utils/negotiationSession';

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  const { id } = await props.params;
  const result = await pauseSession(id, organization.id);
  return Response.json({ paused: true, cancelledJobs: result.cancelled });
}
