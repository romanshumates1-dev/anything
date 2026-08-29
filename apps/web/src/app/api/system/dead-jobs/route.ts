/**
 * Dead Job Queue Monitoring
 *
 * GET: List jobs that have exhausted all retry attempts
 * POST: Retry dead jobs (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const since = url.searchParams.get('since'); // ISO date string

  try {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const deadJobs = await sql`
      SELECT
        id,
        type,
        payload,
        status,
        attempts,
        max_attempts,
        error_message,
        created_at,
        updated_at
      FROM jobs
      WHERE status = 'dead'
        AND updated_at >= ${sinceDate}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;

    const [{ count }] = await sql`
      SELECT COUNT(*) as count FROM jobs WHERE status = 'dead' AND updated_at >= ${sinceDate}
    `;

    // Group by type for summary
    const byType: Record<string, number> = {};
    for (const job of deadJobs) {
      byType[job.type] = (byType[job.type] || 0) + 1;
    }

    return NextResponse.json({
      total: parseInt(count),
      since: sinceDate.toISOString(),
      byType,
      jobs: deadJobs.map((j: any) => ({
        id: j.id,
        type: j.type,
        payload: j.payload,
        error: j.error_message,
        attempts: j.attempts,
        maxAttempts: j.max_attempts,
        createdAt: j.created_at,
        diedAt: j.updated_at,
      })),
    });
  } catch (error: any) {
    console.error('GET /api/system/dead-jobs error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json();
    const { jobIds, retryAll = false } = body as { jobIds?: string[]; retryAll?: boolean };

    if (!retryAll && (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0)) {
      return NextResponse.json({ error: 'jobIds array required (or set retryAll: true)' }, { status: 400 });
    }

    let result;
    if (retryAll) {
      // Retry all dead jobs from the last 7 days
      result = await sql`
        UPDATE jobs
        SET status = 'pending',
            attempts = 0,
            run_at = NOW(),
            locked_until = NULL,
            error_message = 'retried_from_dead',
            updated_at = NOW()
        WHERE status = 'dead'
          AND updated_at >= NOW() - INTERVAL '7 days'
        RETURNING id
      `;
    } else {
      result = await sql`
        UPDATE jobs
        SET status = 'pending',
            attempts = 0,
            run_at = NOW(),
            locked_until = NULL,
            error_message = 'retried_from_dead',
            updated_at = NOW()
        WHERE id = ANY(${jobIds})
          AND status = 'dead'
        RETURNING id
      `;
    }

    const retriedCount = result.length;

    await logEvent('dead_jobs_retried', 'system', 'jobs', {
      retriedCount,
      retryAll,
      jobIds: retryAll ? 'all' : jobIds,
    }, admin.userId);

    return NextResponse.json({
      success: true,
      retriedCount,
      message: `${retriedCount} job(s) moved back to pending queue`,
    });
  } catch (error: any) {
    console.error('POST /api/system/dead-jobs error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
