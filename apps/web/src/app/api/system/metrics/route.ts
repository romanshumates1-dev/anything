import sql from '@/app/api/utils/sql';

const START_TIME = Date.now();

export async function GET() {
  try {
    const [aiAgg] = await sql`
      SELECT count(*)::int AS total
      FROM audit_logs
      WHERE action LIKE 'ai_%'
    `;

    const [smsAgg] = await sql`
      SELECT
        count(*) FILTER (WHERE action = 'message_sent') AS sent,
        count(*) FILTER (WHERE action = 'message_failed') AS failed
      FROM audit_logs
    `;

    const [errorAgg] = await sql`
      SELECT count(*)::int AS total
      FROM audit_logs
      WHERE action LIKE '%error%' OR action LIKE '%failed%'
    `;

    return Response.json({
      aiCalls: parseInt(aiAgg?.total || '0', 10),
      smsSent: parseInt(smsAgg?.sent || '0', 10),
      smsFailed: parseInt(smsAgg?.failed || '0', 10),
      errors: parseInt(errorAgg?.total || '0', 10),
      uptimeSec: Math.floor((Date.now() - START_TIME) / 1000),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return Response.json({
      error: error?.message || 'unknown',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}