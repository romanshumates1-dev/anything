#!/usr/bin/env node
/**
 * phase1-real-smtp.mjs
 * PHASE 1: Real SMTP validation with YOUR email
 *
 * Sends 5 real emails to romanshumate@gmail.com
 */

import nodemailer from 'nodemailer';
import pg from 'pg';
const { Pool } = pg;

// Supabase connection (working)
const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

// YOUR email for testing
const TEST_EMAIL = 'romanshumates1@gmail.com';

console.log('🔥 PHASE 1: REAL SMTP VALIDATION');
console.log('='.repeat(70));
console.log(`Target inbox: ${TEST_EMAIL}`);
console.log('');

const results = {
  sent: [],
  failed: [],
  errors: []
};

async function setupSMTP() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error(`SMTP credentials missing. Set SMTP_USER and SMTP_PASS.

Run with:
  SMTP_USER=romanshumate@gmail.com SMTP_PASS=your-app-password node scripts/phase1-real-smtp.mjs`);
  }

  console.log(`📧 SMTP: ${host}:${port}`);
  console.log(`📧 User: ${user}`);
  console.log('');

  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass }
  });
}

async function createTestLeads(client) {
  // Get org
  const { rows: [org] } = await client.query('SELECT id FROM organizations LIMIT 1');
  if (!org) throw new Error('No organization found');

  // Create 5 test leads with YOUR email
  const testLeads = [];

  for (let i = 1; i <= 5; i++) {
    // Use unique email per lead with +alias (Gmail ignores everything after +)
    const uniqueEmail = TEST_EMAIL.replace('@', `+test${i}@`);

    // Upsert - update if exists, insert if not
    const { rows: [inserted] } = await client.query(`
      INSERT INTO leads (organization_id, name, email, phone, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (organization_id, email) DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        metadata = EXCLUDED.metadata
      RETURNING id
    `, [
      org.id,
      `Test Property Owner ${i}`,
      uniqueEmail,
      '+15025550' + String(i).padStart(3, '0'),
      JSON.stringify({
        address: `${100 + i * 10} Test Street, Louisville, KY 40${200 + i}`,
        source: 'phase1-smtp-test'
      })
    ]);

    const leadId = inserted.id;

    // Create valuation for offer amounts
    const arv = 200000 + (i * 25000);
    const offerMin = Math.round(arv * 0.60);
    const offerMax = Math.round(arv * 0.65);

    await client.query(`
      INSERT INTO property_valuations (lead_id, arv, offer_min, offer_max, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (lead_id) DO UPDATE SET arv = $2, offer_min = $3, offer_max = $4
    `, [leadId, arv, offerMin, offerMax]);

    testLeads.push({
      id: leadId,
      name: `Test Property Owner ${i}`,
      email: TEST_EMAIL,
      address: `${100 + i * 10} Test Street, Louisville, KY 40${200 + i}`,
      offer_min: offerMin,
      offer_max: offerMax
    });
  }

  return testLeads;
}

async function sendEmail(transporter, lead, index) {
  const offerRange = `$${Math.round(lead.offer_min / 1000)}k–$${Math.round(lead.offer_max / 1000)}k`;
  const fromName = process.env.EMAIL_FROM_NAME || 'DealFlow';
  const fromEmail = process.env.SMTP_USER;

  const html = `
<p>Hi ${lead.name},</p>

<p>I noticed your property at <strong>${lead.address}</strong>.</p>

<p><strong>I can close in 7 days, all cash: ${offerRange}.</strong></p>

<p>No contingencies, no inspections, as-is condition.</p>

<p>Are you open to discussing this?</p>

<p>Best regards,<br>
${fromName}</p>

<hr>
<p style="font-size: 10px; color: #666;">
This is test email #${index + 1} from Phase 1 SMTP validation.<br>
To unsubscribe, reply with STOP
</p>
`;

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: lead.email,
    subject: `[TEST ${index + 1}] Cash offer for ${lead.address}`,
    html,
    text: html.replace(/<[^>]*>/g, '')
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId, lead: lead.name };
  } catch (error) {
    return { success: false, error: error.message, lead: lead.name };
  }
}

async function main() {
  const client = await pool.connect();

  try {
    // Step 1: Setup SMTP
    console.log('📋 Step 1: Setup SMTP\n');
    const transporter = await setupSMTP();

    // Verify connection
    console.log('Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified!\n');

    // Step 2: Create test leads
    console.log('📋 Step 2: Create test leads\n');
    const leads = await createTestLeads(client);
    console.log(`✅ Created ${leads.length} test leads\n`);

    // Step 3: Send emails
    console.log('📋 Step 3: Send REAL emails\n');
    console.log('⚠️  Sending to YOUR inbox: ' + TEST_EMAIL);
    console.log('');

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      process.stdout.write(`  [${i + 1}/${leads.length}] Sending to ${lead.name}... `);

      const result = await sendEmail(transporter, lead, i);

      if (result.success) {
        console.log(`✅ SENT (${result.messageId})`);
        results.sent.push(result);
      } else {
        console.log(`❌ FAILED: ${result.error}`);
        results.failed.push(result);
        results.errors.push(result.error);
      }

      // Delay between sends (avoid rate limiting)
      await new Promise(r => setTimeout(r, 2000));
    }

    // Results
    console.log('');
    console.log('='.repeat(70));
    console.log('PHASE 1 RESULTS');
    console.log('='.repeat(70));
    console.log('');
    console.log(`✅ Sent successfully: ${results.sent.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log('');

    if (results.errors.length > 0) {
      console.log('ERRORS:');
      results.errors.forEach(e => console.log(`  - ${e}`));
      console.log('');
      console.log('❌ PHASE 1: FAIL');
      console.log('ACTION: Fix SMTP config and re-run');
      process.exit(1);
    }

    console.log('✅ PHASE 1: PASS');
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Check your Gmail inbox for 5 test emails');
    console.log('2. Verify they look correct (subject, body, offer amounts)');
    console.log('3. Reply to at least one email');
    console.log('4. Run Phase 2: node scripts/phase2-reply-test.mjs');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('\n💥 FATAL:', error.message);
    if (error.message.includes('credentials')) {
      console.error('\nRun with credentials:');
      console.error('  SMTP_USER=romanshumate@gmail.com SMTP_PASS=YOUR_APP_PASSWORD node scripts/phase1-real-smtp.mjs');
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
