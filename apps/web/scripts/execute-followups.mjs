#!/usr/bin/env node
/**
 * execute-followups.mjs
 * EXECUTE FOLLOW-UPS - Send conversion-focused responses
 *
 * Processes HIGH priority leads and sends optimized responses
 */

import nodemailer from 'nodemailer';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

const TEST_EMAIL = process.env.TEST_EMAIL || 'romanshumates1@gmail.com';
const MAX_FOLLOWUPS = parseInt(process.argv[2]) || 10; // Default 10 per run

console.log('📤 EXECUTE FOLLOW-UPS');
console.log('='.repeat(70));
console.log(`Max follow-ups this run: ${MAX_FOLLOWUPS}`);
console.log('');

// ============ CLOSING PROMPTS ============

const CLOSING_PROMPTS = {
  scheduleAppointment: (lead) => ({
    subject: `Re: Quick question about ${lead.address?.split(',')[0] || 'your property'}`,
    body: `${lead.name}, great to hear you're interested!

Let's lock in a time. I have availability:
• Tomorrow afternoon
• ${getDayName(2)} morning

Which works better? I'll come to ${lead.address?.split(',')[0] || 'the property'} - takes just 15 minutes.

- Roman`
  }),

  askForClose: (lead) => ({
    subject: `Re: Next steps for ${lead.address?.split(',')[0] || 'your property'}`,
    body: `${lead.name}, sounds like we're aligned.

Here's what happens next:
1. I send a simple 2-page purchase agreement
2. You review and sign (no obligation until signed)
3. We pick a closing date (as fast as 7 days)

Ready for me to send the paperwork?

- Roman`
  }),

  priceReframe: (lead) => ({
    subject: `Re: About the offer for ${lead.address?.split(',')[0] || 'your property'}`,
    body: `${lead.name}, I hear you on the price.

Let me break it down:
• Traditional sale: 6% agent fees + closing costs + repairs + 60-90 day wait
• My offer: Zero fees, I pay closing, as-is, done in 7 days

Net-net, you're often within 5% - but 3 months faster with zero hassle.

What if I could stretch a bit? Would that work?

- Roman`
  }),

  gentleUrgency: (lead) => ({
    subject: `Re: Following up - ${lead.address?.split(',')[0] || 'your property'}`,
    body: `${lead.name}, totally understand you need time.

Quick heads up: I'm actively buying in your area this month. My offer is good for the next 7 days.

No pressure - but if timing matters, sooner is better. Want me to hold that price?

- Roman`
  }),

  reEngagement: (lead) => ({
    subject: `Checking in - ${lead.address?.split(',')[0] || 'your property'}`,
    body: `Hi ${lead.name}, checking in on your property.

Still interested in my cash offer?

If anything changed on your end, no worries - just let me know either way.

- Roman`
  })
};

function getDayName(daysAhead) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return days[d.getDay()];
}

function determineAction(lead) {
  const sentiment = lead.reply_sentiment;
  const hours = lead.hours_since_reply || 0;

  if (sentiment === 'positive') {
    if (hours < 24) return 'scheduleAppointment';
    if (hours < 72) return 'askForClose';
    return 'gentleUrgency';
  }
  if (sentiment === 'objection') return 'priceReframe';
  if (sentiment === 'question') return 'scheduleAppointment';
  if (sentiment === 'neutral') return 'gentleUrgency';
  return 'reEngagement';
}

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

async function main() {
  const client = await pool.connect();

  try {
    // Get high priority leads
    const { rows: leads } = await client.query(`
      SELECT
        clq.lead_id,
        l.name,
        l.email,
        l.metadata->>'address' as address,
        clq.reply_sentiment,
        clq.status,
        clq.offer_min,
        clq.offer_max,
        EXTRACT(EPOCH FROM (NOW() - clq.last_reply_at))/3600 as hours_since_reply
      FROM campaign_lead_queue clq
      JOIN leads l ON l.id = clq.lead_id
      WHERE clq.reply_sentiment IN ('positive', 'objection', 'question')
      AND clq.status NOT IN ('converted', 'dead', 'unsubscribed', 'followed_up')
      ORDER BY
        CASE clq.reply_sentiment
          WHEN 'positive' THEN 1
          WHEN 'objection' THEN 2
          ELSE 3
        END,
        clq.last_reply_at DESC
      LIMIT $1
    `, [MAX_FOLLOWUPS]);

    console.log(`Found ${leads.length} leads to follow up\n`);

    if (leads.length === 0) {
      console.log('No leads need follow-up right now.');
      process.exit(0);
    }

    const transporter = await setupSMTP();
    if (!transporter) {
      console.log('⚠️ SMTP not configured. Showing what WOULD be sent:\n');

      leads.forEach((lead, i) => {
        const action = determineAction(lead);
        const template = CLOSING_PROMPTS[action]?.(lead);
        console.log(`${i + 1}. ${lead.name} (${lead.reply_sentiment})`);
        console.log(`   Action: ${action}`);
        console.log(`   Subject: ${template?.subject || 'N/A'}`);
        console.log(`   Body preview: ${template?.body?.substring(0, 80)}...`);
        console.log('');
      });

      console.log('Run with SMTP_USER and SMTP_PASS to send.');
      process.exit(0);
    }

    await transporter.verify();
    console.log('✅ SMTP ready\n');

    const results = { sent: 0, failed: 0 };

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const action = determineAction(lead);
      const template = CLOSING_PROMPTS[action]?.(lead);

      if (!template) {
        console.log(`  ❌ No template for ${action}`);
        results.failed++;
        continue;
      }

      // For testing, send to test email with lead context
      const testEmail = TEST_EMAIL.replace('@', `+followup${Date.now()}-${i}@`);

      try {
        await transporter.sendMail({
          from: `"Roman - DealFlow" <${process.env.SMTP_USER}>`,
          to: testEmail,
          subject: template.subject,
          text: template.body,
          html: `<p>${template.body.replace(/\n/g, '<br>')}</p>`
        });

        results.sent++;
        console.log(`  ✅ ${lead.name} - ${action}`);

        // Mark as followed up
        await client.query(`
          UPDATE campaign_lead_queue
          SET status = 'followed_up'
          WHERE lead_id = $1
        `, [lead.lead_id]);

        // Rate limit
        await new Promise(r => setTimeout(r, 2000));

      } catch (error) {
        results.failed++;
        console.log(`  ❌ ${lead.name} - ${error.message}`);
      }
    }

    console.log('');
    console.log('='.repeat(70));
    console.log('FOLLOW-UP RESULTS');
    console.log('='.repeat(70));
    console.log(`  ✅ Sent: ${results.sent}`);
    console.log(`  ❌ Failed: ${results.failed}`);
    console.log('');

    if (results.sent > 0) {
      console.log('✅ Follow-ups executed successfully');
      console.log('   Check inbox for responses');
    }

    process.exit(results.failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n💥 ERROR:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
