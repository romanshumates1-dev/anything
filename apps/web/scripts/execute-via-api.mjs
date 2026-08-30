#!/usr/bin/env node
/**
 * execute-via-api.mjs - HARD DEADLINE MODE
 * Executes campaign via Next.js API (bypasses SSL issues)
 * MAX 10 leads, captures ALL outputs
 */

const API = 'http://localhost:4000';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-local-dev': 'true'  // Auth bypass
};

const state = {
  startTime: Date.now(),
  leadsProcessed: 0,
  emailsSent: 0,
  errors: [],
  outputs: []
};

async function call(endpoint, body = {}) {
  const start = Date.now();
  try {
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body)
    });

    const duration = Date.now() - start;
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.substring(0, 500) };
    }

    const result = {
      endpoint,
      status: res.status,
      duration,
      success: res.ok,
      data
    };

    state.outputs.push(result);

    if (!res.ok) {
      state.errors.push(`${endpoint}: HTTP ${res.status}`);
      console.error(`❌ ${endpoint}: ${res.status}`);
      console.error(`   ${text.substring(0, 200)}`);
    } else {
      console.log(`✅ ${endpoint}: ${res.status} (${duration}ms)`);
    }

    return result;

  } catch (error) {
    state.errors.push(`${endpoint}: ${error.message}`);
    console.error(`❌ ${endpoint}: ${error.message}`);
    return { endpoint, success: false, error: error.message };
  }
}

async function main() {
  console.log('🔥 HARD DEADLINE EXECUTION - CYCLE 1');
  console.log('='.repeat(70));
  console.log(`Time: ${new Date().toLocaleTimeString()}`);
  console.log('Limit: 10 leads MAX');
  console.log('');

  // PHASE 1: Optimization
  console.log('📋 PHASE 1: Optimization Pipeline\n');
  const opt = await call('/api/optimization/process', { batchSize: 10 });
  if (opt.success) {
    state.leadsProcessed = opt.data?.processed || 0;
    console.log(`   Processed: ${state.leadsProcessed} leads\n`);
  }

  // PHASE 2: Campaign Plan
  console.log('📋 PHASE 2: Campaign Planning\n');
  const plan = await call('/api/campaigns/orchestrator/daily-plan', { dryRun: false });
  if (plan.success) {
    console.log(`   Queued: ${plan.data?.queued || 0} leads\n`);
  }

  // PHASE 3: Send
  console.log('📋 PHASE 3: Campaign Send\n');
  const send = await call('/api/campaigns/orchestrator/execute-sends');
  if (send.success) {
    state.emailsSent = send.data?.sent || 0;
    console.log(`   Sent: ${state.emailsSent} emails\n`);
  }

  // REPORT
  const duration = (Date.now() - state.startTime) / 1000;
  console.log('');
  console.log('='.repeat(70));
  console.log('CYCLE 1 RESULTS');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Duration: ${duration.toFixed(1)}s`);
  console.log(`Leads Processed: ${state.leadsProcessed}`);
  console.log(`Emails Sent: ${state.emailsSent}`);
  console.log(`Errors: ${state.errors.length}`);
  console.log('');

  if (state.errors.length > 0) {
    console.log('ERRORS:');
    state.errors.forEach(e => console.log(`  - ${e}`));
    console.log('');
  }

  console.log('API CALLS:');
  state.outputs.forEach(o => {
    const icon = o.success ? '✅' : '❌';
    console.log(`  ${icon} ${o.endpoint}: ${o.status} (${o.duration}ms)`);
  });
  console.log('');

  // EXIT CODE
  if (state.errors.length > 0) {
    console.log('STATUS: ❌ FAILED - Errors encountered');
    process.exit(1);
  } else {
    console.log('STATUS: ✅ SUCCESS - All endpoints responded');
    process.exit(0);
  }
}

main();
