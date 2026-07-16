import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

export async function GET() {
  // Operational metadata (connection counts) is admin-only. This route sits in
  // the middleware's /api/system exemption, so it must gate itself — otherwise
  // it is anonymously readable.
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const start = Date.now();
    await sql`SELECT 1 AS ok`;
    const latencyMs = Date.now() - start;

    const [poolInfo] = await sql`
      SELECT count(*)::int AS active_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND pid <> pg_backend_pid()
    `;

    return Response.json({
      connected: true,
      latencyMs,
      poolSize: 10,
      activeConnections: parseInt(poolInfo?.active_connections || '0', 10),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return Response.json({
      connected: false,
      error: error?.message || 'unknown',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}