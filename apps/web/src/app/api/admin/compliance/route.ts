/**
 * Admin compliance ops (Phase 4): global suppression-list viewer + opt-out
 * volume. ADMIN-only. Read-only.
 * GET /api/admin/compliance?q=<phone substring>
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const q = new URL(request.url).searchParams.get('q');

  try {
    const suppressions = await sql`
      SELECT target, channel, metadata, created_at
      FROM compliance_records
      WHERE type = 'opt-out'
        AND (${q}::text IS NULL OR target ILIKE '%' || ${q} || '%')
      ORDER BY created_at DESC
      LIMIT 500
    `;
    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM compliance_records WHERE type = 'opt-out'
    `;

    return Response.json({ suppressions, total });
  } catch (error) {
    console.error('GET /api/admin/compliance error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
