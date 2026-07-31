/**
 * jobSupervisor — auto-restart on crash with restart-loop guard.
 *
 * Phase 0B requirement: the job runner must auto-restart on crash, with a
 * max-restart-loop guard (5 restarts/10min → stop + alert, never a silent
 * infinite crash loop). Dead-letter + owner alert for anything that exhausts
 * retries — nothing silently dropped.
 *
 * DESIGN: this module is imported by the jobs:dev script and by the cron
 * health-check endpoint. It does NOT spawn child processes — the Next.js
 * runtime is single-process. Instead it:
 *   1. Tracks restart timestamps in-process (reset on clean boot)
 *   2. Exposes a `runWithSupervision` wrapper that catches crashes, checks the
 *      loop guard, and re-invokes the handler or halts + alerts
 *   3. Exposes `alertDeadLetters` which the cron calls to notify the owner
 *      when jobs reach `dead` status (exhausted all retries)
 *
 * The restart-loop guard is: if ≥5 restarts occur within a 10-minute window,
 * stop restarting and write a SUPERVISOR_HALTED alert to the audit log so the
 * owner sees it in the system dashboard.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

const RESTART_WINDOW_MS = 10 * 60_000; // 10 minutes
const MAX_RESTARTS_IN_WINDOW = 5;

const restartTimestamps: number[] = [];
let supervisorHalted = false;

export function isSupervisorHalted(): boolean {
  return supervisorHalted;
}

export function resetSupervisor(): void {
  restartTimestamps.length = 0;
  supervisorHalted = false;
}

/**
 * Record a restart and check whether the loop guard trips.
 * Returns true if the supervisor should halt (loop detected).
 */
export function recordRestart(): boolean {
  const now = Date.now();
  // Evict timestamps outside the window
  while (restartTimestamps.length > 0 && now - restartTimestamps[0] > RESTART_WINDOW_MS) {
    restartTimestamps.shift();
  }
  restartTimestamps.push(now);
  if (restartTimestamps.length >= MAX_RESTARTS_IN_WINDOW) {
    supervisorHalted = true;
    return true;
  }
  return false;
}

/**
 * Wrap a job-drain iteration with supervision.
 * On crash: record restart, check loop guard, re-invoke or halt+alert.
 *
 * `handler` is the function that drains one batch of jobs (e.g. drainJobs).
 * `onHalt` is called when the loop guard trips — use it to send an owner alert.
 */
export async function runWithSupervision(
  handler: () => Promise<unknown>,
  onHalt?: (reason: string) => Promise<void>
): Promise<{ ran: boolean; halted: boolean; reason?: string }> {
  if (supervisorHalted) {
    return { ran: false, halted: true, reason: 'supervisor_halted' };
  }
  try {
    await handler();
    return { ran: true, halted: false };
  } catch (err: any) {
    const loopDetected = recordRestart();
    const reason = err?.message ?? String(err);
    if (loopDetected) {
      const msg = `SUPERVISOR HALTED: ${MAX_RESTARTS_IN_WINDOW} restarts in ${RESTART_WINDOW_MS / 60_000}min. Last error: ${reason}`;
      console.error('[supervisor]', msg);
      try {
        await logEvent('supervisor_halted', 'system', 'job_runner', {
          restarts: restartTimestamps.length,
          windowMs: RESTART_WINDOW_MS,
          lastError: reason,
        });
      } catch { /* log failure must not prevent halt */ }
      if (onHalt) await onHalt(msg).catch(() => {});
      return { ran: false, halted: true, reason: msg };
    }
    console.error(`[supervisor] crash (restart ${restartTimestamps.length}/${MAX_RESTARTS_IN_WINDOW}):`, reason);
    return { ran: false, halted: false, reason };
  }
}

/**
 * Scan for dead-lettered jobs and alert the owner via the owner-notification
 * job type. Called by the cron task so nothing is silently dropped.
 *
 * Returns the count of dead jobs found this run.
 */
export async function alertDeadLetters(organizationId: string): Promise<number> {
  const rows = await sql`
    SELECT id, type, error_message, updated_at
    FROM jobs
    WHERE status = 'dead'
      AND (payload->>'organizationId' = ${organizationId} OR payload->>'organization_id' = ${organizationId})
      AND (payload->>'dead_alerted')::boolean IS NOT TRUE
    ORDER BY updated_at DESC
    LIMIT 20
  `;
  if (rows.length === 0) return 0;

  const ids = (rows as any[]).map((r) => r.id);
  const summary = (rows as any[])
    .map((r) => `job#${r.id} (${r.type}): ${(r.error_message ?? '').slice(0, 80)}`)
    .join('\n');

  // Mark as alerted so we don't re-notify on the next cron tick
  await sql`
    UPDATE jobs
    SET payload = payload || '{"dead_alerted":true}'::jsonb
    WHERE id = ANY(${ids})
  `;

  // Enqueue an owner notification (reuses the existing send_owner_notification job type)
  const { enqueueJob } = await import('@/app/api/utils/jobs');
  await enqueueJob('send_owner_notification', {
    organizationId,
    message: `⚠️ DealFlow: ${rows.length} job(s) dead-lettered (exhausted retries):\n${summary}`,
  });

  await logEvent('dead_letter_alert', 'system', organizationId, { count: rows.length, ids });
  return rows.length;
}

/**
 * Checkpoint: verify that a campaign's contacts have consistent state.
 * A crash mid-campaign must never leave contacts stuck in 'processing' with
 * no corresponding job. This is called by the stuck-conversations cron task.
 *
 * Returns the number of contacts whose state was repaired.
 */
export async function repairStuckCampaignContacts(): Promise<number> {
  // Contacts marked SENDING with no active job for >10 minutes are stuck.
  const result = await sql`
    UPDATE campaign_contacts
    SET status = 'QUEUED', updated_at = now()
    WHERE status = 'SENDING'
      AND updated_at < now() - interval '10 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM jobs
        WHERE status IN ('pending', 'processing')
          AND payload->>'contactId' = campaign_contacts.id::text
      )
    RETURNING id
  `;
  return (result as any[]).length;
}
