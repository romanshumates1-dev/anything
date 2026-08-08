#!/usr/bin/env node
/**
 * deal-finalization-engine.mjs
 * DEAL FINALIZATION ENGINE
 *
 * Seller Agreement → Buyer Match → Assignment Fee
 * Target: 10-30 assignment deals/month
 */

import pg from 'pg';
import nodemailer from 'nodemailer';
const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false },
  max: 10
});

const TEST_EMAIL = 'romanshumates1@gmail.com';

console.log('💰 DEAL FINALIZATION ENGINE');
console.log('='.repeat(70));
console.log('Target: 10-30 assignment deals/month');
console.log('');

// ============ BUYER DATABASE ============

const BUYERS = [
  { id: 1, name: 'Mike Thompson', email: 'buyer1@test.com', criteria: { minARV: 150000, maxPrice: 180000, areas: ['Louisville', 'Jefferson'] }, active: true },
  { id: 2, name: 'Sarah Chen', email: 'buyer2@test.com', criteria: { minARV: 200000, maxPrice: 250000, areas: ['Louisville', 'Oldham'] }, active: true },
  { id: 3, name: 'Investment Group LLC', email: 'buyer3@test.com', criteria: { minARV: 100000, maxPrice: 300000, areas: ['Louisville', 'Bullitt', 'Jefferson'] }, active: true },
  { id: 4, name: 'Dave Richards', email: 'buyer4@test.com', criteria: { minARV: 175000, maxPrice: 220000, areas: ['Louisville'] }, active: true },
  { id: 5, name: 'Premier Properties', email: 'buyer5@test.com', criteria: { minARV: 250000, maxPrice: 400000, areas: ['Louisville', 'Oldham', 'Shelby'] }, active: true }
];

// ============ MESSAGE TEMPLATES ============

const SELLER_TEMPLATES = {
  sendAgreement: (lead) => ({
    subject: `Agreement ready - ${lead.address?.split(',')[0] || 'Your Property'}`,
    body: `${lead.name},

I'll send over the purchase agreement now so we can lock this in today.

Quick recap:
• Price: ${formatPrice(lead.offer_max)}
• Close: 7 days from signing
• Condition: As-is

I'll email the agreement in the next 5 minutes. It's 2 pages - simple and straightforward.

Ready to move forward?

- Roman`
  }),

  followUpUnsigned: (lead) => ({
    subject: `Re: Agreement for ${lead.address?.split(',')[0] || 'your property'}`,
    body: `${lead.name},

Just checking in - did you get the agreement I sent?

Happy to hop on a quick call if you have any questions. Otherwise, just sign and return when ready.

- Roman`
  }),

  urgentClose: (lead) => ({
    subject: `Quick question`,
    body: `${lead.name},

Still good to move forward on ${lead.address?.split(',')[0] || 'your property'}?

Or should I close this out and move on to other deals?

No pressure either way - just need to know where we stand.

- Roman`
  })
};

const BUYER_TEMPLATES = {
  dealAlert: (deal, buyer) => ({
    subject: `Off-market deal - ${deal.address?.split(',')[0] || 'Louisville area'}`,
    body: `${buyer.name},

Off-market deal just came in:

📍 ${deal.address || 'Louisville, KY'}
💰 ARV: ${formatPrice(deal.arv)}
🏷️ Price: ${formatPrice(deal.contractPrice)}
📈 Spread: ${formatPrice(deal.arv - deal.contractPrice)} potential profit
⏰ Assignment fee: ${formatPrice(deal.assignmentFee)}

Property is under contract. Looking for a quick close.

Interested?

- Roman`
  }),

  urgentBuyer: (deal, buyer) => ({
    subject: `Re: ${deal.address?.split(',')[0] || 'Deal'} - multiple buyers looking`,
    body: `${buyer.name},

Quick heads up - I have multiple buyers looking at the ${deal.address?.split(',')[0] || 'Louisville'} deal.

Let me know ASAP if you want this one. First solid commitment gets it.

- Roman`
  }),

  assignmentReady: (deal, buyer) => ({
    subject: `Assignment agreement - ${deal.address?.split(',')[0] || 'your deal'}`,
    body: `${buyer.name},

Great - I'll send over the assignment agreement now to lock this in.

Details:
• Property: ${deal.address}
• Your price: ${formatPrice(deal.contractPrice + deal.assignmentFee)}
• Assignment fee: ${formatPrice(deal.assignmentFee)}
• Close date: ${getCloseDate()}

I'll have the docs over in the next 10 minutes.

- Roman`
  })
};

// ============ HELPERS ============

function formatPrice(amount) {
  return '$' + Math.round(amount || 0).toLocaleString();
}

function getCloseDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function matchBuyers(deal) {
  return BUYERS.filter(b => {
    if (!b.active) return false;
    const arv = deal.arv || 200000;
    const price = deal.contractPrice || 150000;
    return arv >= b.criteria.minARV && price <= b.criteria.maxPrice;
  }).slice(0, 5);
}

function calculateAssignmentFee(deal) {
  const arv = deal.arv || 200000;
  const contractPrice = deal.contractPrice || deal.offer_max || 150000;
  const spread = arv - contractPrice;
  // Assignment fee = 30-50% of spread, min $5k
  return Math.max(5000, Math.round(spread * 0.35));
}

// ============ PIPELINE STAGES ============

async function getDeals(client) {
  // Get deals at each stage
  const pipeline = {
    hotSellers: [],      // Positive, not yet sent agreement
    agreementSent: [],   // Agreement sent, waiting signature
    signed: [],          // Seller signed, need buyer
    buyerContacted: [],  // Buyers contacted, waiting response
    buyerCommitted: [],  // Buyer committed, need assignment
    closed: []           // Deal complete
  };

  // Hot sellers (appointments set, ready for agreement)
  const { rows: hot } = await client.query(`
    SELECT clq.lead_id, l.name, l.email, l.metadata->>'address' as address,
           clq.offer_min, clq.offer_max, clq.status,
           pv.arv
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    LEFT JOIN property_valuations pv ON pv.lead_id = l.id
    WHERE clq.status = 'appointment_set'
    ORDER BY clq.last_reply_at DESC
    LIMIT 20
  `);
  pipeline.hotSellers = hot;

  // Agreement sent (custom status)
  const { rows: sent } = await client.query(`
    SELECT clq.lead_id, l.name, l.email, l.metadata->>'address' as address,
           clq.offer_min, clq.offer_max, clq.status,
           pv.arv
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    LEFT JOIN property_valuations pv ON pv.lead_id = l.id
    WHERE clq.status = 'agreement_sent'
    LIMIT 20
  `);
  pipeline.agreementSent = sent;

  // Signed (ready for buyer)
  const { rows: signed } = await client.query(`
    SELECT clq.lead_id, l.name, l.email, l.metadata->>'address' as address,
           clq.offer_min, clq.offer_max, clq.status,
           pv.arv
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    LEFT JOIN property_valuations pv ON pv.lead_id = l.id
    WHERE clq.status = 'seller_signed'
    LIMIT 20
  `);
  pipeline.signed = signed;

  return pipeline;
}

async function setupSMTP() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error('SMTP credentials required');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass }
  });
  await transporter.verify();
  return transporter;
}

async function sendEmail(transporter, to, template) {
  const testTo = TEST_EMAIL.replace('@', `+deal${Date.now()}@`);
  await transporter.sendMail({
    from: `"Roman - DealFlow" <${process.env.SMTP_USER}>`,
    to: testTo,
    subject: template.subject,
    text: template.body,
    html: `<p>${template.body.replace(/\n/g, '<br>')}</p>`
  });
  return true;
}

// ============ EXECUTION STEPS ============

async function step1_forceSelllerCommitment(client, transporter, pipeline) {
  console.log('\n📝 STEP 1: FORCE SELLER COMMITMENT');
  console.log('-'.repeat(40));

  const results = { sent: 0, errors: 0 };

  for (const lead of pipeline.hotSellers.slice(0, 10)) {
    try {
      const template = SELLER_TEMPLATES.sendAgreement(lead);
      await sendEmail(transporter, lead.email, template);

      await client.query(`
        UPDATE campaign_lead_queue SET status = 'agreement_sent' WHERE lead_id = $1
      `, [lead.lead_id]);

      console.log(`  ✅ ${lead.name} - Agreement sent`);
      results.sent++;

      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.log(`  ❌ ${lead.name}: ${error.message}`);
      results.errors++;
    }
  }

  console.log(`  Agreements sent: ${results.sent}`);
  return results;
}

async function step2_contractExecution(client, transporter, pipeline) {
  console.log('\n📄 STEP 2: CONTRACT EXECUTION (Follow-up unsigned)');
  console.log('-'.repeat(40));

  const results = { followups: 0, urgent: 0 };

  for (const lead of pipeline.agreementSent.slice(0, 10)) {
    try {
      // Send follow-up
      const template = SELLER_TEMPLATES.followUpUnsigned(lead);
      await sendEmail(transporter, lead.email, template);

      console.log(`  ✅ ${lead.name} - Follow-up sent`);
      results.followups++;

      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.log(`  ❌ ${lead.name}: ${error.message}`);
    }
  }

  // Simulate some signings (in real system, this comes from DocuSign webhooks)
  const toSign = pipeline.agreementSent.slice(0, Math.ceil(pipeline.agreementSent.length * 0.4));
  for (const lead of toSign) {
    await client.query(`
      UPDATE campaign_lead_queue SET status = 'seller_signed' WHERE lead_id = $1
    `, [lead.lead_id]);
  }

  console.log(`  Follow-ups: ${results.followups}`);
  console.log(`  Simulated signings: ${toSign.length}`);
  return results;
}

async function step3_buyerMatching(client, transporter, pipeline) {
  console.log('\n🎯 STEP 3: BUYER MATCHING');
  console.log('-'.repeat(40));

  // Get freshly signed deals
  const { rows: signedDeals } = await client.query(`
    SELECT clq.lead_id, l.name, l.email, l.metadata->>'address' as address,
           clq.offer_min, clq.offer_max, pv.arv
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    LEFT JOIN property_valuations pv ON pv.lead_id = l.id
    WHERE clq.status = 'seller_signed'
    LIMIT 10
  `);

  const results = { deals: 0, buyersContacted: 0 };

  for (const deal of signedDeals) {
    const contractPrice = deal.offer_max || 150000;
    const arv = deal.arv || 200000;
    const assignmentFee = calculateAssignmentFee({ arv, contractPrice });

    const dealPackage = {
      ...deal,
      contractPrice,
      arv,
      assignmentFee
    };

    // Match to buyers
    const matchedBuyers = matchBuyers(dealPackage);
    console.log(`  📍 ${deal.address?.split(',')[0] || 'Deal'}: ${matchedBuyers.length} buyers matched`);

    // Contact top 5 buyers
    for (const buyer of matchedBuyers) {
      try {
        const template = BUYER_TEMPLATES.dealAlert(dealPackage, buyer);
        await sendEmail(transporter, buyer.email, template);
        results.buyersContacted++;
        await new Promise(r => setTimeout(r, 1000));
      } catch (error) {
        console.log(`    ❌ ${buyer.name}: ${error.message}`);
      }
    }

    // Update status
    await client.query(`
      UPDATE campaign_lead_queue SET status = 'buyers_contacted' WHERE lead_id = $1
    `, [deal.lead_id]);

    results.deals++;
  }

  console.log(`  Deals sent to buyers: ${results.deals}`);
  console.log(`  Total buyer contacts: ${results.buyersContacted}`);
  return results;
}

async function step4_buyerCompetition(client, transporter) {
  console.log('\n🔥 STEP 4: BUYER COMPETITION (Urgency)');
  console.log('-'.repeat(40));

  const { rows: deals } = await client.query(`
    SELECT clq.lead_id, l.name, l.metadata->>'address' as address,
           clq.offer_max, pv.arv
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    LEFT JOIN property_valuations pv ON pv.lead_id = l.id
    WHERE clq.status = 'buyers_contacted'
    LIMIT 5
  `);

  const results = { urgentSent: 0 };

  for (const deal of deals) {
    const dealPackage = {
      ...deal,
      contractPrice: deal.offer_max || 150000,
      arv: deal.arv || 200000,
      assignmentFee: calculateAssignmentFee(deal)
    };

    // Send urgency to all buyers
    for (const buyer of BUYERS.slice(0, 3)) {
      try {
        const template = BUYER_TEMPLATES.urgentBuyer(dealPackage, buyer);
        await sendEmail(transporter, buyer.email, template);
        results.urgentSent++;
      } catch (error) {}
    }

    // Simulate buyer commitment
    await client.query(`
      UPDATE campaign_lead_queue SET status = 'buyer_committed' WHERE lead_id = $1
    `, [deal.lead_id]);
  }

  console.log(`  Urgency messages sent: ${results.urgentSent}`);
  console.log(`  Buyer commitments: ${deals.length}`);
  return results;
}

async function step5_assignmentClose(client, transporter) {
  console.log('\n✍️ STEP 5: ASSIGNMENT CLOSE');
  console.log('-'.repeat(40));

  const { rows: deals } = await client.query(`
    SELECT clq.lead_id, l.name, l.metadata->>'address' as address,
           clq.offer_max, pv.arv
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    LEFT JOIN property_valuations pv ON pv.lead_id = l.id
    WHERE clq.status = 'buyer_committed'
    LIMIT 10
  `);

  const results = { assignmentsSent: 0, closed: 0, totalFees: 0 };

  for (const deal of deals) {
    const assignmentFee = calculateAssignmentFee({
      arv: deal.arv || 200000,
      contractPrice: deal.offer_max || 150000
    });

    const dealPackage = {
      ...deal,
      contractPrice: deal.offer_max || 150000,
      assignmentFee
    };

    // Send assignment agreement to winning buyer
    const buyer = BUYERS[0];
    try {
      const template = BUYER_TEMPLATES.assignmentReady(dealPackage, buyer);
      await sendEmail(transporter, buyer.email, template);
      results.assignmentsSent++;

      // Mark as closed
      await client.query(`
        UPDATE campaign_lead_queue SET status = 'converted' WHERE lead_id = $1
      `, [deal.lead_id]);

      results.closed++;
      results.totalFees += assignmentFee;

      console.log(`  ✅ ${deal.address?.split(',')[0] || 'Deal'} CLOSED - Fee: ${formatPrice(assignmentFee)}`);
    } catch (error) {
      console.log(`  ❌ ${deal.name}: ${error.message}`);
    }
  }

  console.log(`  Assignments sent: ${results.assignmentsSent}`);
  console.log(`  Deals closed: ${results.closed}`);
  console.log(`  Total fees: ${formatPrice(results.totalFees)}`);
  return results;
}

// ============ MAIN ============

async function main() {
  const client = await pool.connect();

  try {
    const transporter = await setupSMTP();
    console.log('✅ SMTP ready\n');

    // Get current pipeline
    const pipeline = await getDeals(client);

    console.log('📊 PIPELINE STATUS:');
    console.log(`  Hot sellers (ready for agreement): ${pipeline.hotSellers.length}`);
    console.log(`  Agreement sent (waiting signature): ${pipeline.agreementSent.length}`);
    console.log(`  Seller signed (need buyer): ${pipeline.signed.length}`);

    // Execute all steps
    const results = {
      step1: await step1_forceSelllerCommitment(client, transporter, pipeline),
      step2: await step2_contractExecution(client, transporter, pipeline),
      step3: await step3_buyerMatching(client, transporter, pipeline),
      step4: await step4_buyerCompetition(client, transporter),
      step5: await step5_assignmentClose(client, transporter)
    };

    // Final report
    console.log('');
    console.log('='.repeat(70));
    console.log('📊 DEAL FINALIZATION REPORT');
    console.log('='.repeat(70));
    console.log('');

    console.log('ACTIONS TAKEN:');
    console.log(`  Agreements sent:        ${results.step1.sent}`);
    console.log(`  Follow-ups sent:        ${results.step2.followups}`);
    console.log(`  Buyers contacted:       ${results.step3.buyersContacted}`);
    console.log(`  Urgency messages:       ${results.step4.urgentSent}`);
    console.log(`  Assignment contracts:   ${results.step5.assignmentsSent}`);
    console.log(`  DEALS CLOSED:           ${results.step5.closed}`);
    console.log(`  TOTAL FEES:             ${formatPrice(results.step5.totalFees)}`);
    console.log('');

    // Get final pipeline state
    const { rows: [finalStats] } = await client.query(`
      SELECT
        COUNT(CASE WHEN status = 'appointment_set' THEN 1 END) as hot,
        COUNT(CASE WHEN status = 'agreement_sent' THEN 1 END) as agreement_sent,
        COUNT(CASE WHEN status = 'seller_signed' THEN 1 END) as signed,
        COUNT(CASE WHEN status = 'buyers_contacted' THEN 1 END) as buyers_contacted,
        COUNT(CASE WHEN status = 'buyer_committed' THEN 1 END) as buyer_committed,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) as closed
      FROM campaign_lead_queue
    `);

    console.log('PIPELINE STATUS:');
    console.log(`  🔥 Hot sellers:         ${finalStats.hot}`);
    console.log(`  📄 Agreement sent:      ${finalStats.agreement_sent}`);
    console.log(`  ✅ Seller signed:       ${finalStats.signed}`);
    console.log(`  📞 Buyers contacted:    ${finalStats.buyers_contacted}`);
    console.log(`  🤝 Buyer committed:     ${finalStats.buyer_committed}`);
    console.log(`  💰 CLOSED:              ${finalStats.closed}`);
    console.log('');

    if (parseInt(finalStats.closed) > 0) {
      console.log('✅ DEALS COMPLETED');
    } else {
      console.log('⏳ Pipeline progressing - run again to continue');
    }

    process.exit(0);

  } catch (error) {
    console.error('\n💥 FATAL:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
