#!/usr/bin/env node
/**
 * conversation-audit.mjs
 * CONVERSION OPTIMIZATION - Audit all active conversations
 *
 * Identifies: stalled conversations, hot leads, re-engagement opportunities
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

console.log('🔍 CONVERSATION AUDIT');
console.log('='.repeat(70));
console.log('');

async function auditConversations(client) {
  const audit = {
    hotLeads: [],
    stalled: [],
    reEngagement: [],
    objectionHandling: [],
    readyToClose: []
  };

  // 1. HOT LEADS - Positive signals, recent activity
  console.log('🔥 Analyzing HOT LEADS (positive signals)...\n');

  const { rows: hotLeads } = await client.query(`
    SELECT
      clq.lead_id,
      l.name,
      l.email,
      l.metadata->>'address' as address,
      clq.reply_sentiment,
      clq.status,
      clq.last_reply_at,
      clq.offer_min,
      clq.offer_max,
      EXTRACT(EPOCH FROM (NOW() - clq.last_reply_at))/3600 as hours_since_reply
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    WHERE clq.reply_sentiment = 'positive'
    ORDER BY clq.last_reply_at DESC
    LIMIT 50
  `);

  audit.hotLeads = hotLeads;
  console.log(`  Found ${hotLeads.length} positive signals`);

  if (hotLeads.length > 0) {
    console.log('\n  Sample hot leads:');
    hotLeads.slice(0, 5).forEach((lead, i) => {
      const hours = Math.round(lead.hours_since_reply || 0);
      console.log(`    ${i + 1}. ${lead.name} - ${lead.address?.substring(0, 30) || 'N/A'}`);
      console.log(`       Status: ${lead.status} | Last reply: ${hours}h ago`);
    });
  }

  // 2. STALLED CONVERSATIONS - No activity in 24-72 hours
  console.log('\n\n⏸️ Analyzing STALLED conversations...\n');

  const { rows: stalled } = await client.query(`
    SELECT
      clq.lead_id,
      l.name,
      l.email,
      l.metadata->>'address' as address,
      clq.reply_sentiment,
      clq.status,
      clq.last_reply_at,
      EXTRACT(EPOCH FROM (NOW() - clq.last_reply_at))/3600 as hours_since_reply
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    WHERE clq.last_reply_at IS NOT NULL
    AND clq.last_reply_at < NOW() - INTERVAL '24 hours'
    AND clq.last_reply_at > NOW() - INTERVAL '7 days'
    AND clq.status NOT IN ('converted', 'dead', 'unsubscribed')
    ORDER BY clq.last_reply_at DESC
    LIMIT 100
  `);

  audit.stalled = stalled;
  console.log(`  Found ${stalled.length} stalled conversations (24h-7d no activity)`);

  // Categorize stalled by sentiment
  const stalledBySentiment = {};
  stalled.forEach(s => {
    const sent = s.reply_sentiment || 'unknown';
    stalledBySentiment[sent] = (stalledBySentiment[sent] || 0) + 1;
  });
  console.log('\n  Stalled by last sentiment:');
  Object.entries(stalledBySentiment).forEach(([sent, count]) => {
    console.log(`    ${sent}: ${count}`);
  });

  // 3. OBJECTION OPPORTUNITIES - Replied with objection, needs handling
  console.log('\n\n🎯 Analyzing OBJECTION opportunities...\n');

  const { rows: objections } = await client.query(`
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
    WHERE clq.reply_sentiment = 'objection'
    AND clq.status NOT IN ('converted', 'dead')
    ORDER BY clq.last_reply_at DESC
    LIMIT 50
  `);

  audit.objectionHandling = objections;
  console.log(`  Found ${objections.length} objection leads (need handling)`);

  // 4. READY TO CLOSE - Positive + engaged recently
  console.log('\n\n💰 Analyzing READY TO CLOSE...\n');

  const { rows: readyToClose } = await client.query(`
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
    WHERE clq.reply_sentiment = 'positive'
    AND clq.last_reply_at > NOW() - INTERVAL '48 hours'
    AND clq.status NOT IN ('converted', 'dead')
    ORDER BY clq.last_reply_at DESC
    LIMIT 25
  `);

  audit.readyToClose = readyToClose;
  console.log(`  Found ${readyToClose.length} leads ready to close (positive + recent)`);

  // 5. RE-ENGAGEMENT pool - Went cold but showed interest
  console.log('\n\n🔄 Analyzing RE-ENGAGEMENT pool...\n');

  const { rows: reEngage } = await client.query(`
    SELECT
      clq.lead_id,
      l.name,
      l.email,
      l.metadata->>'address' as address,
      clq.reply_sentiment,
      clq.status,
      clq.last_reply_at,
      EXTRACT(EPOCH FROM (NOW() - clq.last_reply_at))/86400 as days_since_reply
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    WHERE clq.reply_sentiment IN ('positive', 'neutral', 'question')
    AND clq.last_reply_at < NOW() - INTERVAL '3 days'
    AND clq.last_reply_at > NOW() - INTERVAL '14 days'
    AND clq.status NOT IN ('converted', 'dead', 'unsubscribed')
    ORDER BY
      CASE clq.reply_sentiment
        WHEN 'positive' THEN 1
        WHEN 'question' THEN 2
        ELSE 3
      END,
      clq.last_reply_at DESC
    LIMIT 100
  `);

  audit.reEngagement = reEngage;
  console.log(`  Found ${reEngage.length} re-engagement opportunities (3-14 days cold)`);

  return audit;
}

function generateAuditReport(audit) {
  console.log('');
  console.log('='.repeat(70));
  console.log('📊 CONVERSATION AUDIT REPORT');
  console.log('='.repeat(70));
  console.log('');

  console.log('PIPELINE SUMMARY:');
  console.log(`  🔥 Hot leads (positive):        ${audit.hotLeads.length}`);
  console.log(`  💰 Ready to close:              ${audit.readyToClose.length}`);
  console.log(`  🎯 Objection handling:          ${audit.objectionHandling.length}`);
  console.log(`  ⏸️ Stalled (need follow-up):    ${audit.stalled.length}`);
  console.log(`  🔄 Re-engagement pool:          ${audit.reEngagement.length}`);
  console.log('');

  const totalOpportunities =
    audit.readyToClose.length +
    audit.objectionHandling.length +
    audit.stalled.filter(s => s.reply_sentiment === 'positive').length;

  console.log(`TOTAL ACTIVE OPPORTUNITIES: ${totalOpportunities}`);
  console.log('');

  console.log('-'.repeat(70));
  console.log('');

  console.log('🎯 PRIORITY ACTIONS:');
  console.log('');

  // Priority 1: Ready to close
  console.log('1️⃣ CLOSE NOW (positive + recent):');
  if (audit.readyToClose.length > 0) {
    audit.readyToClose.slice(0, 5).forEach((lead, i) => {
      const offer = `$${Math.round(lead.offer_min/1000)}k-$${Math.round(lead.offer_max/1000)}k`;
      console.log(`   ${i + 1}. ${lead.name} | ${offer} | ${Math.round(lead.hours_since_reply)}h ago`);
    });
    console.log(`   ... and ${Math.max(0, audit.readyToClose.length - 5)} more`);
  } else {
    console.log('   None currently');
  }
  console.log('');

  // Priority 2: Handle objections
  console.log('2️⃣ HANDLE OBJECTIONS:');
  if (audit.objectionHandling.length > 0) {
    audit.objectionHandling.slice(0, 5).forEach((lead, i) => {
      const offer = `$${Math.round(lead.offer_min/1000)}k-$${Math.round(lead.offer_max/1000)}k`;
      console.log(`   ${i + 1}. ${lead.name} | ${offer} | Objection received`);
    });
    console.log(`   ... and ${Math.max(0, audit.objectionHandling.length - 5)} more`);
  } else {
    console.log('   None currently');
  }
  console.log('');

  // Priority 3: Follow up stalled
  console.log('3️⃣ FOLLOW UP (stalled positive):');
  const stalledPositive = audit.stalled.filter(s => s.reply_sentiment === 'positive');
  if (stalledPositive.length > 0) {
    stalledPositive.slice(0, 5).forEach((lead, i) => {
      const hours = Math.round(lead.hours_since_reply);
      console.log(`   ${i + 1}. ${lead.name} | Last contact: ${hours}h ago`);
    });
    console.log(`   ... and ${Math.max(0, stalledPositive.length - 5)} more`);
  } else {
    console.log('   None currently');
  }
  console.log('');

  // Priority 4: Re-engage
  console.log('4️⃣ RE-ENGAGE (went cold):');
  if (audit.reEngagement.length > 0) {
    audit.reEngagement.slice(0, 5).forEach((lead, i) => {
      const days = Math.round(lead.days_since_reply);
      console.log(`   ${i + 1}. ${lead.name} | ${lead.reply_sentiment} | ${days} days ago`);
    });
    console.log(`   ... and ${Math.max(0, audit.reEngagement.length - 5)} more`);
  } else {
    console.log('   None currently');
  }
  console.log('');

  return audit;
}

async function main() {
  const client = await pool.connect();

  try {
    const audit = await auditConversations(client);
    generateAuditReport(audit);

    // Save audit data
    const fs = await import('fs');
    const auditPath = 'reports/conversation-audit.json';

    if (!fs.existsSync('reports')) fs.mkdirSync('reports');

    fs.writeFileSync(auditPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        hotLeads: audit.hotLeads.length,
        readyToClose: audit.readyToClose.length,
        objectionHandling: audit.objectionHandling.length,
        stalled: audit.stalled.length,
        reEngagement: audit.reEngagement.length
      },
      data: audit
    }, null, 2));

    console.log(`\nAudit saved: ${auditPath}`);
    process.exit(0);

  } catch (error) {
    console.error('\n💥 ERROR:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
