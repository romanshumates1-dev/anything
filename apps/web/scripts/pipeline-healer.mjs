#!/usr/bin/env node
/**
 * Pipeline Self-Healing System
 *
 * DETERMINISTIC healing - no LLM involved, just rule-based fixes.
 * Each issue type has a specific, tested fix.
 *
 * Run: node --env-file=.env scripts/pipeline-healer.mjs
 *
 * Valid campaign_lead_queue statuses: queued, sent, replied, interested, rejected, dead
 * Valid job statuses: pending, processing, completed, failed, dead
 */
import { neon } from '@neondatabase/serverless';

const HEAL_INTERVAL = 60000; // 1 minute between heal cycles

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Track healing stats
const stats = {
  cyclesRun: 0,
  issuesFound: 0,
  issuesFixed: 0,
  startedAt: new Date(),
};

/**
 * HEALING RULES - Deterministic fixes for known issues
 */
const HEALING_RULES = {
  // Rule 1: Reset stuck processing jobs
  async stuckProcessingJobs() {
    const stuck = await sql`
      UPDATE jobs
      SET status = 'pending', locked_until = NULL, updated_at = now()
      WHERE status = 'processing'
        AND locked_until < now() - interval '5 minutes'
      RETURNING id, type
    `;
    if (stuck.length > 0) {
      console.log(`  [FIX] Reset ${stuck.length} stuck processing jobs`);
      return stuck.length;
    }
    return 0;
  },

  // Rule 2: Retry failed jobs that haven't exceeded max attempts
  async retryFailedJobs() {
    const retried = await sql`
      UPDATE jobs
      SET status = 'pending', locked_until = NULL, updated_at = now()
      WHERE status = 'failed'
        AND attempts < max_attempts
        AND updated_at < now() - interval '1 minute'
      RETURNING id, type
    `;
    if (retried.length > 0) {
      console.log(`  [FIX] Retried ${retried.length} failed jobs`);
      return retried.length;
    }
    return 0;
  },

  // Rule 3: Kill deprecated job types and clear their errors
  async killDeprecatedJobs() {
    // Permanently kill all execute_campaign_sends (not v2) - they have the wrong logic
    const killed = await sql`
      UPDATE jobs
      SET status = 'dead',
          error_message = NULL,
          updated_at = now()
      WHERE type = 'execute_campaign_sends'
        AND status != 'dead'
      RETURNING id
    `.catch(() => []);

    if (killed.length > 0) {
      console.log(`  [FIX] Killed ${killed.length} deprecated execute_campaign_sends jobs`);
      return killed.length;
    }
    return 0;
  },

  // Rule 4: Reset queue items stuck in invalid states
  async fixInvalidQueueStatus() {
    // The only valid statuses are: queued, sent, replied, interested, rejected, dead
    // If somehow an invalid status got in, reset to queued
    const fixed = await sql`
      UPDATE campaign_lead_queue
      SET status = 'queued', updated_at = now()
      WHERE status NOT IN ('queued', 'sent', 'replied', 'interested', 'rejected', 'dead')
      RETURNING id
    `.catch(() => []);

    if (fixed.length > 0) {
      console.log(`  [FIX] Reset ${fixed.length} queue items with invalid status`);
      return fixed.length;
    }
    return 0;
  },

  // Rule 5: Requeue stuck 'sent' items that never got a response
  async requeueStuckSent() {
    // Items marked 'sent' over 24h ago with no reply should be re-queued for follow-up
    const stuckSent = await sql`
      UPDATE campaign_lead_queue
      SET status = 'queued',
          touch_number = LEAST(touch_number + 1, 3),
          scheduled_for = now(),
          updated_at = now()
      WHERE status = 'sent'
        AND last_sent_at < now() - interval '24 hours'
        AND touch_number < 3
      RETURNING id
    `.catch(() => []);

    if (stuckSent.length > 0) {
      console.log(`  [FIX] Re-queued ${stuckSent.length} stuck sent items for follow-up`);
      return stuckSent.length;
    }
    return 0;
  },

  // Rule 6: Un-pause warmup if paused for transient reasons
  async unpauseWarmup() {
    const unpaused = await sql`
      UPDATE email_warmup_config
      SET paused = false, paused_reason = NULL, updated_at = now()
      WHERE paused = true
        AND paused_reason NOT LIKE '%rate_limit%'
        AND paused_reason NOT LIKE '%manual%'
        AND updated_at < now() - interval '1 hour'
      RETURNING organization_id
    `.catch(() => []);

    if (unpaused.length > 0) {
      console.log(`  [FIX] Un-paused ${unpaused.length} warmup configs`);
      return unpaused.length;
    }
    return 0;
  },

  // Rule 7: Clean up dead jobs older than 7 days
  async cleanupOldDeadJobs() {
    const deleted = await sql`
      DELETE FROM jobs
      WHERE status = 'dead'
        AND updated_at < now() - interval '7 days'
      RETURNING id
    `.catch(() => []);

    if (deleted.length > 0) {
      console.log(`  [CLEANUP] Removed ${deleted.length} old dead jobs`);
      return deleted.length;
    }
    return 0;
  },

  // Rule 8: Ensure there's always a campaign send job if queue has items
  async ensureSendJobExists() {
    // Check if there are queued items but no pending send job
    const [queueCount] = await sql`
      SELECT COUNT(*) as count FROM campaign_lead_queue WHERE status = 'queued'
    `;

    const [sendJobCount] = await sql`
      SELECT COUNT(*) as count FROM jobs
      WHERE type = 'execute_campaign_sends_v2'
        AND status = 'pending'
    `;

    if (parseInt(queueCount.count) > 0 && parseInt(sendJobCount.count) === 0) {
      await sql`
        INSERT INTO jobs (type, payload, status, max_attempts)
        VALUES ('execute_campaign_sends_v2', '{"batchSize": 50}', 'pending', 5)
      `;
      console.log(`  [FIX] Created send job for ${queueCount.count} queued items`);
      return 1;
    }
    return 0;
  },

  // Rule 9: Schedule next health check
  async scheduleHealthCheck() {
    const [existing] = await sql`
      SELECT id FROM jobs
      WHERE type = 'pipeline_health_check' AND status = 'pending'
      LIMIT 1
    `.catch(() => []);

    if (!existing) {
      await sql`
        INSERT INTO jobs (type, payload, status, max_attempts)
        VALUES ('pipeline_health_check', '{"source": "self-healer"}', 'pending', 999)
      `;
      console.log(`  [FIX] Scheduled next health check job`);
      return 1;
    }
    return 0;
  },
};

/**
 * Run all healing rules
 */
async function runHealingCycle() {
  stats.cyclesRun++;
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n[${timestamp}] Starting healing cycle #${stats.cyclesRun}`);

  let totalFixed = 0;

  for (const [ruleName, ruleFn] of Object.entries(HEALING_RULES)) {
    try {
      const fixed = await ruleFn();
      totalFixed += fixed;
    } catch (error) {
      console.error(`  [ERROR] Rule ${ruleName} failed:`, error.message);
    }
  }

  if (totalFixed > 0) {
    stats.issuesFixed += totalFixed;
    console.log(`  [DONE] Fixed ${totalFixed} issues this cycle`);
  } else {
    console.log(`  [OK] No issues found`);
  }

  return totalFixed;
}

/**
 * Get current pipeline status
 */
async function getPipelineStatus() {
  const [jobs] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'processing') as processing,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'dead') as dead
    FROM jobs
  `;

  const [queue] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'queued') as queued,
      COUNT(*) FILTER (WHERE status = 'sent') as sent,
      COUNT(*) FILTER (WHERE status = 'replied') as replied,
      COUNT(*) FILTER (WHERE status = 'interested') as interested
    FROM campaign_lead_queue
  `;

  const [warmup] = await sql`
    SELECT daily_limit, paused, paused_reason FROM email_warmup_config LIMIT 1
  `.catch(() => [{}]);

  return { jobs, queue, warmup };
}

/**
 * Main loop
 */
async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  PIPELINE SELF-HEALING SYSTEM                              ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  Deterministic rule-based healing (no LLM)                 ║');
  console.log('║  Checking every 60 seconds                                 ║');
  console.log('║  Press Ctrl+C to stop                                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // Initial status
  const status = await getPipelineStatus();
  console.log('Current Status:');
  console.log('  Jobs:', status.jobs);
  console.log('  Queue:', status.queue);
  console.log('  Warmup:', status.warmup?.paused ? 'PAUSED' : 'ACTIVE', '-', status.warmup?.daily_limit || 0, '/day');

  // Run initial healing cycle
  await runHealingCycle();

  // Schedule periodic healing
  const interval = setInterval(async () => {
    try {
      await runHealingCycle();
    } catch (error) {
      console.error('[FATAL] Healing cycle error:', error.message);
    }
  }, HEAL_INTERVAL);

  // Handle shutdown
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('SELF-HEALING SYSTEM STOPPED');
    console.log('═'.repeat(60));
    console.log(`Runtime: ${Math.round((Date.now() - stats.startedAt) / 60000)} minutes`);
    console.log(`Cycles run: ${stats.cyclesRun}`);
    console.log(`Issues fixed: ${stats.issuesFixed}`);
    console.log('');
    process.exit(0);
  });
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
