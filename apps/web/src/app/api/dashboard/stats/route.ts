import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [[leadStats], [pendingJobs], [auditCount], [humanRequired]] = await sql.transaction([
      sql`SELECT count(*) FROM leads`,
      sql`SELECT count(*) FROM jobs WHERE status = 'pending'`,
      sql`SELECT count(*) FROM audit_logs`,
      sql`SELECT count(*) FROM ai_conversations WHERE requires_human = TRUE`,
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
