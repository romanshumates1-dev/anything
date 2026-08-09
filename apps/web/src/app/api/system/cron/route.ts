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
import { checkInspectionPeriods } from '@/app/api/services/contractNotifications';

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

/**
 * Task 5: Dead-letter alert (every 15 minutes)
 *
 * Scans for jobs that exhausted all retries and notifies the owner.
 * Nothing silently dropped — Phase 0B requirement.
 */
async function handleDeadLetterAlert() {
  const { alertDeadLetters } = await import('@/app/api/utils/jobSupervisor');
  const { repairStuckCampaignContacts } = await import('@/app/api/utils/jobSupervisor');
  const orgs = await sql`
    SELECT DISTINCT organization_id FROM jobs
    WHERE status = 'dead'
      AND (payload->>'dead_alerted')::boolean IS NOT TRUE
  `.catch(() => []);
  let totalAlerted = 0;
  for (const org of orgs as any[]) {
    const count = await alertDeadLetters(org.organization_id);
    totalAlerted += count;
  }
  const repaired = await repairStuckCampaignContacts();
  return { processed: totalAlerted, detail: `Dead-letter alerts: ${totalAlerted} jobs, ${repaired} stuck contacts repaired` };
}

/**
 * Task 6: Pipeline Health Check (exponential: 1-2-4-8 hours)
 *
 * Self-healing AI provider monitoring. If primary AI is down, automatically
 * falls back to Ollama. Also checks for stuck contracts, contacts, dead jobs.
 */
async function handlePipelineHealth() {
  const {
    runPipelineHealthCheck,
    updateHealthState,
  } = await import('@/app/api/utils/pipeline-health-engine');

  const report = await runPipelineHealthCheck({ autoHeal: true });
  const criticalIssues = report.issues.filter((i) => i.severity === 'critical');
  const healthy = criticalIssues.length === 0;

  // Update state for exponential backoff
  const { consecutiveFailures, nextCheckMs } = await updateHealthState(healthy);

  const summary = [
    `AI: ${report.activeProvider} (fallback=${report.fallbackActivated})`,
    `Issues: ${report.issues.length} (${criticalIssues.length} critical)`,
    `Healed: ${report.healed.filter((h) => h.success).length}`,
    `Next check: ${Math.round(nextCheckMs / 3600000)}h`,
  ].join(', ');

  return {
    processed: report.issues.length + report.healed.length,
    detail: summary,
  };
}

/**
 * Task 7: Resurrection (daily)
 *
 * Re-touches COLD/DEAL_NO_AGREEMENT leads at 30/60/90/180 days.
 * Opted-out contacts are excluded at the query level.
 */
async function handleResurrection() {
  const { runResurrection } = await import('@/app/api/utils/resurrectionEngine');
  // Run for all orgs that have the resurrection flag on
  const orgs = await sql`
    SELECT DISTINCT organization_id FROM app_settings
    WHERE key = 'beta_flags' AND (value->>'resurrection')::boolean = true
  `.catch(() => []);
  let totalQueued = 0;
  let totalSkipped = 0;
  for (const org of orgs as any[]) {
    const result = await runResurrection(org.organization_id);
    totalQueued += result.queued;
    totalSkipped += result.skipped;
  }
  return { processed: totalQueued, detail: `Resurrection: ${totalQueued} queued, ${totalSkipped} skipped across ${(orgs as any[]).length} orgs` };
}

/**
 * Task 8: Contract Inspection Monitor (every 6 hours)
 *
 * Monitors contracts approaching inspection period expiry.
 * Sends alerts at N-7, N-4, N-2, and N-0 (critical) days.
 * Prevents silent expiry of contracts without buyer assignment.
 */
async function handleContractInspection() {
  try {
    await checkInspectionPeriods();

    // Also check for closing deadlines
    const closingContracts = await sql`
      SELECT
        c.id,
        c.property_address,
        ba.buyer_id,
        ba.assignment_fee_cents,
        b.name as buyer_name,
        c.metadata->>'closingDate' as closing_date,
        EXTRACT(DAY FROM ((c.metadata->>'closingDate')::date - CURRENT_DATE))::int as days_to_close
      FROM contracts c
      JOIN buyer_assignments ba ON ba.contract_id = c.id
      JOIN buyers b ON b.id = ba.buyer_id
      WHERE c.status = 'ASSIGNED'
        AND ba.status = 'SIGNED'
        AND c.metadata->>'closingDate' IS NOT NULL
        AND ((c.metadata->>'closingDate')::date - CURRENT_DATE) <= 3
        AND ((c.metadata->>'closingDate')::date - CURRENT_DATE) >= 0
    `.catch(() => []);

    const { scheduleClosingReminder } = await import('@/app/api/services/contractNotifications');
    for (const contract of closingContracts as any[]) {
      await scheduleClosingReminder({
        contractId: contract.id,
        closingDate: new Date(contract.closing_date),
        propertyAddress: contract.property_address || 'Unknown',
        buyerName: contract.buyer_name,
        assignmentFee: contract.assignment_fee_cents,
      });
    }

    return { processed: closingContracts.length, detail: `Checked inspection periods and ${closingContracts.length} closing contracts` };
  } catch (error: any) {
    console.error('Contract inspection error:', error);
    return { processed: 0, detail: `Error: ${error.message}` };
  }
}

/**
 * Task 9: Stalled Conversation Recovery (every 6 hours)
 *
 * Re-engages conversations that replied but went silent mid-negotiation.
 * Distinct from resurrection (30-180 day cold leads).
 * Targets 48-168 hour stalled conversations - highest conversion potential.
 */
async function handleStalledRecovery() {
  const { runStalledRecoveryAll } = await import('@/app/api/utils/stalledConversationEngine');
  const result = await runStalledRecoveryAll();
  return {
    processed: result.totalQueued,
    detail: `Stalled recovery: ${result.totalQueued} queued, ${result.totalSkipped} skipped across ${result.organizations} orgs`,
  };
}

const TASKS: Record<string, CronTask> = {
  'stuck-conversations': { name: 'stuck-conversations', handler: handleStuckConversations },
  'retry-sms': { name: 'retry-sms', handler: handleRetrySms },
  'daily-report': { name: 'daily-report', handler: handleDailyReport },
  'log-cleanup': { name: 'log-cleanup', handler: handleLogCleanup },
  'dead-letter-alert': { name: 'dead-letter-alert', handler: handleDeadLetterAlert },
  'pipeline-health': { name: 'pipeline-health', handler: handlePipelineHealth },
  'resurrection': { name: 'resurrection', handler: handleResurrection },
  'contract-inspection': { name: 'contract-inspection', handler: handleContractInspection },
  'stalled-recovery': { name: 'stalled-recovery', handler: handleStalledRecovery },
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
      'dead-letter-alert': 'every 15 minutes',
      'pipeline-health': 'exponential 1-2-4-8 hours (self-healing)',
      'resurrection': 'daily',
      'contract-inspection': 'every 6 hours (inspection period + closing alerts)',
      'stalled-recovery': 'every 6 hours (re-engage mid-negotiation cold conversations)',
    },
    timestamp: new Date().toISOString(),
  });
}