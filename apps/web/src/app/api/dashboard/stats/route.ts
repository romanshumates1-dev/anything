import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    // SECURITY: All stats scoped to organization to prevent cross-tenant data leakage
    const [[leadStats], [pendingJobs], [auditCount], [humanRequired]] = await sql.transaction([
      sql`SELECT count(*) FROM leads WHERE organization_id = ${org.id}`,
      sql`SELECT count(*) FROM jobs WHERE status = 'pending'`,
      sql`SELECT count(*) FROM audit_logs WHERE organization_id = ${org.id}`,
      sql`SELECT count(*) FROM ai_conversations c JOIN leads l ON l.id = c.lead_id WHERE c.requires_human = TRUE AND l.organization_id = ${org.id}`,
    ]);

    return Response.json({
      totalLeads: parseInt(leadStats.count),
      pendingJobs: parseInt(pendingJobs.count),
      auditCount: parseInt(auditCount.count),
      requiresHuman: parseInt(humanRequired.count),
    });
  } catch (error: any) {
    console.error('GET /api/dashboard/stats error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
