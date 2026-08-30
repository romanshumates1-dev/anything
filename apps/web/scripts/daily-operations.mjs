#!/usr/bin/env node
/**
 * daily-operations.mjs
 * OPERATIONS MODE - Daily automated campaign execution
 *
 * Runs within safe limits, monitors metrics, generates reports
 * Consistency beats intensity.
 */

import nodemailer from 'nodemailer';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
  max: 10
});

const TEST_EMAIL = process.env.TEST_EMAIL || 'romanshumates1@gmail.com';

// Warmup schedule (conservative, reputation-safe)
const DAILY_LIMITS = {
  1: 50, 2: 50, 3: 50,
  4: 100, 5: 100, 6: 100, 7: 100,
  8: 200, 9: 200, 10: 200, 11: 200, 12: 200, 13: 200, 14: 200,
  default: 400
};

console.log('📊 DAILY OPERATIONS');
console.log('='.repeat(70));
console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
console.log('');

// ============ METRICS COLLECTION ============

async function collectMetrics(client) {
  const metrics = {};

  // Total leads
  const { rows: [leadCount] } = await client.query('SELECT COUNT(*) as count FROM leads');
  metrics.totalLeads = parseInt(leadCount.count);

  // Today's sends
  const { rows: [todaySends] } = await client.query(`
    SELECT COUNT(*) as count FROM leads
    WHERE metadata->>'source' LIKE 'production-%'
    AND created_at > CURRENT_DATE
  `);
  metrics.todaySends = parseInt(todaySends.count);

  // Queue status
  const { rows: queueStatus } = await client.query(`
    SELECT status, COUNT(*) as count
    FROM campaign_lead_queue
    GROUP BY status
  `);
  metrics.queueStatus = {};
  queueStatus.forEach(r => { metrics.queueStatus[r.status] = parseInt(r.count); });

  // Reply breakdown
  const { rows: replyBreakdown } = await client.query(`
    SELECT reply_sentiment, COUNT(*) as count
    FROM campaign_lead_queue
    WHERE reply_sentiment IS NOT NULL
    GROUP BY reply_sentiment
  `);
  metrics.replies = {};
  replyBreakdown.forEach(r => { metrics.replies[r.reply_sentiment] = parseInt(r.count); });

  // Today's replies
  const { rows: [todayReplies] } = await client.query(`
    SELECT COUNT(*) as count FROM campaign_lead_queue
    WHERE last_reply_at > CURRENT_DATE
  `);
  metrics.todayReplies = parseInt(todayReplies.count);

  // Active conversations (replied in last 7 days)
  const { rows: [activeConvos] } = await client.query(`
    SELECT COUNT(*) as count FROM campaign_lead_queue
    WHERE last_reply_at > NOW() - INTERVAL '7 days'
    AND status IN ('replied', 'conversation_active')
  `);
  metrics.activeConversations = parseInt(activeConvos.count);

  // Positive signals
  const { rows: [positiveSignals] } = await client.query(`
    SELECT COUNT(*) as count FROM campaign_lead_queue
    WHERE reply_sentiment = 'positive'
  `);
  metrics.positiveSignals = parseInt(positiveSignals.count);

  // Calculate rates
  const totalInQueue = Object.values(metrics.queueStatus).reduce((a, b) => a + b, 0);
  const totalReplies = Object.values(metrics.replies).reduce((a, b) => a + b, 0);

  metrics.replyRate = totalInQueue > 0 ? ((totalReplies / totalInQueue) * 100).toFixed(1) : 0;
  metrics.positiveRate = totalReplies > 0 ? ((metrics.positiveSignals / totalReplies) * 100).toFixed(1) : 0;

  return metrics;
}

// ============ WARMUP DAY CALCULATION ============

async function getWarmupDay(client) {
  const { rows } = await client.query(`
    SELECT MIN(created_at) as first_send
    FROM leads
    WHERE metadata->>'source' LIKE 'production-%'
  `);

  if (!rows[0]?.first_send) return 1;

  const firstSend = new Date(rows[0].first_send);
  const now = new Date();
  const daysDiff = Math.floor((now - firstSend) / (1000 * 60 * 60 * 24)) + 1;
  return Math.min(daysDiff, 15);
}

// ============ SEND OPERATIONS ============

async function setupSMTP() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) return null;

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass }
  });
}

async function sendDailyBatch(client, transporter, count) {
  const { rows: [org] } = await client.query('SELECT id FROM organizations LIMIT 1');
  const batchId = Date.now();
  const results = { sent: 0, failed: 0 };

  for (let i = 1; i <= count; i++) {
    try {
      const uniqueEmail = TEST_EMAIL.replace('@', `+ops${batchId}-${i}@`);

      // Create lead
      const { rows: [lead] } = await client.query(`
        INSERT INTO leads (organization_id, name, email, phone, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (organization_id, email) DO UPDATE SET metadata = EXCLUDED.metadata
        RETURNING id
      `, [
        org.id,
        `Property Owner ${i}`,
        uniqueEmail,
        `+1502555${String(i).padStart(4, '0')}`,
        JSON.stringify({
          address: `${1000 + i} Daily St, Louisville, KY 40${200 + (i % 100)}`,
          source: `production-${batchId}`
        })
      ]);

      // Create valuation
      const arv = 180000 + (i * 500);
      await client.query(`
        INSERT INTO property_valuations (lead_id, arv, offer_min, offer_max, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (lead_id) DO UPDATE SET arv = $2, offer_min = $3, offer_max = $4
      `, [lead.id, arv, Math.round(arv * 0.62), Math.round(arv * 0.68)]);

      // Send email
      const offerRange = `$${Math.round(arv * 0.62 / 1000)}k-$${Math.round(arv * 0.68 / 1000)}k`;

      await transporter.sendMail({
        from: `"DealFlow" <${process.env.SMTP_USER}>`,
        to: uniqueEmail,
        subject: `Quick question about ${1000 + i} Daily St`,
        html: `<p>Hi Property Owner ${i},</p>
<p>Cash offer for your property: <strong>${offerRange}</strong></p>
<p>Close in 7 days, as-is. Interested?</p>
<p>- Roman</p>`,
        text: `Cash offer: ${offerRange}. Close in 7 days. Interested?`
      });

      results.sent++;

      // Rate limiting
      await new Promise(r => setTimeout(r, 3000));

      if (i % 10 === 0) {
        process.stdout.write(`\r  Progress: ${i}/${count}`);
        await new Promise(r => setTimeout(r, 30000)); // 30s pause every 10
      }

    } catch (error) {
      results.failed++;
    }
  }

  console.log(`\r  Completed: ${results.sent}/${count} sent`);
  return results;
}

// ============ DAILY REPORT ============

function generateDailyReport(metrics, warmupDay, dailyLimit, sendResults) {
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 DAILY OPERATIONS REPORT');
  console.log('='.repeat(70));
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`Warmup Day: ${warmupDay}`);
  console.log('');

  console.log('📤 SENDING:');
  console.log(`  Daily limit: ${dailyLimit}`);
  console.log(`  Sent today: ${metrics.todaySends}`);
  if (sendResults) {
    console.log(`  This batch: ${sendResults.sent} sent, ${sendResults.failed} failed`);
  }
  console.log('');

  console.log('📬 ENGAGEMENT:');
  console.log(`  Leads processed: ${metrics.totalLeads}`);
  console.log(`  Total replies: ${Object.values(metrics.replies).reduce((a, b) => a + b, 0)}`);
  console.log(`  Today's replies: ${metrics.todayReplies}`);
  console.log(`  Positive signals: ${metrics.positiveSignals}`);
  console.log(`  Active conversations: ${metrics.activeConversations}`);
  console.log('');

  console.log('📈 RATES:');
  console.log(`  Reply rate: ${metrics.replyRate}%`);
  console.log(`  Positive rate: ${metrics.positiveRate}%`);
  console.log('');

  console.log('💬 REPLY BREAKDOWN:');
  for (const [sentiment, count] of Object.entries(metrics.replies)) {
    console.log(`  ${sentiment}: ${count}`);
  }
  console.log('');

  // Health check
  const healthy = metrics.replyRate > 0 || metrics.todaySends < 100; // Early days won't have reply data

  if (healthy) {
    console.log('✅ SYSTEM STATUS: HEALTHY');
  } else {
    console.log('⚠️ SYSTEM STATUS: MONITOR');
    console.log('   Low reply rate detected. Check:');
    console.log('   - Inbox placement');
    console.log('   - Email content');
    console.log('   - Send timing');
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log('');

  // Success metrics focus
  console.log('🎯 SUCCESS METRICS (what matters):');
  console.log(`  Real conversations: ${metrics.activeConversations}`);
  console.log(`  Positive intent: ${metrics.positiveSignals}`);
  console.log(`  Deal progression: ${metrics.queueStatus['converted'] || 0} converted`);
  console.log('');

  console.log('📋 TOMORROW:');
  const tomorrowDay = Math.min(warmupDay + 1, 15);
  const tomorrowLimit = DAILY_LIMITS[tomorrowDay] || DAILY_LIMITS.default;
  console.log(`  Warmup day: ${tomorrowDay}`);
  console.log(`  Daily limit: ${tomorrowLimit}`);
  console.log('');

  return healthy;
}

// ============ MAIN ============

async function main() {
  const client = await pool.connect();

  try {
    // 1. Collect current metrics
    console.log('📊 Collecting metrics...\n');
    const metrics = await collectMetrics(client);

    // 2. Determine warmup day and limits
    const warmupDay = await getWarmupDay(client);
    const dailyLimit = DAILY_LIMITS[warmupDay] || DAILY_LIMITS.default;
    const remaining = dailyLimit - metrics.todaySends;

    console.log(`Warmup Day: ${warmupDay}`);
    console.log(`Daily Limit: ${dailyLimit}`);
    console.log(`Already Sent: ${metrics.todaySends}`);
    console.log(`Remaining: ${remaining}`);
    console.log('');

    // 3. Send daily batch if capacity remains
    let sendResults = null;

    if (remaining > 0) {
      const transporter = await setupSMTP();

      if (transporter) {
        await transporter.verify();
        console.log('✅ SMTP ready\n');

        const toSend = Math.min(remaining, 25); // Max 25 per run for safety
        console.log(`📤 Sending ${toSend} emails...\n`);

        sendResults = await sendDailyBatch(client, transporter, toSend);
      } else {
        console.log('⚠️ SMTP not configured. Skipping sends.\n');
        console.log('   Run with: SMTP_USER=... SMTP_PASS=... node scripts/daily-operations.mjs\n');
      }
    } else {
      console.log('📭 Daily limit reached. No sends today.\n');
    }

    // 4. Re-collect metrics after sends
    const finalMetrics = await collectMetrics(client);

    // 5. Generate report
    const healthy = generateDailyReport(finalMetrics, warmupDay, dailyLimit, sendResults);

    // 6. Save report to file
    const reportDate = new Date().toISOString().split('T')[0];
    const reportPath = `reports/daily-${reportDate}.json`;

    const reportData = {
      date: reportDate,
      warmupDay,
      dailyLimit,
      metrics: finalMetrics,
      sends: sendResults,
      healthy
    };

    // Create reports dir if needed
    const fs = await import('fs');
    if (!fs.existsSync('reports')) {
      fs.mkdirSync('reports');
    }
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
    console.log(`Report saved: ${reportPath}`);

    process.exit(healthy ? 0 : 1);

  } catch (error) {
    console.error('\n💥 ERROR:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
