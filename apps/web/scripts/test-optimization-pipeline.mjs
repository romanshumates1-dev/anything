#!/usr/bin/env node
/**
 * Direct pipeline test - bypasses auth to verify orchestrator and agents work
 */

import { neon } from '@neondatabase/serverless';

// Mock the sql export that orchestrator imports
const sql = neon(process.env.DATABASE_URL);
global.sql = sql;

// Dynamically import orchestrator after setting up global
const { SimpleOrchestrator } = await import('../src/app/api/optimization/orchestrator.ts');

async function testPipeline() {
  console.log('Testing optimization pipeline...\n');

  const testLeadIds = [106, 107, 108, 109, 110];

  console.log('Step 1: Check initial database state');
  const before = {
    scores: await sql`SELECT COUNT(*) FROM lead_scores`,
    valuations: await sql`SELECT COUNT(*) FROM property_valuations`,
    probs: await sql`SELECT COUNT(*) FROM deal_probabilities`,
    actions: await sql`SELECT COUNT(*) FROM lead_actions WHERE status = 'pending'`
  };
  console.log('  Scores:', before.scores[0].count);
  console.log('  Valuations:', before.valuations[0].count);
  console.log('  Probabilities:', before.probs[0].count);
  console.log('  Actions (pending):', before.actions[0].count);

  console.log('\nStep 2: Process batch of 5 test leads');
  const orchestrator = new SimpleOrchestrator();

  try {
    await orchestrator.processBatch(testLeadIds);
    console.log('  ✓ Batch processing completed');
  } catch (error) {
    console.error('  ✗ Batch processing failed:', error.message);
    process.exit(1);
  }

  console.log('\nStep 3: Verify database was populated');
  const after = {
    scores: await sql`SELECT COUNT(*) FROM lead_scores WHERE lead_id IN (${sql(testLeadIds)})`,
    valuations: await sql`SELECT COUNT(*) FROM property_valuations WHERE lead_id IN (${sql(testLeadIds)})`,
    probs: await sql`SELECT COUNT(*) FROM deal_probabilities WHERE lead_id IN (${sql(testLeadIds)})`,
    actions: await sql`SELECT COUNT(*) FROM lead_actions WHERE lead_id IN (${sql(testLeadIds)}) AND status = 'pending'`
  };

  console.log('  Scores:', after.scores[0].count);
  console.log('  Valuations:', after.valuations[0].count);
  console.log('  Probabilities:', after.probs[0].count);
  console.log('  Actions (pending):', after.actions[0].count);

  // Verify all expected records exist
  const expectedCount = testLeadIds.length;
  let allPassed = true;

  if (parseInt(after.scores[0].count) !== expectedCount) {
    console.error(`  ✗ Expected ${expectedCount} scores, got ${after.scores[0].count}`);
    allPassed = false;
  } else {
    console.log('  ✓ All leads have scores');
  }

  if (parseInt(after.valuations[0].count) !== expectedCount) {
    console.error(`  ✗ Expected ${expectedCount} valuations, got ${after.valuations[0].count}`);
    allPassed = false;
  } else {
    console.log('  ✓ All leads have valuations');
  }

  if (parseInt(after.probs[0].count) !== expectedCount) {
    console.error(`  ✗ Expected ${expectedCount} probabilities, got ${after.probs[0].count}`);
    allPassed = false;
  } else {
    console.log('  ✓ All leads have probabilities');
  }

  if (parseInt(after.actions[0].count) === 0) {
    console.error('  ✗ Expected some pending actions, got 0');
    allPassed = false;
  } else {
    console.log(`  ✓ ${after.actions[0].count} pending actions created`);
  }

  console.log('\nStep 4: Sample output from each table');

  // Show one score
  const [sampleScore] = await sql`
    SELECT lead_id, motivation_score, urgency_score, financial_score, overall_score
    FROM lead_scores
    WHERE lead_id IN (${sql(testLeadIds)})
    LIMIT 1
  `;
  console.log('  Sample score:', JSON.stringify(sampleScore, null, 2));

  // Show one valuation
  const [sampleVal] = await sql`
    SELECT lead_id, arv, repair_cost, confidence
    FROM property_valuations
    WHERE lead_id IN (${sql(testLeadIds)})
    LIMIT 1
  `;
  console.log('  Sample valuation:', JSON.stringify(sampleVal, null, 2));

  // Show one probability
  const [sampleProb] = await sql`
    SELECT lead_id, close_probability, expected_value
    FROM deal_probabilities
    WHERE lead_id IN (${sql(testLeadIds)})
    LIMIT 1
  `;
  console.log('  Sample probability:', JSON.stringify(sampleProb, null, 2));

  // Show one action
  const [sampleAction] = await sql`
    SELECT lead_id, action_type, priority, rationale
    FROM lead_actions
    WHERE lead_id IN (${sql(testLeadIds)})
    LIMIT 1
  `;
  console.log('  Sample action:', JSON.stringify(sampleAction, null, 2));

  if (allPassed) {
    console.log('\n✅ Pipeline verification PASSED');
    console.log('\nNext steps:');
    console.log('1. View dashboard: http://localhost:4000/optimization/dashboard');
    console.log('2. Verify KPI bar shows counts > 0');
    console.log('3. Verify deal table shows 5 leads sorted by EV');
    console.log('4. Verify action queue shows pending actions');
    process.exit(0);
  } else {
    console.log('\n❌ Pipeline verification FAILED');
    process.exit(1);
  }
}

testPipeline().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
