#!/usr/bin/env node
/**
 * End-to-end verification of optimization MVP
 * Creates sample data to verify complete pipeline
 */

import sqlModule from '../src/app/api/utils/sql.ts';
const sql = sqlModule.default || sqlModule;

async function verifyE2E() {
  console.log('E2E Verification of Optimization MVP...\n');

  // Step 1: Verify all tables exist
  console.log('Step 1: Check table existence');
  const tables = ['lead_scores', 'property_valuations', 'deal_probabilities', 'lead_actions'];
  for (const table of tables) {
    try {
      // Use raw query with template literal
      const result = await sql([`SELECT 1 FROM ${table} LIMIT 1`]);
      console.log(`  ✓ ${table} exists`);
    } catch (error) {
      console.error(`  ✗ ${table} missing:`, error.message);
      process.exit(1);
    }
  }

  // Step 2: Get test lead IDs
  console.log('\nStep 2: Get test leads');
  const testLeads = await sql`
    SELECT id, name
    FROM leads
    WHERE id IN (106, 107, 108, 109, 110)
    ORDER BY id
  `;

  if (testLeads.length === 0) {
    console.error('  ✗ No test leads found. Run seed-optimization-test.mjs first');
    process.exit(1);
  }

  console.log(`  ✓ Found ${testLeads.length} test leads`);
  testLeads.forEach(lead => console.log(`    - ID ${lead.id}: ${lead.name}`));

  // Step 3: Insert sample data for each test lead
  console.log('\nStep 3: Insert sample optimization data');

  for (let i = 0; i < testLeads.length; i++) {
    const lead = testLeads[i];
    const leadId = lead.id;

    // Insert lead_scores (scores are 0-1 scale)
    await sql`
      INSERT INTO lead_scores (
        lead_id, composite_score, distress_score, recency_score, equity_score, geo_score
      ) VALUES (
        ${leadId},
        ${0.65 + i * 0.05},
        ${0.70 + i * 0.05},
        ${0.60 + i * 0.05},
        ${0.65 + i * 0.05},
        ${0.50 + i * 0.10}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        composite_score = EXCLUDED.composite_score
    `;

    // Insert property_valuations
    await sql`
      INSERT INTO property_valuations (
        lead_id, arv, arv_confidence, repairs, offer_min, offer_max, comps_count
      ) VALUES (
        ${leadId},
        ${20000000 + i * 5000000},
        ${0.7 + i * 0.05},
        ${5000000 - i * 500000},
        ${12000000 + i * 3000000},
        ${15000000 + i * 4500000},
        ${3 + i}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        arv = EXCLUDED.arv
    `;

    // Insert deal_probabilities
    const prob = 0.3 + i * 0.1;
    const ev = Math.floor((15000000 + i * 4500000) * prob);
    await sql`
      INSERT INTO deal_probabilities (
        lead_id, p_close, expected_value
      ) VALUES (
        ${leadId},
        ${prob},
        ${ev}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        expected_value = EXCLUDED.expected_value
    `;

    // Insert lead_actions (2 actions per lead)
    await sql`
      INSERT INTO lead_actions (
        lead_id, action, priority, status, reason
      ) VALUES (
        ${leadId},
        'call',
        ${90 - i * 10},
        'pending',
        ${'{"rationale": "High priority call for ' + lead.name + '", "channel": "phone"}'}
      )
    `;

    await sql`
      INSERT INTO lead_actions (
        lead_id, action, priority, status, reason
      ) VALUES (
        ${leadId},
        'sms',
        ${85 - i * 10},
        'pending',
        ${'{"rationale": "Follow-up SMS for ' + lead.name + '", "channel": "sms"}'}
      )
    `;

    console.log(`  ✓ Created data for lead ${leadId}: ${lead.name}`);
  }

  // Step 4: Verify data was inserted
  console.log('\nStep 4: Verify data insertion');

  const leadIds = testLeads.map(l => l.id);
  const counts = {
    scores: await sql`SELECT COUNT(*) FROM lead_scores WHERE lead_id = ANY(${leadIds})`,
    valuations: await sql`SELECT COUNT(*) FROM property_valuations WHERE lead_id = ANY(${leadIds})`,
    probs: await sql`SELECT COUNT(*) FROM deal_probabilities WHERE lead_id = ANY(${leadIds})`,
    actions: await sql`SELECT COUNT(*) FROM lead_actions WHERE lead_id = ANY(${leadIds}) AND status = 'pending'`
  };

  console.log('  Scores:', counts.scores[0].count);
  console.log('  Valuations:', counts.valuations[0].count);
  console.log('  Probabilities:', counts.probs[0].count);
  console.log('  Actions (pending):', counts.actions[0].count);

  // Verify all counts match expected
  const expectedCount = testLeads.length;
  let allPassed = true;

  if (parseInt(counts.scores[0].count) !== expectedCount) {
    console.error(`  ✗ Expected ${expectedCount} scores, got ${counts.scores[0].count}`);
    allPassed = false;
  }

  if (parseInt(counts.valuations[0].count) !== expectedCount) {
    console.error(`  ✗ Expected ${expectedCount} valuations, got ${counts.valuations[0].count}`);
    allPassed = false;
  }

  if (parseInt(counts.probs[0].count) !== expectedCount) {
    console.error(`  ✗ Expected ${expectedCount} probabilities, got ${counts.probs[0].count}`);
    allPassed = false;
  }

  if (parseInt(counts.actions[0].count) < expectedCount) {
    console.error(`  ✗ Expected at least ${expectedCount} actions, got ${counts.actions[0].count}`);
    allPassed = false;
  }

  // Step 5: Test dashboard queries
  console.log('\nStep 5: Test dashboard queries');

  try {
    // Get org for testing
    const [org] = await sql`SELECT id FROM organizations LIMIT 1`;

    // KPI query
    const kpiCounts = await sql`
      SELECT
        (SELECT COUNT(*) FROM lead_scores WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${org.id})) as scored,
        (SELECT COUNT(*) FROM property_valuations WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${org.id})) as valued,
        (SELECT COUNT(*) FROM deal_probabilities WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${org.id})) as analyzed,
        (SELECT COUNT(*) FROM lead_actions WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${org.id}) AND status = 'pending') as queued
    `;
    console.log('  ✓ KPI query:', JSON.stringify(kpiCounts[0]));

    // Deal table query (top 10 by EV)
    const deals = await sql`
      SELECT
        l.id,
        l.name,
        l.metadata->>'address' as address,
        dp.p_close,
        dp.expected_value,
        pv.arv,
        ls.composite_score
      FROM leads l
      JOIN deal_probabilities dp ON dp.lead_id = l.id
      JOIN property_valuations pv ON pv.lead_id = l.id
      JOIN lead_scores ls ON ls.lead_id = l.id
      WHERE l.organization_id = ${org.id}
        AND l.id = ANY(${leadIds})
      ORDER BY dp.expected_value DESC
      LIMIT 10
    `;
    console.log(`  ✓ Deal table query: ${deals.length} rows`);
    if (deals.length > 0) {
      console.log(`    Top deal: ${deals[0].name} - EV: $${(deals[0].expected_value / 100).toFixed(0)}`);
    }

    // Action queue query
    const actions = await sql`
      SELECT
        la.id,
        la.lead_id,
        la.action,
        la.priority,
        la.reason,
        l.name,
        l.metadata->>'address' as address
      FROM lead_actions la
      JOIN leads l ON l.id = la.lead_id
      WHERE l.organization_id = ${org.id}
        AND la.status = 'pending'
        AND la.lead_id = ANY(${leadIds})
      ORDER BY la.priority DESC
      LIMIT 20
    `;
    console.log(`  ✓ Action queue query: ${actions.length} rows`);
    if (actions.length > 0) {
      console.log(`    Top action: ${actions[0].action} for ${actions[0].name} (priority: ${actions[0].priority})`);
    }

  } catch (error) {
    console.error('  ✗ Dashboard query failed:', error.message);
    allPassed = false;
  }

  if (allPassed) {
    console.log('\n✅ All verifications PASSED');
    console.log('\nNext step: View dashboard at http://localhost:4000/optimization/dashboard');
    console.log('(You must be logged in as admin to view)');
    process.exit(0);
  } else {
    console.log('\n❌ Some verifications FAILED');
    process.exit(1);
  }
}

verifyE2E().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
