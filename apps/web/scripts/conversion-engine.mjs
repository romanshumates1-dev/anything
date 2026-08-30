#!/usr/bin/env node
/**
 * conversion-engine.mjs
 * DEAL PROGRESSION - Move conversations toward closing
 *
 * Optimizes: negotiation, follow-up, qualification, closing
 * NO new systems - only conversation optimization
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

console.log('💰 CONVERSION ENGINE');
console.log('='.repeat(70));
console.log('');

// ============ OPTIMIZED CLOSING PROMPTS ============

const CLOSING_PROMPTS = {
  // For positive signals - push toward appointment
  scheduleAppointment: (lead) => `${lead.name}, great to hear you're interested!

Let's lock in a time. I have availability:
• Tomorrow ${getTimeSlot('tomorrow')}
• ${getDayName(2)} ${getTimeSlot('day2')}

Which works better? I'll come to ${lead.address?.split(',')[0] || 'the property'} - takes 15 minutes.`,

  // For "thinking about it" - create urgency without pressure
  gentleUrgency: (lead) => `${lead.name}, totally understand you need time.

Quick heads up: I'm actively buying in your area this month. My offer of ${formatOffer(lead)} is good for the next 7 days.

No pressure - but if timing matters, sooner is better. Want me to hold that price for you?`,

  // For objection on price - value reframe
  priceReframe: (lead) => `${lead.name}, I hear you on the price.

Let me break down why ${formatOffer(lead)} makes sense:
• Traditional sale: 6% agent fees + 2-3% closing costs + repairs + 60-90 day wait
• My offer: Zero fees, I pay closing, as-is, 7 days

Net-net, you're often within 5% - but 3 months faster with zero hassle.

What if I could stretch to ${formatStretchOffer(lead)}? Would that work?`,

  // For competitor pressure - differentiate
  competitorResponse: (lead) => `${lead.name}, competition is good - means your property has value.

Here's what I'd ask the other buyer:
• Are they cash or financing? (30% of financed deals fall through)
• What's their inspection contingency? (Most demand repairs)
• What's the actual close date? (Most take 45-60 days)

I'm cash, no contingencies, 7 days. If their deal gets shaky, call me first?`,

  // For proof of funds request - build trust fast
  proofOfFunds: (lead) => `Smart question, ${lead.name}. Here's my proof:

1. Bank letter showing cash available - I'll email it in 5 minutes
2. 3 recent closings I did (with seller permission)
3. My title company's direct line - they'll vouch for me

Which would help most? I'll send it right now.`,

  // For stalled conversations - soft re-engage
  reEngagement: (lead) => `Hi ${lead.name}, checking in on ${lead.address?.split(',')[0] || 'your property'}.

Still interested in my ${formatOffer(lead)} cash offer?

If anything changed on your end, no worries - just let me know either way.`,

  // For qualified leads - ask for the close
  askForClose: (lead) => `${lead.name}, sounds like we're aligned.

Here's what happens next:
1. I send a simple 2-page purchase agreement
2. You review and sign (no obligation until signed)
3. We pick a closing date (as fast as 7 days)

Ready for me to send the paperwork?`
};

// ============ HELPERS ============

function formatOffer(lead) {
  const min = lead.offer_min || 150000;
  const max = lead.offer_max || 175000;
  return `$${Math.round(min/1000)}k-$${Math.round(max/1000)}k`;
}

function formatStretchOffer(lead) {
  const max = lead.offer_max || 175000;
  const stretch = Math.round(max * 1.05); // 5% stretch
  return `$${Math.round(stretch/1000)}k`;
}

function getTimeSlot(day) {
  const slots = ['2-3pm', '3-4pm', '4-5pm', '10-11am', '11am-12pm'];
  return slots[Math.floor(Math.random() * slots.length)];
}

function getDayName(daysAhead) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return days[d.getDay()];
}

// ============ CONVERSION LOGIC ============

function determineNextAction(lead) {
  const sentiment = lead.reply_sentiment;
  const hoursSinceReply = lead.hours_since_reply || 0;
  const status = lead.status;

  // Decision tree for next action
  if (sentiment === 'positive') {
    if (hoursSinceReply < 4) {
      return { action: 'scheduleAppointment', priority: 'HIGH', reason: 'Hot lead - strike while iron is hot' };
    } else if (hoursSinceReply < 24) {
      return { action: 'askForClose', priority: 'HIGH', reason: 'Positive signal - push for commitment' };
    } else if (hoursSinceReply < 72) {
      return { action: 'gentleUrgency', priority: 'MEDIUM', reason: 'Cooling off - create urgency' };
    } else {
      return { action: 'reEngagement', priority: 'LOW', reason: 'Gone cold - soft touch' };
    }
  }

  if (sentiment === 'objection') {
    return { action: 'priceReframe', priority: 'HIGH', reason: 'Objection = interest - handle it' };
  }

  if (sentiment === 'question') {
    return { action: 'proofOfFunds', priority: 'HIGH', reason: 'Asking questions = qualifying you' };
  }

  if (sentiment === 'neutral') {
    if (hoursSinceReply < 48) {
      return { action: 'gentleUrgency', priority: 'MEDIUM', reason: 'On the fence - nudge' };
    } else {
      return { action: 'reEngagement', priority: 'LOW', reason: 'Went quiet - re-engage' };
    }
  }

  if (sentiment === 'negative') {
    return { action: 'none', priority: 'NONE', reason: 'Negative - respect their decision' };
  }

  return { action: 'reEngagement', priority: 'LOW', reason: 'Unknown state - soft check-in' };
}

async function processConversionQueue(client) {
  console.log('📋 Processing conversion queue...\n');

  // Get all active conversations
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
    WHERE clq.reply_sentiment IS NOT NULL
    AND clq.status NOT IN ('converted', 'dead', 'unsubscribed')
    ORDER BY
      CASE clq.reply_sentiment
        WHEN 'positive' THEN 1
        WHEN 'objection' THEN 2
        WHEN 'question' THEN 3
        WHEN 'neutral' THEN 4
        ELSE 5
      END,
      clq.last_reply_at DESC
    LIMIT 100
  `);

  const actionPlan = {
    HIGH: [],
    MEDIUM: [],
    LOW: [],
    NONE: []
  };

  for (const lead of leads) {
    const nextAction = determineNextAction(lead);
    const prompt = nextAction.action !== 'none'
      ? CLOSING_PROMPTS[nextAction.action]?.(lead) || 'No prompt'
      : null;

    actionPlan[nextAction.priority].push({
      lead,
      action: nextAction.action,
      reason: nextAction.reason,
      prompt: prompt?.substring(0, 100) + '...'
    });
  }

  return actionPlan;
}

function generateConversionReport(actionPlan) {
  console.log('='.repeat(70));
  console.log('💰 CONVERSION ACTION PLAN');
  console.log('='.repeat(70));
  console.log('');

  console.log('🔴 HIGH PRIORITY (act now):');
  if (actionPlan.HIGH.length > 0) {
    actionPlan.HIGH.slice(0, 10).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.lead.name}`);
      console.log(`      Sentiment: ${item.lead.reply_sentiment} | Action: ${item.action}`);
      console.log(`      Reason: ${item.reason}`);
      console.log(`      Response: "${item.prompt}"`);
      console.log('');
    });
    if (actionPlan.HIGH.length > 10) {
      console.log(`   ... and ${actionPlan.HIGH.length - 10} more HIGH priority`);
    }
  } else {
    console.log('   None\n');
  }

  console.log('🟡 MEDIUM PRIORITY (today):');
  console.log(`   ${actionPlan.MEDIUM.length} leads need follow-up`);
  if (actionPlan.MEDIUM.length > 0) {
    actionPlan.MEDIUM.slice(0, 3).forEach((item, i) => {
      console.log(`   - ${item.lead.name}: ${item.action} (${item.reason})`);
    });
  }
  console.log('');

  console.log('🟢 LOW PRIORITY (this week):');
  console.log(`   ${actionPlan.LOW.length} leads for re-engagement`);
  console.log('');

  console.log('⚫ NO ACTION:');
  console.log(`   ${actionPlan.NONE.length} leads (negative/unsubscribed)`);
  console.log('');

  // Summary
  const totalActive = actionPlan.HIGH.length + actionPlan.MEDIUM.length + actionPlan.LOW.length;

  console.log('-'.repeat(70));
  console.log('');
  console.log('📊 CONVERSION SUMMARY:');
  console.log(`   Total active opportunities: ${totalActive}`);
  console.log(`   High priority (close today): ${actionPlan.HIGH.length}`);
  console.log(`   Medium priority (follow up): ${actionPlan.MEDIUM.length}`);
  console.log(`   Low priority (re-engage): ${actionPlan.LOW.length}`);
  console.log('');

  // Specific actions
  console.log('🎯 IMMEDIATE ACTIONS:');
  console.log('');

  const scheduleCount = actionPlan.HIGH.filter(a => a.action === 'scheduleAppointment').length;
  const closeCount = actionPlan.HIGH.filter(a => a.action === 'askForClose').length;
  const objectionCount = actionPlan.HIGH.filter(a => a.action === 'priceReframe').length;

  if (scheduleCount > 0) console.log(`   📅 Schedule appointments: ${scheduleCount} leads`);
  if (closeCount > 0) console.log(`   ✍️ Ask for signature: ${closeCount} leads`);
  if (objectionCount > 0) console.log(`   🎯 Handle objections: ${objectionCount} leads`);

  console.log('');

  return {
    total: totalActive,
    high: actionPlan.HIGH.length,
    medium: actionPlan.MEDIUM.length,
    low: actionPlan.LOW.length
  };
}

async function main() {
  const client = await pool.connect();

  try {
    const actionPlan = await processConversionQueue(client);
    const summary = generateConversionReport(actionPlan);

    // Save action plan
    const fs = await import('fs');
    if (!fs.existsSync('reports')) fs.mkdirSync('reports');

    fs.writeFileSync('reports/conversion-plan.json', JSON.stringify({
      timestamp: new Date().toISOString(),
      summary,
      actions: {
        high: actionPlan.HIGH.map(a => ({ name: a.lead.name, action: a.action, reason: a.reason })),
        medium: actionPlan.MEDIUM.length,
        low: actionPlan.LOW.length
      }
    }, null, 2));

    console.log('Plan saved: reports/conversion-plan.json');
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
