#!/usr/bin/env node
/**
 * production-warmup.mjs
 * PRODUCTION WARMUP - Safe scaling for deliverability
 *
 * Follows warmup schedule to build sender reputation safely
 */

import nodemailer from 'nodemailer';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
  max: 10
});

// Warmup configuration
const WARMUP_CONFIG = {
  // Safe daily limits by warmup day
  dailyLimits: {
    1: 50, 2: 50, 3: 50,           // Days 1-3: 50/day
    4: 100, 5: 100, 6: 100, 7: 100, // Days 4-7: 100/day
    8: 200, 9: 200, 10: 200, 11: 200, 12: 200, 13: 200, 14: 200, // Days 8-14: 200/day
    default: 400                    // Day 15+: 400/day max
  },
  // Delay between emails (ms)
  sendDelay: 3000, // 3 seconds = 20/minute = safe for Gmail
  // Batch size before pause
  batchSize: 10,
  batchPause: 30000 // 30 second pause between batches
};

const TEST_EMAIL = process.env.TEST_EMAIL || 'romanshumates1@gmail.com';

console.log('🚀 PRODUCTION WARMUP');
console.log('='.repeat(70));
console.log('');

async function getWarmupDay() {
  const client = await pool.connect();
  try {
    // Check when first production email was sent
    const { rows } = await client.query(`
      SELECT MIN(created_at) as first_send
      FROM leads
      WHERE metadata->>'source' LIKE 'production-%'
    `);

    if (!rows[0]?.first_send) {
      return 1; // First day of warmup
    }

    const firstSend = new Date(rows[0].first_send);
    const now = new Date();
    const daysDiff = Math.floor((now - firstSend) / (1000 * 60 * 60 * 24)) + 1;
    return Math.min(daysDiff, 15);
  } finally {
    client.release();
  }
}

async function getTodaySendCount() {
  const client = await pool.connect();
  try {
    const { rows: [result] } = await client.query(`
      SELECT COUNT(*) as count
      FROM leads
      WHERE metadata->>'source' LIKE 'production-%'
      AND created_at > CURRENT_DATE
    `);
    return parseInt(result.count) || 0;
  } finally {
    client.release();
  }
}

async function setupSMTP() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('SMTP credentials missing');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass }
  });
}

async function createProductionLead(client, orgId, index, batchId) {
  const uniqueEmail = TEST_EMAIL.replace('@', `+prod${batchId}-${index}@`);

  const { rows: [inserted] } = await client.query(`
    INSERT INTO leads (organization_id, name, email, phone, metadata, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (organization_id, email) DO UPDATE SET
      name = EXCLUDED.name,
      metadata = EXCLUDED.metadata
    RETURNING id
  `, [
    orgId,
    `Property Owner ${index}`,
    uniqueEmail,
    `+1502555${String(index).padStart(4, '0')}`,
    JSON.stringify({
      address: `${1000 + index} Market St, Louisville, KY 40${200 + (index % 100)}`,
      source: `production-${batchId}`,
      warmup: true
    })
  ]);

  const arv = 180000 + (index * 500);
  const offerMin = Math.round(arv * 0.62);
  const offerMax = Math.round(arv * 0.68);

  await client.query(`
    INSERT INTO property_valuations (lead_id, arv, offer_min, offer_max, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (lead_id) DO UPDATE SET arv = $2, offer_min = $3, offer_max = $4
  `, [inserted.id, arv, offerMin, offerMax]);

  return {
    id: inserted.id,
    name: `Property Owner ${index}`,
    email: uniqueEmail,
    address: `${1000 + index} Market St, Louisville, KY 40${200 + (index % 100)}`,
    offer_min: offerMin,
    offer_max: offerMax
  };
}

async function sendEmail(transporter, lead, batchId) {
  const offerRange = `$${Math.round(lead.offer_min / 1000)}k–$${Math.round(lead.offer_max / 1000)}k`;

  const html = `
<p>Hi ${lead.name},</p>

<p>I noticed your property at <strong>${lead.address}</strong> and wanted to reach out.</p>

<p>We're actively buying properties in your area and can make a <strong>cash offer of ${offerRange}</strong>.</p>

<p>What makes us different:</p>
<ul>
  <li>Close in 7 days</li>
  <li>All cash, no financing contingencies</li>
  <li>Buy as-is, no repairs needed</li>
  <li>We cover closing costs</li>
</ul>

<p>Would you be open to a quick conversation about selling?</p>

<p>Best regards,<br>
The DealFlow Team</p>

<hr>
<p style="font-size: 11px; color: #666;">
123 Main St, Louisville, KY 40202<br>
To unsubscribe, reply with STOP
</p>
`;

  const result = await transporter.sendMail({
    from: `"DealFlow" <${process.env.SMTP_USER}>`,
    to: lead.email,
    subject: `Cash offer for your property at ${lead.address.substring(0, 25)}...`,
    html,
    text: html.replace(/<[^>]*>/g, '')
  });

  return result.messageId;
}

async function runWarmup(targetCount) {
  const client = await pool.connect();

  try {
    const warmupDay = await getWarmupDay();
    const todaySent = await getTodaySendCount();
    const dailyLimit = WARMUP_CONFIG.dailyLimits[warmupDay] || WARMUP_CONFIG.dailyLimits.default;
    const remaining = dailyLimit - todaySent;

    console.log(`📅 Warmup Day: ${warmupDay}`);
    console.log(`📊 Daily Limit: ${dailyLimit}`);
    console.log(`📤 Already Sent Today: ${todaySent}`);
    console.log(`📬 Remaining Capacity: ${remaining}`);
    console.log('');

    if (remaining <= 0) {
      console.log('⚠️ Daily limit reached. Wait until tomorrow to send more.');
      console.log('   This protects your sender reputation.');
      return { sent: 0, skipped: targetCount, reason: 'daily_limit' };
    }

    const toSend = Math.min(targetCount, remaining);
    console.log(`🎯 Will send: ${toSend} emails (requested: ${targetCount})`);
    console.log('');

    // Setup
    const transporter = await setupSMTP();
    await transporter.verify();
    console.log('✅ SMTP verified\n');

    const { rows: [org] } = await client.query('SELECT id FROM organizations LIMIT 1');
    const batchId = Date.now();

    // Send emails
    const results = { sent: 0, failed: 0, errors: [] };
    const startTime = Date.now();

    console.log('📤 Sending emails...\n');

    for (let i = 1; i <= toSend; i++) {
      try {
        // Create lead
        const lead = await createProductionLead(client, org.id, i, batchId);

        // Send email
        const messageId = await sendEmail(transporter, lead, batchId);
        results.sent++;

        // Progress
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stdout.write(`\r  [${results.sent}/${toSend}] Sent to ${lead.email.substring(0, 30)}... (${elapsed}s)`);

        // Batch pause
        if (i % WARMUP_CONFIG.batchSize === 0 && i < toSend) {
          console.log(`\n  ⏸️ Batch pause (${WARMUP_CONFIG.batchPause / 1000}s) - protecting deliverability...`);
          await new Promise(r => setTimeout(r, WARMUP_CONFIG.batchPause));
        } else {
          // Normal delay
          await new Promise(r => setTimeout(r, WARMUP_CONFIG.sendDelay));
        }

      } catch (error) {
        results.failed++;
        results.errors.push(error.message);
        console.log(`\n  ❌ Failed: ${error.message}`);
      }
    }

    console.log('\n');

    // Results
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    console.log('='.repeat(70));
    console.log('WARMUP RESULTS');
    console.log('='.repeat(70));
    console.log('');
    console.log(`✅ Sent: ${results.sent}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`⏱️ Time: ${totalTime} minutes`);
    console.log(`📅 Warmup Day: ${warmupDay}`);
    console.log(`📊 Today's Total: ${todaySent + results.sent}/${dailyLimit}`);
    console.log('');

    if (results.failed === 0) {
      console.log('✅ WARMUP BATCH: SUCCESS');
      console.log('');
      console.log('NEXT STEPS:');
      console.log('1. Wait 2-4 hours');
      console.log('2. Check inbox placement (not spam)');
      console.log('3. If clean, run another batch');
      console.log('4. Tomorrow: increase daily volume');
    } else {
      console.log('⚠️ WARMUP BATCH: PARTIAL');
      console.log('Some sends failed. Check errors before continuing.');
    }

    return results;

  } finally {
    client.release();
    await pool.end();
  }
}

// Parse command line args
const targetCount = parseInt(process.argv[2]) || 25;

console.log(`Target: ${targetCount} emails`);
console.log(`Test inbox: ${TEST_EMAIL}`);
console.log('');

runWarmup(targetCount).catch(error => {
  console.error('\n💥 FATAL:', error.message);
  process.exit(1);
});
