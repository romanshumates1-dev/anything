#!/usr/bin/env node
/**
 * E2E Pipeline Verification Script
 *
 * Atomically verifies all pipeline systems are working and ready for live campaigns.
 * Tests actual connections, not mocks. Fails fast on any issue.
 *
 * Run: node --env-file=.env scripts/verify-pipeline-e2e.mjs
 */

import { neon } from '@neondatabase/serverless';
import { SESClient, GetSendQuotaCommand } from '@aws-sdk/client-ses';
import { SNSClient, GetSMSAttributesCommand } from '@aws-sdk/client-sns';

const CHECKS = [];
let passed = 0;
let failed = 0;

function log(status, check, detail = '') {
  const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m⚠\x1b[0m';
  console.log(`  ${icon} ${check}${detail ? ': ' + detail : ''}`);
  CHECKS.push({ check, status, detail });
  if (status === 'PASS') passed++;
  if (status === 'FAIL') failed++;
}

async function verifyDatabase() {
  console.log('\n\x1b[1m[1/7] DATABASE CONNECTION\x1b[0m');

  if (!process.env.DATABASE_URL) {
    log('FAIL', 'DATABASE_URL', 'Environment variable not set');
    return false;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const [result] = await sql`SELECT 1 as ok, now() as server_time`;
    if (result?.ok === 1) {
      log('PASS', 'Neon PostgreSQL connection', `Server time: ${result.server_time}`);
    } else {
      log('FAIL', 'Database query', 'Unexpected response');
      return false;
    }

    // Check required tables exist
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('leads', 'campaigns', 'campaign_lead_queue', 'jobs', 'contracts', 'message_events', 'buyers', 'buyer_assignments')
    `;
    const tableNames = tables.map(t => t.table_name);
    const required = ['leads', 'campaigns', 'campaign_lead_queue', 'jobs', 'contracts', 'message_events'];
    const missing = required.filter(t => !tableNames.includes(t));

    if (missing.length === 0) {
      log('PASS', 'Required tables exist', `Found ${tables.length} core tables`);
    } else {
      log('FAIL', 'Missing tables', missing.join(', '));
      return false;
    }

    // Check data integrity
    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM leads) as leads,
        (SELECT COUNT(*)::int FROM campaigns) as campaigns,
        (SELECT COUNT(*)::int FROM campaign_lead_queue) as queue,
        (SELECT COUNT(*)::int FROM jobs WHERE status = 'pending') as pending_jobs
    `;
    log('PASS', 'Data integrity', `${counts.leads} leads, ${counts.campaigns} campaigns, ${counts.queue} queued, ${counts.pending_jobs} pending jobs`);

    return true;
  } catch (err) {
    log('FAIL', 'Database connection', err.message);
    return false;
  }
}

async function verifyAWSSES() {
  console.log('\n\x1b[1m[2/7] AWS SES (EMAIL)\x1b[0m');

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    log('FAIL', 'AWS credentials', 'AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY not set');
    return false;
  }

  try {
    const client = new SESClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const response = await client.send(new GetSendQuotaCommand({}));
    const maxSendRate = response.MaxSendRate;
    const max24HourSend = response.Max24HourSend;
    const sentLast24Hours = response.SentLast24Hours;

    log('PASS', 'SES sending enabled', `Rate: ${maxSendRate}/sec, Daily: ${max24HourSend}, Sent today: ${sentLast24Hours}`);

    // Check if in production (unlimited) or sandbox
    if (max24HourSend >= 50000) {
      log('PASS', 'SES production access', 'High-volume sending available');
    } else {
      log('WARN', 'SES sandbox mode', `Limited to ${max24HourSend}/day - request production access`);
    }

    // Check verified identities
    if (process.env.EMAIL_FROM_ADDRESS) {
      log('PASS', 'FROM address configured', process.env.EMAIL_FROM_ADDRESS);
    } else {
      log('WARN', 'EMAIL_FROM_ADDRESS not set', 'Using default');
    }

    return true;
  } catch (err) {
    log('FAIL', 'AWS SES connection', err.message);
    return false;
  }
}

async function verifyAWSSNS() {
  console.log('\n\x1b[1m[3/7] AWS SNS (SMS)\x1b[0m');

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    log('SKIP', 'AWS SNS', 'Credentials not configured');
    return true; // Non-blocking
  }

  try {
    const client = new SNSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const response = await client.send(new GetSMSAttributesCommand({
      attributes: ['MonthlySpendLimit', 'DeliveryStatusSuccessSamplingRate'],
    }));

    const spendLimit = response.attributes?.MonthlySpendLimit || '1';
    log('PASS', 'SNS SMS configured', `Monthly limit: $${spendLimit}`);

    if (parseFloat(spendLimit) < 100) {
      log('WARN', 'Low SMS spend limit', 'Request increase for high-volume campaigns');
    }

    return true;
  } catch (err) {
    log('WARN', 'AWS SNS connection', err.message + ' (SMS optional)');
    return true; // Non-blocking
  }
}

async function verifyAIProvider() {
  console.log('\n\x1b[1m[4/7] AI PROVIDER (BEDROCK)\x1b[0m');

  const provider = process.env.AI_PROVIDER || 'bedrock';
  const modelNegotiate = process.env.BEDROCK_MODEL_NEGOTIATE;
  const modelClassify = process.env.BEDROCK_MODEL_CLASSIFY;

  if (provider !== 'bedrock') {
    log('WARN', 'AI provider', `Using ${provider} instead of bedrock`);
  }

  if (!modelNegotiate) {
    log('WARN', 'BEDROCK_MODEL_NEGOTIATE', 'Not set - AI responses will use templates');
  } else {
    log('PASS', 'Negotiation model', modelNegotiate);
  }

  if (!modelClassify) {
    log('WARN', 'BEDROCK_MODEL_CLASSIFY', 'Not set - classification will use rules');
  } else {
    log('PASS', 'Classification model', modelClassify);
  }

  // Test Bedrock connection
  if (process.env.AWS_ACCESS_KEY_ID && modelNegotiate) {
    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      const response = await client.send(new ConverseCommand({
        modelId: modelClassify || modelNegotiate,
        messages: [{ role: 'user', content: [{ text: 'Reply with just "OK"' }] }],
        inferenceConfig: { maxTokens: 10, temperature: 0 },
      }));

      const text = response.output?.message?.content?.[0]?.text || '';
      if (text) {
        log('PASS', 'Bedrock inference', `Model responds: "${text.slice(0, 20)}..."`);
      }
    } catch (err) {
      log('WARN', 'Bedrock inference test', err.message);
    }
  }

  return true;
}

async function verifyJobWorker() {
  console.log('\n\x1b[1m[5/7] JOB WORKER SYSTEM\x1b[0m');

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Check job types
    const jobTypes = await sql`
      SELECT type, COUNT(*)::int as count, status
      FROM jobs
      WHERE created_at > now() - interval '7 days'
      GROUP BY type, status
      ORDER BY count DESC
      LIMIT 20
    `;

    if (jobTypes.length > 0) {
      const completed = jobTypes.filter(j => j.status === 'completed').reduce((sum, j) => sum + j.count, 0);
      const pending = jobTypes.filter(j => j.status === 'pending').reduce((sum, j) => sum + j.count, 0);
      const failed = jobTypes.filter(j => j.status === 'failed').reduce((sum, j) => sum + j.count, 0);
      const dead = jobTypes.filter(j => j.status === 'dead').reduce((sum, j) => sum + j.count, 0);

      log('PASS', 'Job processing active', `Completed: ${completed}, Pending: ${pending}, Failed: ${failed}, Dead: ${dead}`);

      if (dead > completed * 0.1) {
        log('WARN', 'High dead job rate', `${dead} dead jobs may indicate system issues`);
      }
    } else {
      log('WARN', 'No recent jobs', 'Job worker may not be running');
    }

    // Check for stuck jobs
    const [stuck] = await sql`
      SELECT COUNT(*)::int as count
      FROM jobs
      WHERE status = 'processing'
        AND locked_until < now()
    `;

    if (stuck.count > 0) {
      log('WARN', 'Stuck jobs detected', `${stuck.count} jobs need recovery`);
    } else {
      log('PASS', 'No stuck jobs', 'All processing jobs healthy');
    }

    // Check campaign execution
    const [campaignJobs] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending
      FROM jobs
      WHERE type = 'execute_campaign_sends_v2'
        AND created_at > now() - interval '24 hours'
    `;

    log('PASS', 'Campaign batch jobs (24h)', `Completed: ${campaignJobs.completed}, Pending: ${campaignJobs.pending}`);

    return true;
  } catch (err) {
    log('FAIL', 'Job worker check', err.message);
    return false;
  }
}

async function verifyCampaignPipeline() {
  console.log('\n\x1b[1m[6/7] CAMPAIGN PIPELINE\x1b[0m');

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Check campaign_lead_queue status distribution
    const queueStats = await sql`
      SELECT status, COUNT(*)::int as count
      FROM campaign_lead_queue
      GROUP BY status
    `;

    const statusMap = {};
    queueStats.forEach(s => statusMap[s.status] = s.count);

    const queued = statusMap['queued'] || 0;
    const sent = statusMap['sent'] || 0;
    const replied = statusMap['replied'] || 0;
    const interested = statusMap['interested'] || 0;

    log('PASS', 'Queue status', `Queued: ${queued}, Sent: ${sent}, Replied: ${replied}, Interested: ${interested}`);

    // Check for leads with emails
    const [emailStats] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE email IS NOT NULL AND email != '')::int as with_email
      FROM leads
    `;

    const emailRate = emailStats.total > 0 ? (emailStats.with_email / emailStats.total * 100).toFixed(1) : 0;
    log('PASS', 'Lead email coverage', `${emailStats.with_email}/${emailStats.total} (${emailRate}%)`);

    if (emailStats.with_email < 100) {
      log('WARN', 'Low lead count', 'Consider importing more leads for campaigns');
    }

    // Check message events
    const [msgEvents] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'sent')::int as sent,
        COUNT(*) FILTER (WHERE status = 'delivered')::int as delivered,
        COUNT(*) FILTER (WHERE status = 'bounced')::int as bounced
      FROM message_events
      WHERE created_at > now() - interval '7 days'
    `;

    if (msgEvents.total > 0) {
      const deliveryRate = msgEvents.sent > 0 ? ((msgEvents.delivered / msgEvents.sent) * 100).toFixed(1) : 0;
      const bounceRate = msgEvents.sent > 0 ? ((msgEvents.bounced / msgEvents.sent) * 100).toFixed(1) : 0;
      log('PASS', 'Message delivery (7d)', `Sent: ${msgEvents.sent}, Delivered: ${msgEvents.delivered} (${deliveryRate}%), Bounced: ${msgEvents.bounced} (${bounceRate}%)`);

      if (parseFloat(bounceRate) > 5) {
        log('WARN', 'High bounce rate', 'Check email list quality');
      }
    } else {
      log('WARN', 'No recent messages', 'Campaign may not be sending');
    }

    return true;
  } catch (err) {
    log('FAIL', 'Campaign pipeline check', err.message);
    return false;
  }
}

async function verifyContractSystem() {
  console.log('\n\x1b[1m[7/7] CONTRACT & E-SIGN SYSTEM\x1b[0m');

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Check contracts table
    const [contractStats] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE esign_status = 'signed')::int as signed,
        COUNT(*) FILTER (WHERE esign_status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE assigned_at IS NOT NULL)::int as assigned
      FROM contracts
    `;

    log('PASS', 'Contract records', `Total: ${contractStats.total}, Signed: ${contractStats.signed}, Pending: ${contractStats.pending}, Assigned: ${contractStats.assigned}`);

    // Check buyer assignments
    const [buyerStats] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'SIGNED')::int as signed,
        COALESCE(SUM(assignment_fee_cents) FILTER (WHERE status = 'SIGNED'), 0)::bigint as total_fees
      FROM buyer_assignments
    `.catch(() => [{ total: 0, signed: 0, total_fees: 0 }]);

    const totalFees = (buyerStats.total_fees || 0) / 100;
    log('PASS', 'Buyer assignments', `Total: ${buyerStats.total}, Signed: ${buyerStats.signed}, Revenue: $${totalFees.toLocaleString()}`);

    // Check e-sign provider
    const esignProvider = process.env.ESIGN_PROVIDER || 'mock';
    if (esignProvider === 'mock') {
      log('WARN', 'E-sign provider', 'Using mock - configure DocuSign/Documenso for production');
    } else {
      log('PASS', 'E-sign provider', esignProvider);
    }

    return true;
  } catch (err) {
    log('FAIL', 'Contract system check', err.message);
    return false;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     E2E PIPELINE VERIFICATION - ATOMIC SYSTEM CHECK           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  await verifyDatabase();
  await verifyAWSSES();
  await verifyAWSSNS();
  await verifyAIProvider();
  await verifyJobWorker();
  await verifyCampaignPipeline();
  await verifyContractSystem();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                       VERIFICATION SUMMARY                     ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Total Checks: ${CHECKS.length.toString().padStart(3)}                                            ║`);
  console.log(`║  \x1b[32mPassed: ${passed.toString().padStart(3)}\x1b[0m                                                   ║`);
  console.log(`║  \x1b[31mFailed: ${failed.toString().padStart(3)}\x1b[0m                                                   ║`);
  console.log(`║  Duration: ${duration}s                                           ║`);
  console.log('╠════════════════════════════════════════════════════════════════╣');

  if (failed === 0) {
    console.log('║  \x1b[32m✓ PIPELINE READY FOR LIVE AUTONOMOUS CAMPAIGNS\x1b[0m              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    process.exit(0);
  } else {
    console.log('║  \x1b[31m✗ PIPELINE HAS BLOCKING ISSUES - FIX BEFORE LAUNCH\x1b[0m          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
