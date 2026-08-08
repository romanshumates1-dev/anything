#!/usr/bin/env node
/**
 * phase4-scale-test.mjs
 * PHASE 4: Controlled scale-up with real SMTP
 *
 * Staged scaling: 20 → 50 → 100 leads
 * Validates system stability under increasing load
 */

import nodemailer from 'nodemailer';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
  max: 20
});

const TEST_EMAIL = 'romanshumates1@gmail.com';
const SCALE_LEVELS = [20, 50, 100];

console.log('🔥 PHASE 4: CONTROLLED SCALE-UP');
console.log('='.repeat(70));
console.log(`Scale levels: ${SCALE_LEVELS.join(' → ')} leads`);
console.log(`Target inbox: ${TEST_EMAIL}`);
console.log('');

async function setupSMTP() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('SMTP credentials missing. Set SMTP_USER and SMTP_PASS');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5
  });
}

async function createLeads(client, count, orgId, batchId) {
  const leads = [];

  for (let i = 1; i <= count; i++) {
    const uniqueEmail = TEST_EMAIL.replace('@', `+scale${batchId}-${i}@`);

    const { rows: [inserted] } = await client.query(`
      INSERT INTO leads (organization_id, name, email, phone, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (organization_id, email) DO UPDATE SET
        name = EXCLUDED.name,
        metadata = EXCLUDED.metadata
      RETURNING id
    `, [
      orgId,
      `Scale Test Lead ${batchId}-${i}`,
      uniqueEmail,
      `+1502555${String(i).padStart(4, '0')}`,
      JSON.stringify({
        address: `${1000 + i} Scale Ave, Louisville, KY 40${200 + (i % 100)}`,
        source: `phase4-scale-${batchId}`,
        batch: batchId
      })
    ]);

    const arv = 150000 + (i * 1000);
    const offerMin = Math.round(arv * 0.60);
    const offerMax = Math.round(arv * 0.65);

    await client.query(`
      INSERT INTO property_valuations (lead_id, arv, offer_min, offer_max, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (lead_id) DO UPDATE SET arv = $2, offer_min = $3, offer_max = $4
    `, [inserted.id, arv, offerMin, offerMax]);

    leads.push({
      id: inserted.id,
      name: `Scale Test Lead ${batchId}-${i}`,
      email: uniqueEmail,
      address: `${1000 + i} Scale Ave, Louisville, KY 40${200 + (i % 100)}`,
      offer_min: offerMin,
      offer_max: offerMax
    });
  }

  return leads;
}

async function sendEmails(transporter, leads, batchId) {
  const results = { sent: 0, failed: 0, errors: [] };
  const startTime = Date.now();

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const offerRange = `$${Math.round(lead.offer_min / 1000)}k–$${Math.round(lead.offer_max / 1000)}k`;

    const html = `
<p>Hi ${lead.name},</p>
<p>Cash offer for ${lead.address}: <strong>${offerRange}</strong></p>
<p>Close in 7 days, all cash, as-is. Interested?</p>
<p>— DealFlow Team</p>
<hr><p style="font-size:10px;color:#666;">Scale test batch ${batchId}, email ${i + 1}/${leads.length}</p>
`;

    try {
      await transporter.sendMail({
        from: `"DealFlow" <${process.env.SMTP_USER}>`,
        to: lead.email,
        subject: `[SCALE-${batchId}] Offer for ${lead.address.substring(0, 30)}`,
        html,
        text: html.replace(/<[^>]*>/g, '')
      });
      results.sent++;

      // Progress update every 10 emails
      if ((i + 1) % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (results.sent / elapsed).toFixed(1);
        process.stdout.write(`\r  Progress: ${results.sent}/${leads.length} sent (${rate}/sec)`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(`${lead.email}: ${error.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\r  Completed: ${results.sent}/${leads.length} in ${elapsed}s`);

  return results;
}

async function runScaleLevel(transporter, client, level, orgId) {
  const batchId = Date.now();

  console.log(`\n📈 Scale Level: ${level} leads`);
  console.log('-'.repeat(40));

  // Create leads
  process.stdout.write(`  Creating ${level} leads... `);
  const leads = await createLeads(client, level, orgId, batchId);
  console.log(`✅ Done`);

  // Send emails
  console.log(`  Sending ${level} emails...`);
  const results = await sendEmails(transporter, leads, batchId);

  // Check for issues
  const success = results.failed === 0;
  const successRate = ((results.sent / level) * 100).toFixed(1);

  console.log(`  Results:`);
  console.log(`    ✅ Sent: ${results.sent}`);
  console.log(`    ❌ Failed: ${results.failed}`);
  console.log(`    📊 Success rate: ${successRate}%`);

  if (results.errors.length > 0 && results.errors.length <= 5) {
    console.log(`    Errors:`);
    results.errors.forEach(e => console.log(`      - ${e}`));
  } else if (results.errors.length > 5) {
    console.log(`    First 5 errors:`);
    results.errors.slice(0, 5).forEach(e => console.log(`      - ${e}`));
  }

  return {
    level,
    sent: results.sent,
    failed: results.failed,
    successRate: parseFloat(successRate),
    passed: success && results.sent === level
  };
}

async function main() {
  const client = await pool.connect();

  try {
    // Setup
    console.log('📋 Setup\n');

    const transporter = await setupSMTP();
    await transporter.verify();
    console.log('✅ SMTP verified\n');

    const { rows: [org] } = await client.query('SELECT id FROM organizations LIMIT 1');
    if (!org) throw new Error('No organization found');

    // Run scale tests
    const levelResults = [];

    for (const level of SCALE_LEVELS) {
      const result = await runScaleLevel(transporter, client, level, org.id);
      levelResults.push(result);

      if (!result.passed) {
        console.log(`\n❌ Scale level ${level} FAILED`);
        console.log('Stopping scale-up. Fix issues and re-run.');
        break;
      }

      console.log(`  ✅ Scale level ${level}: PASS`);

      // Brief pause between levels
      if (level !== SCALE_LEVELS[SCALE_LEVELS.length - 1]) {
        console.log(`  Waiting 5s before next level...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // Final results
    console.log('');
    console.log('='.repeat(70));
    console.log('PHASE 4 RESULTS');
    console.log('='.repeat(70));
    console.log('');

    const totalSent = levelResults.reduce((sum, r) => sum + r.sent, 0);
    const totalFailed = levelResults.reduce((sum, r) => sum + r.failed, 0);
    const allPassed = levelResults.every(r => r.passed);

    console.log('Scale Level Summary:');
    levelResults.forEach(r => {
      const status = r.passed ? '✅' : '❌';
      console.log(`  ${status} ${r.level} leads: ${r.sent} sent, ${r.failed} failed (${r.successRate}%)`);
    });

    console.log('');
    console.log(`Total emails sent: ${totalSent}`);
    console.log(`Total failures: ${totalFailed}`);
    console.log('');

    if (allPassed && levelResults.length === SCALE_LEVELS.length) {
      console.log('✅ PHASE 4: PASS');
      console.log('');
      console.log('VALIDATED:');
      console.log('  ✅ No send failures at any scale level');
      console.log('  ✅ No rate-limit issues');
      console.log('  ✅ System remains stable under load');
      console.log('');
      console.log('NEXT: Phase 5 - Final validation report');
      process.exit(0);
    } else {
      console.log('❌ PHASE 4: FAIL');
      console.log('Fix issues and re-run');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 FATAL:', error.message);
    if (error.message.includes('credentials')) {
      console.error('\nRun with:');
      console.error('  SMTP_USER=romanshumates1@gmail.com SMTP_PASS=YOUR_APP_PASSWORD node scripts/phase4-scale-test.mjs');
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
