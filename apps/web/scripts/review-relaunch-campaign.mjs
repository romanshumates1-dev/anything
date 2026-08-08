#!/usr/bin/env node
/**
 * Campaign Review and Re-launch Script
 *
 * Reviews campaign errors from a specific date and re-launches 10-30 assignments.
 *
 * Usage:
 *   node apps/web/scripts/review-relaunch-campaign.mjs
 *
 * Options:
 *   --date=YYYY-MM-DD  Review campaigns from this date (default: yesterday)
 *   --limit=N          Max assignments to re-launch (default: 30)
 *   --dry-run          Show what would be done without making changes
 */

import { neon } from '@neondatabase/serverless';

// DATABASE_URL should be set via --env-file=.env or environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable required');
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name, defaultValue) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultValue;
};

const DRY_RUN = args.includes('--dry-run');
const targetDate = getArg('date', new Date(Date.now() - 86400000).toISOString().split('T')[0]);
const LIMIT = parseInt(getArg('limit', '30'), 10);

const sql = neon(DATABASE_URL);

console.log('');
console.log('═'.repeat(70));
console.log('  CAMPAIGN REVIEW AND RE-LAUNCH');
console.log('═'.repeat(70));
console.log('');
console.log(`Target Date: ${targetDate} (Saturday Aug 2)`);
console.log(`Re-launch Limit: ${LIMIT} assignments`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
console.log('');

/**
 * PHASE 1: Review Campaign Errors
 */
async function reviewErrors() {
  console.log('── PHASE 1: Reviewing Campaign Errors ──\n');

  // Check for failed jobs
  const failedJobs = await sql`
    SELECT
      id, type, error_message, attempts, max_attempts,
      created_at, updated_at
    FROM jobs
    WHERE status IN ('failed', 'dead')
      AND created_at::date = ${targetDate}::date
    ORDER BY updated_at DESC
    LIMIT 50
  `.catch(() => []);

  console.log(`Failed/Dead Jobs: ${failedJobs.length}`);
  for (const job of failedJobs.slice(0, 10)) {
    console.log(`  - Job #${job.id} (${job.type}): ${(job.error_message || 'Unknown').slice(0, 60)}`);
    console.log(`    Attempts: ${job.attempts}/${job.max_attempts}`);
  }
  if (failedJobs.length > 10) {
    console.log(`  ... and ${failedJobs.length - 10} more`);
  }
  console.log('');

  // Check for stuck campaign contacts
  const stuckContacts = await sql`
    SELECT id, status, updated_at
    FROM campaign_contacts
    WHERE status = 'SENDING'
      AND created_at::date = ${targetDate}::date
      AND updated_at < now() - interval '30 minutes'
    LIMIT 50
  `.catch(() => []);

  console.log(`Stuck Contacts (SENDING > 30min): ${stuckContacts.length}`);
  console.log('');

  // Check for email send failures
  const emailErrors = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'sent') as sent,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'bounced') as bounced,
      COUNT(*) FILTER (WHERE status = 'suppressed') as suppressed
    FROM message_events
    WHERE channel = 'email'
      AND direction = 'outbound'
      AND created_at::date = ${targetDate}::date
  `.catch(() => [{ sent: 0, failed: 0, bounced: 0, suppressed: 0 }]);

  const stats = emailErrors[0] || { sent: 0, failed: 0, bounced: 0, suppressed: 0 };
  console.log('Email Stats for Target Date:');
  console.log(`  Sent: ${stats.sent}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Bounced: ${stats.bounced}`);
  console.log(`  Suppressed: ${stats.suppressed}`);
  console.log('');

  // Check warmup config
  const warmupConfigs = await sql`
    SELECT organization_id, daily_limit, paused, paused_reason
    FROM email_warmup_config
    LIMIT 5
  `.catch(() => []);

  console.log('Email Warmup Configs:');
  for (const cfg of warmupConfigs) {
    console.log(`  Org ${cfg.organization_id}: ${cfg.daily_limit}/day, paused=${cfg.paused}`);
    if (cfg.paused_reason) console.log(`    Reason: ${cfg.paused_reason}`);
  }
  console.log('');

  return {
    failedJobs: failedJobs.length,
    stuckContacts: stuckContacts.length,
    emailStats: stats,
  };
}

/**
 * PHASE 2: Identify Re-launch Candidates
 */
async function identifyRelaunchCandidates() {
  console.log('── PHASE 2: Identifying Re-launch Candidates ──\n');

  // Find buyer assignments that need re-launching
  const candidates = await sql`
    SELECT
      ba.id,
      ba.lead_id,
      ba.buyer_id,
      ba.status,
      ba.match_score,
      ba.assignment_fee_cents,
      l.name as seller_name,
      l.email as seller_email,
      l.metadata->>'address' as property_address,
      b.name as buyer_name,
      b.email as buyer_email
    FROM buyer_assignments ba
    JOIN leads l ON l.id = ba.lead_id
    JOIN buyers b ON b.id = ba.buyer_id
    WHERE ba.status IN ('PENDING_BUYER_ACCEPT', 'CONTRACT_PENDING', 'FAILED')
      AND ba.created_at > now() - interval '7 days'
    ORDER BY ba.match_score DESC, ba.created_at DESC
    LIMIT ${LIMIT + 20}
  `.catch(() => []);

  console.log(`Found ${candidates.length} potential re-launch candidates`);
  console.log('');

  // If no buyer_assignments table exists, try campaign_lead_queue
  if (candidates.length === 0) {
    console.log('Checking campaign_lead_queue for failed sends...');

    const queueCandidates = await sql`
      SELECT
        clq.id,
        clq.lead_id,
        clq.status,
        clq.expected_value,
        clq.touch_number,
        l.name,
        l.email,
        l.metadata->>'address' as address
      FROM campaign_lead_queue clq
      JOIN leads l ON l.id = clq.lead_id
      WHERE clq.status IN ('dead', 'failed', 'queued')
        AND clq.created_at > now() - interval '7 days'
      ORDER BY clq.expected_value DESC
      LIMIT ${LIMIT + 20}
    `.catch(() => []);

    console.log(`Found ${queueCandidates.length} queue candidates`);

    for (const c of queueCandidates.slice(0, 10)) {
      console.log(`  - Lead ${c.lead_id}: ${c.name || 'Unknown'} (${c.status})`);
      console.log(`    EV: $${Math.round((c.expected_value || 0) / 100).toLocaleString()}, Touch: ${c.touch_number}`);
    }

    return queueCandidates.slice(0, LIMIT);
  }

  // Display candidates
  for (const c of candidates.slice(0, 10)) {
    console.log(`  - Assignment ${c.id}:`);
    console.log(`    Seller: ${c.seller_name} | Buyer: ${c.buyer_name}`);
    console.log(`    Property: ${c.property_address || 'Unknown'}`);
    console.log(`    Status: ${c.status} | Score: ${c.match_score}`);
    console.log(`    Fee: $${Math.round((c.assignment_fee_cents || 0) / 100).toLocaleString()}`);
    console.log('');
  }

  if (candidates.length > 10) {
    console.log(`... and ${candidates.length - 10} more candidates`);
  }

  return candidates.slice(0, LIMIT);
}

/**
 * PHASE 3: Fix Errors and Reset for Re-launch
 */
async function fixErrorsAndReset(candidates) {
  console.log('');
  console.log('── PHASE 3: Fixing Errors and Resetting ──\n');

  if (DRY_RUN) {
    console.log('[DRY RUN] Would perform the following actions:');
  }

  let fixed = 0;

  // Reset stuck contacts
  if (!DRY_RUN) {
    const resetContacts = await sql`
      UPDATE campaign_contacts
      SET status = 'QUEUED', updated_at = now()
      WHERE status = 'SENDING'
        AND updated_at < now() - interval '30 minutes'
      RETURNING id
    `.catch(() => []);

    console.log(`✅ Reset ${resetContacts.length} stuck contacts to QUEUED`);
    fixed += resetContacts.length;
  } else {
    console.log('  - Reset stuck SENDING contacts to QUEUED');
  }

  // Retry failed jobs (under max attempts)
  if (!DRY_RUN) {
    const retriedJobs = await sql`
      UPDATE jobs
      SET status = 'pending', locked_until = NULL, updated_at = now()
      WHERE status = 'failed'
        AND attempts < max_attempts
        AND created_at > now() - interval '3 days'
      RETURNING id
    `.catch(() => []);

    console.log(`✅ Retried ${retriedJobs.length} failed jobs`);
    fixed += retriedJobs.length;
  } else {
    console.log('  - Retry failed jobs with remaining attempts');
  }

  // Un-pause warmup if it was paused for recoverable reason
  if (!DRY_RUN) {
    const unpaused = await sql`
      UPDATE email_warmup_config
      SET paused = false, paused_reason = NULL, updated_at = now()
      WHERE paused = true
        AND (paused_reason IS NULL OR paused_reason NOT LIKE '%rate_limit%')
      RETURNING organization_id
    `.catch(() => []);

    console.log(`✅ Un-paused ${unpaused.length} warmup configs`);
    fixed += unpaused.length;
  } else {
    console.log('  - Un-pause warmup configs (if not rate limited)');
  }

  console.log('');
  return fixed;
}

/**
 * PHASE 4: Re-launch Assignments
 */
async function relaunchAssignments(candidates) {
  console.log('── PHASE 4: Re-launching Assignments ──\n');

  if (candidates.length === 0) {
    console.log('No candidates to re-launch.');
    return 0;
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would re-launch ${candidates.length} assignments:`);
    for (const c of candidates.slice(0, 10)) {
      if (c.buyer_name) {
        console.log(`  - ${c.seller_name} → ${c.buyer_name}`);
      } else {
        console.log(`  - Lead ${c.lead_id}: ${c.name || 'Unknown'}`);
      }
    }
    return candidates.length;
  }

  let relaunched = 0;

  // Get organization
  const [org] = await sql`SELECT id FROM organizations LIMIT 1`.catch(() => [{ id: null }]);
  if (!org?.id) {
    console.log('❌ No organization found');
    return 0;
  }

  for (const c of candidates) {
    try {
      if (c.buyer_id) {
        // Re-launch buyer assignment
        await sql`
          UPDATE buyer_assignments
          SET status = 'PENDING_BUYER_ACCEPT', updated_at = now()
          WHERE id = ${c.id}
        `;

        // Queue notification job
        await sql`
          INSERT INTO jobs (type, payload, status, max_attempts)
          VALUES (
            'send_buyer_assignment_email',
            ${JSON.stringify({
              organizationId: org.id,
              assignmentId: c.id,
              buyerId: c.buyer_id,
              leadId: c.lead_id,
            })},
            'pending',
            3
          )
        `;

        console.log(`  ✅ Re-launched: ${c.seller_name} → ${c.buyer_name}`);
      } else {
        // Re-queue for campaign send
        await sql`
          UPDATE campaign_lead_queue
          SET status = 'queued', scheduled_for = now(), updated_at = now()
          WHERE id = ${c.id}
        `;

        console.log(`  ✅ Re-queued: Lead ${c.lead_id} (${c.name || 'Unknown'})`);
      }

      relaunched++;
    } catch (error) {
      console.log(`  ❌ Failed: ${c.id} - ${error.message}`);
    }
  }

  console.log('');
  console.log(`✅ Re-launched ${relaunched}/${candidates.length} assignments`);

  return relaunched;
}

/**
 * PHASE 5: Summary Report
 */
async function generateReport(errorReview, candidates, fixed, relaunched) {
  console.log('');
  console.log('═'.repeat(70));
  console.log('  CAMPAIGN RE-LAUNCH SUMMARY');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Error Review:');
  console.log(`  Failed Jobs: ${errorReview.failedJobs}`);
  console.log(`  Stuck Contacts: ${errorReview.stuckContacts}`);
  console.log(`  Email Failures: ${errorReview.emailStats.failed + errorReview.emailStats.bounced}`);
  console.log('');
  console.log('Actions Taken:');
  console.log(`  Errors Fixed: ${fixed}`);
  console.log(`  Assignments Re-launched: ${relaunched}`);
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Monitor campaign_lead_queue for status changes');
  console.log('  2. Check email_daily_sends for send counts');
  console.log('  3. Run POST /api/campaigns/orchestrator/execute-sends');
  console.log('  4. Watch for replies in message_events');
  console.log('');

  if (DRY_RUN) {
    console.log('⚠️  This was a DRY RUN - no actual changes were made.');
    console.log('    Run without --dry-run to apply changes.');
  }

  console.log('');
}

/**
 * Main execution
 */
async function main() {
  try {
    const errorReview = await reviewErrors();
    const candidates = await identifyRelaunchCandidates();
    const fixed = await fixErrorsAndReset(candidates);
    const relaunched = await relaunchAssignments(candidates);
    await generateReport(errorReview, candidates, fixed, relaunched);
  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
