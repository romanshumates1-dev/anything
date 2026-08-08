#!/usr/bin/env node
/**
 * live-smtp-test.mjs
 * REAL EMAIL SENDING TEST - Phase 1
 *
 * Tests actual SMTP with 5 real emails
 */

import nodemailer from 'nodemailer';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

console.log('🔥 LIVE SMTP TEST - PHASE 1');
console.log('='.repeat(70));
console.log('');

const results = {
  sent: [],
  failed: [],
  errors: []
};

async function setupSMTP() {
  const provider = process.env.EMAIL_PROVIDER || 'smtp';

  if (provider === 'smtp') {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      throw new Error('SMTP credentials not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS');
    }

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  throw new Error(`Provider ${provider} not implemented yet`);
}

async function sendTestEmail(transporter, to, leadData) {
  const offerRange = `$${Math.round(leadData.offer_min / 1000)}k–$${Math.round(leadData.offer_max / 1000)}k`;

  const html = `
<p>Hi ${leadData.name},</p>

<p>I noticed your property at ${leadData.address}.</p>

<p><strong>I can close in 7 days, all cash: ${offerRange}.</strong></p>

<p>No contingencies, no inspections, as-is condition.</p>

<p>Are you open to discussing this?</p>

<p>Best regards,<br>
${process.env.EMAIL_FROM_NAME || 'DealFlow Team'}</p>

<hr>
<p style="font-size: 10px; color: #666;">
${process.env.COMPANY_POSTAL_ADDRESS}<br>
To unsubscribe, reply with STOP
</p>
`;

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME || 'DealFlow'}" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to,
    subject: `Quick cash offer for ${leadData.address}`,
    html,
    text: html.replace(/<[^>]*>/g, '') // Strip HTML
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId, to };
  } catch (error) {
    return { success: false, error: error.message, to };
  }
}

async function main() {
  const client = await pool.connect();

  try {
    console.log('📋 Step 1: Setup SMTP\n');

    const transporter = await setupSMTP();
    console.log(`✅ SMTP configured: ${process.env.SMTP_HOST || 'configured'}\n`);

    // Verify SMTP
    await transporter.verify();
    console.log('✅ SMTP connection verified\n');

    console.log('📋 Step 2: Get Test Leads\n');

    const { rows: leads } = await client.query(`
      SELECT l.id, l.name, l.email, l.metadata->>'address' as address,
             pv.offer_min, pv.offer_max
      FROM leads l
      JOIN property_valuations pv ON pv.lead_id = l.id
      LIMIT 5
    `);

    if (leads.length === 0) {
      console.log('❌ No leads found. Run simulation first.');
      process.exit(1);
    }

    console.log(`Found ${leads.length} test leads:\n`);
    leads.forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.name} <${l.email}>`);
    });

    console.log('');
    console.log('⚠️  WARNING: This will send REAL emails to these addresses');
    console.log('   Make sure these are YOUR test addresses!\n');

    console.log('📋 Step 3: Send Test Emails\n');

    for (const lead of leads) {
      process.stdout.write(`  Sending to ${lead.email}... `);

      const result = await sendTestEmail(transporter, lead.email, {
        name: lead.name,
        address: lead.address || 'your property',
        offer_min: lead.offer_min,
        offer_max: lead.offer_max
      });

      if (result.success) {
        console.log(`✅ SENT (${result.messageId})`);
        results.sent.push(result);
      } else {
        console.log(`❌ FAILED: ${result.error}`);
        results.failed.push(result);
        results.errors.push(result.error);
      }

      // Small delay between sends
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('PHASE 1 RESULTS');
    console.log('='.repeat(70));
    console.log('');
    console.log(`✅ Sent: ${results.sent.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`🔴 Errors: ${results.errors.length}`);
    console.log('');

    if (results.errors.length > 0) {
      console.log('ERRORS:');
      results.errors.forEach(e => console.log(`  - ${e}`));
      console.log('');
      console.log('STATUS: ❌ FAIL - Fix SMTP config and re-run');
      process.exit(1);
    }

    console.log('✅ STATUS: PASS - All emails sent successfully');
    console.log('');
    console.log('NEXT STEP:');
    console.log('1. Check your inbox for these emails');
    console.log('2. Verify they arrived and look correct');
    console.log('3. Reply to one or more emails');
    console.log('4. Run Phase 2: node scripts/live-reply-test.mjs');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('\n💥 FATAL:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
