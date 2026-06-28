import sql from '@/app/api/utils/sql';
import { sendMessage } from './messaging';

export async function enqueueJob(
  type: string,
  payload: any,
  options: { runAt?: Date; maxAttempts?: number; dedupeKey?: string | null } = {}
) {
  const { runAt = new Date(), maxAttempts = 3, dedupeKey = null } = options;

  // Idempotent enqueue: when a dedupeKey is supplied, a duplicate (same key)
  // is silently skipped via the partial unique index uniq_jobs_dedupe_key.
  if (dedupeKey) {
    const rows = await sql`
      INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
      VALUES (${type}, ${JSON.stringify(payload)}, ${runAt}, ${maxAttempts}, ${dedupeKey})
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  }

  const [job] = await sql`
    INSERT INTO jobs (type, payload, run_at, max_attempts)
    VALUES (${type}, ${JSON.stringify(payload)}, ${runAt}, ${maxAttempts})
    RETURNING id
  `;

  return job.id;
}

export async function processNextJob() {
  const now = new Date();

  // Select and lock a pending job
  const [job] = await sql`
    UPDATE jobs
    SET status = 'processing', 
        locked_until = ${new Date(Date.now() + 5 * 60 * 1000)}, -- lock for 5 mins
        attempts = attempts + 1,
        updated_at = ${now}
    WHERE id = (
      SELECT id 
      FROM jobs 
      WHERE status IN ('pending', 'failed')
      AND attempts < max_attempts
      AND run_at <= ${now}
      AND (locked_until IS NULL OR locked_until <= ${now})
      ORDER BY run_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  if (!job) return null;

  try {
    // Dispatch based on job type. Every handler must produce an observable
    // side effect; a job can only be marked completed after its handler runs.
    switch (job.type) {
      case 'send_message':
        await sendMessage(job.payload);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await sql`
      UPDATE jobs 
      SET status = 'completed', updated_at = ${new Date()} 
      WHERE id = ${job.id}
    `;
    return { success: true, jobId: job.id, type: job.type };
  } catch (error: any) {
    // Move to dead-letter once we've exhausted all attempts, otherwise allow retry.
    const isDead = job.attempts >= job.max_attempts;
    await sql`
      UPDATE jobs 
      SET status = ${isDead ? 'dead' : 'failed'}, 
          error_message = ${error.message},
          updated_at = ${new Date()},
          locked_until = NULL
      WHERE id = ${job.id}
    `;
    throw error;
  }
}

/**
 * Drain up to `limit` pending jobs. Stops early when the queue is empty.
 * Returns the number of jobs that were processed.
 */
export async function drainJobs(limit = 25) {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    let result;
    try {
      result = await processNextJob();
    } catch {
      // processNextJob already recorded the failure/dead-letter transition in
      // the DB before re-throwing. Count it as handled and keep draining so one
      // bad job can't block the rest of the queue.
      processed++;
      continue;
    }
    if (!result) break;
    processed++;
  }
  return processed;
}
