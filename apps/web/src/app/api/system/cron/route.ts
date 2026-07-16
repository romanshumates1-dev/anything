/**
 * CRON JOB DISPATCHER
 *
 * Scheduled tasks that run on an interval via the host's cron mechanism.
 * Each task is idempotent and logs its outcome to the execution ledger.
 *
 * Endpoint: POST /api/system/cron
 * Auth: x-cron-secret header must match CRON_SECRET env var
 *
 * Supported tasks:
 *   - stuck-conversations: Check for conversations stuck in processing (5 min)
 *   - retry-sms: Retry failed SMS sends (hourly)
 *   - daily-report: Generate daily summary (nightly)
 *   - log-cleanup: Clean up old audit logs (weekly)
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { recordRun } from '@/app/api/utils/execution-ledger';

type CronTask = {
  name: string;
  handler: () => Promise<{ processed: number; detail: string }>;
};

const CRON_SECRET = process.env.CRON_SECRET || '';

function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Task 1: Stuck Conversation Check (every 5 minutes)
 *
 * Finds jobs that are in 'processing' state with an expired lock (locked_until < now)
 * and resets them to 'pending' so they can be retried.
 */
async function handleStuckConversations() {
  const result = await sql`
    UPDATE jobs
    SET status = 'pending',
        locked_until = NULL,
        updated_at = now()
    WHERE status = 'processing'
      AND locked_until < now()
    RETURNING id
  `;

  const count = result.length;
  if (count > 0) {
    await logEvent('cron_stuck_conversations', 'system', 'cron', {
      unstuckCount: count,
      ids: result.map((r: any) => r.id),
    });
  }

  return { processed: count, detail: `Unstuck ${count} stuck jobs` };
}

/**
 * Task 2: Retry Failed SMS (hourly)
 *
 * Resets failed jobs (attempts < max_attempts) back to pending so the
 * job processor will retry them.
 */
async function handleRetrySms() {
  const result = await sql`
    UPDATE jobs
    SET status = 'pending',
        locked_until = NULL,
        updated_at = now()
    WHERE status = 'failed'
      AND attempts < max_attempts
    RETURNING id
  `;

  const count = result.length;
  if (count > 0) {
    await logEvent('cron_retry_sms', 'system', 'cron', {
      retryCount: count,
      ids: result.map((r: any) => r.id),
    });
  }

  return { processed: count, detail: `Retried ${count} failed jobs` };
}

/**
 * Task 3: Daily Report (nightly)
 *
 * Aggregates key metrics from the past 24 hours and logs them.
 */
async function handleDailyReport() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [msgAgg] = await sql`
    SELECT
      count(*) FILTER (WHERE action = 'message_sent') AS sent,
      count(*) FILTER (WHERE action = 'message_failed') AS failed
    FROM audit_logs
    WHERE created_at >= ${twentyFourHoursAgo}
  `;

  const [leadAgg] = await sql`
    SELECT count(*)::int AS created
    FROM leads
    WHERE created_at >= ${twentyFourHoursAgo}
  `;

  const [jobAgg] = await sql`
    SELECT
      count(*) FILTER (WHERE status = 'completed') AS completed,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status = 'dead') AS dead
    FROM jobs
    WHERE updated_at >= ${twentyFourHoursAgo}
  `;

  const report = {
    period: '24h',
    messagesSent: parseInt(msgAgg?.sent || '0', 10),
    messagesFailed: parseInt(msgAgg?.failed || '0', 10),
    leadsCreated: parseInt(leadAgg?.created || '0', 10),
    jobsCompleted: parseInt(jobAgg?.completed || '0', 10),
    jobsFailed: parseInt(jobAgg?.failed || '0', 10),
    jobsDead: parseInt(jobAgg?.dead || '0', 10),
    timestamp: new Date().toISOString(),
  };

  await logEvent('cron_daily_report', 'system', 'cron', report);

  return { processed: 1, detail: `Daily report: ${JSON.stringify(report)}` };
}

/**
 * Task 4: Log Cleanup (weekly)
 *
 * Removes audit_logs older than 90 days to prevent table bloat.
 */
async function handleLogCleanup() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [result] = await sql`
    DELETE FROM audit_logs
    WHERE created_at < ${cutoff}
    RETURNING count(*)::int AS deleted
  `;

  const deleted = parseInt(result?.deleted || '0', 10);

  if (deleted > 0) {
    await logEvent('cron_log_cleanup', 'system', 'cron', {
      deletedCount: deleted,
      cutoffDate: cutoff.toISOString(),
    });
  }

  return { processed: deleted, detail: `Cleaned ${deleted} old log entries` };
}

const TASKS: Record<string, CronTask> = {
  'stuck-conversations': { name: 'stuck-conversations', handler: handleStuckConversations },
  'retry-sms': { name: 'retry-sms', handler: handleRetrySms },
  'daily-report': { name: 'daily-report', handler: handleDailyReport },
  'log-cleanup': { name: 'log-cleanup', handler: handleLogCleanup },
};

export async function POST(request: Request) {
  const provided = request.headers.get('x-cron-secret');
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return unauthorized();
  }

  let body: { task?: string } = {};
  try {
    body = (await request.json().catch(() => ({}))) as { task?: string };
    const taskName = body.task;

    if (!taskName || !TASKS[taskName]) {
      return Response.json({
        error: `Unknown task. Supported: ${Object.keys(TASKS).join(', ')}`,
      }, { status: 400 });
    }

    const task = TASKS[taskName];
    const result = await task.handler();

    await recordRun({
      task: 'cron',
      flow: taskName,
      step: 'execute',
      status: 'pass',
      passed: true,
      detail: result.detail,
    });

    return Response.json({
      task: taskName,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`POST /api/system/cron error`, error);

    await recordRun({
      task: 'cron',
      flow: body?.task || 'unknown',
      step: 'execute',
      status: 'fail',
      passed: false,
      detail: 'unknown',
    });

    return Response.json({
      error: error?.message || 'Internal Server Error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    tasks: Object.keys(TASKS),
    schedule: {
      'stuck-conversations': 'every 5 minutes',
      'retry-sms': 'hourly',
      'daily-report': 'nightly',
      'log-cleanup': 'weekly',
    },
    timestamp: new Date().toISOString(),
  });
}