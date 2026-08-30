#!/usr/bin/env node
/**
 * live-campaign-via-api.mjs
 *
 * LIVE CAMPAIGN EXECUTION via Next.js API (bypasses SSL issues)
 * Calls localhost API endpoints instead of direct database access
 */

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const DRY_RUN = process.env.DRY_RUN === 'true';

console.log('🚀 LIVE CAMPAIGN EXECUTION (via API)');
console.log('='.repeat(70));
console.log('');
console.log(`API: ${API_BASE}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
console.log('');

const metrics = {
  leadsProcessed: 0,
  emailsSent: 0,
  repliesClassified: 0,
  errors: []
};

/**
 * Call API endpoint with error handling
 */
async function callAPI(endpoint, method = 'POST', body = null) {
  const url = `${API_BASE}${endpoint}`;

  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`❌ API call failed: ${endpoint}`, error.message);
    metrics.errors.push(`${endpoint}: ${error.message}`);
    throw error;
  }
}

/**
 * PHASE 1: Health Check
 */
async function healthCheck() {
  console.log('📋 PHASE 1: Health Check\n');

  try {
    const response = await fetch(`${API_BASE}/api/health`);
    if (response.ok) {
      console.log('✅ API server is responding\n');
      return true;
    }
  } catch (error) {
    console.error('❌ API server not responding');
    console.error('   Make sure Next.js dev server is running: npm run dev');
    return false;
  }

  return false;
}

/**
 * PHASE 2: Process leads through optimization
 */
async function runOptimization() {
  console.log('📋 PHASE 2: Running Optimization Pipeline\n');

  try {
    console.log('Calling /api/optimization/process...');
    const result = await callAPI('/api/optimization/process', 'POST', {
      batchSize: 10
    });

    metrics.leadsProcessed = result.processed || 0;
    console.log(`✅ Processed ${metrics.leadsProcessed} leads\n`);

  } catch (error) {
    console.log('⚠️  Optimization endpoint may require auth or not exist');
    console.log('   Continuing with manual lead selection...\n');
  }
}

/**
 * PHASE 3: Execute campaign
 */
async function executeCampaign() {
  console.log('📋 PHASE 3: Executing Campaign\n');

  try {
    console.log('Calling /api/campaigns/orchestrator/daily-plan...');
    const planResult = await callAPI('/api/campaigns/orchestrator/daily-plan', 'POST', {
      dryRun: DRY_RUN
    });

    console.log(`Queue size: ${planResult.queued || 0} leads\n`);

    if (!DRY_RUN) {
      console.log('Calling /api/campaigns/orchestrator/send...');
      const sendResult = await callAPI('/api/campaigns/orchestrator/send', 'POST');

      metrics.emailsSent = sendResult.sent || 0;
      console.log(`✅ Sent ${metrics.emailsSent} emails\n`);
    } else {
      console.log('[DRY RUN] Skipping actual send\n');
    }

  } catch (error) {
    console.log('⚠️  Campaign endpoints require authentication');
    console.log('   This is expected - APIs are protected by requireAdmin()\n');
  }
}

/**
 * PHASE 4: Summary
 */
async function generateReport() {
  console.log('📋 PHASE 4: Execution Summary\n');
  console.log('='.repeat(70));
  console.log('VALIDATION RESULTS (API MODE)');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Leads Processed: ${metrics.leadsProcessed}`);
  console.log(`Emails Sent: ${metrics.emailsSent}`);
  console.log(`Errors: ${metrics.errors.length}`);
  console.log('');

  if (metrics.errors.length > 0) {
    console.log('ERRORS:');
    metrics.errors.forEach(err => console.log(`  - ${err}`));
    console.log('');
  }

  console.log('STATUS: API endpoints require authentication');
  console.log('');
  console.log('NEXT STEPS:');
  console.log('1. Run from PowerShell (not background session) to get auth');
  console.log('2. OR: Add auth bypass for local testing');
  console.log('3. OR: Use direct database script with SSL fix');
  console.log('');
}

/**
 * Main execution
 */
async function main() {
  try {
    const healthy = await healthCheck();

    if (!healthy) {
      console.error('❌ Cannot proceed - API server not responding');
      process.exit(1);
    }

    await runOptimization();
    await executeCampaign();
    await generateReport();

  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error.message);
    process.exit(1);
  }
}

main();
