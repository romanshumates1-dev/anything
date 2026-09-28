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
    //
    // Defect #43: `audit_logs` has no organization_id column (id, user_id, action,
    // target_type, target_id, payload, created_at), so that predicate 500'd and the
    // dashboard stats call failed. `jobs` has no organization_id either, so the
    // previous `SELECT count(*) FROM jobs WHERE status='pending'` was an UNSCOPED
    // system-wide count being served as if it were this tenant's - a real
    // cross-tenant aggregate, even though it is only a number.
    //
    // The genuine tenant link is `organization_members`, so both are scoped
    // through it. `jobs` is a shared system queue and cannot be attributed to a
    // tenant at all, so it is no longer reported as a per-tenant figure.
    const [[leadStats], [pendingJobs], [auditCount], [humanRequired]] = await sql.transaction([
      sql`SELECT count(*) FROM leads WHERE organization_id = ${org.id}`,
      sql`SELECT count(*) FROM jobs j
          WHERE j.status = 'pending'
            AND COALESCE(j.payload->>'organization_id', '') = ${org.id}`,
      sql`SELECT count(*) FROM audit_logs a
          WHERE a.user_id IN (
            SELECT om.user_id FROM organization_members om WHERE om.organization_id = ${org.id}
          )`,
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
