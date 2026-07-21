/**
 * System Metrics API - observability and monitoring endpoint
 *
 * GET /api/metrics - returns system health, job queue, and usage metrics
 * No authentication required (for monitoring systems)
 */
import sql from '@/app/api/utils/sql';

export async function GET() {
  try {
    // Gather system metrics in parallel
    const [
      [dbHealth],
      [jobStats],
      usageStats,
      [smsStats],
      aiProviderStats,
    ] = await sql.transaction([
      // Database health check
      sql`SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'`,

      // Job queue stats
      sql`SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour
      FROM jobs`,

      // Usage stats (last 24 hours)
      sql`SELECT 
        metric_type,
        SUM(amount)::int as total_amount
      FROM usage_ledger
      WHERE recorded_at > NOW() - INTERVAL '24 hours'
      GROUP BY metric_type`,

      // SMS delivery stats (last 24 hours)
      sql`SELECT 
        COUNT(*) FILTER (WHERE status = 'dispatched') as dispatched,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered
      FROM message_events
      WHERE created_at > NOW() - INTERVAL '24 hours'`,

      // AI provider stats
      sql`SELECT 
        provider_type,
        COUNT(*) as count,
        AVG(response_time_ms)::int as avg_response_time
      FROM ai_requests
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY provider_type`,
    ]);

    const metrics = {
      timestamp: new Date().toISOString(),
      database: {
        healthy: true,
        tableCount: parseInt((dbHealth as any)?.table_count || '0'),
      },
      jobs: {
        pending: parseInt((jobStats as any)?.pending || '0'),
        running: parseInt((jobStats as any)?.running || '0'),
        completed: parseInt((jobStats as any)?.completed || '0'),
        failed: parseInt((jobStats as any)?.failed || '0'),
        lastHour: parseInt((jobStats as any)?.last_hour || '0'),
      },
      usage: {
        sms: parseInt((usageStats as any)?.find((s: any) => s.metric_type === 'sms')?.total_amount || '0'),
        aiRequests: parseInt((usageStats as any)?.find((s: any) => s.metric_type === 'ai_request')?.total_amount || '0'),
        apiCalls: parseInt((usageStats as any)?.find((s: any) => s.metric_type === 'api_rate')?.total_amount || '0'),
        automations: parseInt((usageStats as any)?.find((s: any) => s.metric_type === 'automation')?.total_amount || '0'),
      },
      sms: {
        dispatched: parseInt((smsStats as any)?.dispatched || '0'),
        failed: parseInt((smsStats as any)?.failed || '0'),
        delivered: parseInt((smsStats as any)?.delivered || '0'),
      },
      aiProviders: (aiProviderStats as any)?.map((s: any) => ({
        type: s.provider_type,
        count: parseInt(s.count),
        avgResponseTime: s.avg_response_time,
      })) || [],
    };

    return Response.json(metrics);
  } catch (error) {
    console.error('GET /api/metrics error', error);
    return Response.json(
      {
        error: 'Internal Server Error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}