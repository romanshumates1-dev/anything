/**
 * GET /api/negotiation/stats
 *
 * Get negotiation statistics for the organization.
 */
import { requireSession } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { getNegotiationStats } from '@/app/api/utils/negotiationProcessor';

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  const stats = await getNegotiationStats(organization.id);
  return Response.json(stats);
}
