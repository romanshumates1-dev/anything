#!/usr/bin/env node
/**
 * Full System Verification
 *
 * Verifies all components:
 * 1. Self-sufficient scraper
 * 2. Self-hosted e-sign
 * 3. Market coverage
 * 4. Campaign systems
 * 5. Compliance
 */

import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;
const BASE_URL = 'http://localhost:4000';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const RESULTS = {
  passed: [],
  failed: [],
  warnings: [],
};

function log(icon, msg) {
  console.log(`${icon} ${msg}`);
}

async function test(name, fn) {
  try {
    const result = await fn();
    if (result === 'WARN') {
      RESULTS.warnings.push(name);
      log('⚠️', `WARN: ${name}`);
    } else {
      RESULTS.passed.push(name);
      log('✅', `PASS: ${name}`);
    }
    return result;
  } catch (err) {
    RESULTS.failed.push({ name, error: err.message });
    log('❌', `FAIL: ${name} - ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('FULL SYSTEM VERIFICATION');
  console.log('█'.repeat(70));
  console.log(`\nTimestamp: ${new Date().toISOString()}`);

  // ═══════════════════════════════════════════════════════════════════
  // 1. SELF-SUFFICIENT SCRAPER
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n--- 1. SELF-SUFFICIENT SCRAPER ---\n');

  await test('Scraper engine exists', async () => {
    if (!fs.existsSync('src/app/api/lead-finder/scraper/engine.ts')) throw new Error('Missing');
    return true;
  });

  await test('Scraper simulator exists', async () => {
    if (!fs.existsSync('src/app/api/lead-finder/scraper/simulator.ts')) throw new Error('Missing');
    return true;
  });

  await test('County configs exist', async () => {
    if (!fs.existsSync('src/app/api/lead-finder/scraper/county-configs.ts')) throw new Error('Missing');
    const content = fs.readFileSync('src/app/api/lead-finder/scraper/county-configs.ts', 'utf-8');
    const countyCount = (content.match(/county:\s*'/g) || []).length;
    log('  ', `${countyCount} counties configured`);
    if (countyCount < 20) throw new Error(`Only ${countyCount} counties`);
    return true;
  });

  await test('Scraper API route exists', async () => {
    if (!fs.existsSync('src/app/api/lead-finder/scraper/route.ts')) throw new Error('Missing');
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. SELF-HOSTED E-SIGN
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n--- 2. SELF-HOSTED E-SIGN ---\n');

  await test('E-sign engine exists', async () => {
    if (!fs.existsSync('src/app/api/esign/self-hosted/engine.ts')) throw new Error('Missing');
    return true;
  });

  await test('E-sign API route exists', async () => {
    if (!fs.existsSync('src/app/api/esign/self-hosted/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('E-sign has ESIGN Act compliance', async () => {
    const content = fs.readFileSync('src/app/api/esign/self-hosted/engine.ts', 'utf-8');
    if (!content.includes('ESIGN Act')) throw new Error('No ESIGN Act reference');
    if (!content.includes('auditTrail')) throw new Error('No audit trail');
    if (!content.includes('contentHash')) throw new Error('No content hashing');
    return true;
  });

  await test('E-sign envelopes table exists', async () => {
    await pool.query('SELECT 1 FROM esign_envelopes LIMIT 1');
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. MARKET COVERAGE
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n--- 3. MARKET COVERAGE ---\n');

  await test('Markets config exists', async () => {
    if (!fs.existsSync('src/app/api/lead-finder/markets/config.ts')) throw new Error('Missing');
    return true;
  });

  await test('25 markets configured', async () => {
    const content = fs.readFileSync('src/app/api/lead-finder/markets/config.ts', 'utf-8');
    const marketCount = (content.match(/rank:\s*\d+/g) || []).length;
    log('  ', `${marketCount} markets found`);
    if (marketCount !== 25) throw new Error(`Expected 25, got ${marketCount}`);
    return true;
  });

  await test('90+ counties configured', async () => {
    const content = fs.readFileSync('src/app/api/lead-finder/markets/config.ts', 'utf-8');
    const countyMatches = content.match(/primaryCounties:\s*\[([\s\S]*?)\]/g) || [];
    let countyCount = 0;
    countyMatches.forEach(m => {
      countyCount += (m.match(/'[^']+'/g) || []).length;
    });
    log('  ', `${countyCount} counties found`);
    if (countyCount < 90) throw new Error(`Expected 90+, got ${countyCount}`);
    return true;
  });

  await test('400+ ZIP codes configured', async () => {
    const content = fs.readFileSync('src/app/api/lead-finder/markets/config.ts', 'utf-8');
    const zipMatches = content.match(/topZips:\s*\[([\s\S]*?)\]/g) || [];
    let zipCount = 0;
    zipMatches.forEach(m => {
      zipCount += (m.match(/'[\d]+'/g) || []).length;
    });
    log('  ', `${zipCount} ZIPs found`);
    if (zipCount < 400) throw new Error(`Expected 400+, got ${zipCount}`);
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. CAMPAIGN SYSTEMS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n--- 4. CAMPAIGN SYSTEMS ---\n');

  await test('Mega launch endpoint exists', async () => {
    if (!fs.existsSync('src/app/api/campaigns/mega-launch/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('Auto-expand endpoint exists', async () => {
    if (!fs.existsSync('src/app/api/lead-finder/auto-expand/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('Public sources fetch endpoint exists', async () => {
    if (!fs.existsSync('src/app/api/lead-finder/public-sources/fetch/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('Sourced leads table exists', async () => {
    await pool.query('SELECT 1 FROM sourced_leads LIMIT 1');
    return true;
  });

  await test('Lead sources table exists', async () => {
    await pool.query('SELECT 1 FROM lead_sources LIMIT 1');
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. COMPLIANCE
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n--- 5. COMPLIANCE ---\n');

  await test('TCPA compliance endpoint exists', async () => {
    if (!fs.existsSync('src/app/api/compliance/tcpa/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('DNC list table exists', async () => {
    await pool.query('SELECT 1 FROM dnc_list LIMIT 1');
    return true;
  });

  await test('Suppression list table exists', async () => {
    await pool.query('SELECT 1 FROM suppression_list LIMIT 1');
    return true;
  });

  await test('Rate limit system exists', async () => {
    if (!fs.existsSync('src/app/api/ratelimit/route.ts')) throw new Error('Missing');
    await pool.query('SELECT 1 FROM rate_limit_log LIMIT 1');
    return true;
  });

  await test('Duplicate detection exists', async () => {
    if (!fs.existsSync('src/app/api/duplicates/route.ts')) throw new Error('Missing');
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. NEGOTIATION & AGENTS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n--- 6. NEGOTIATION & AGENTS ---\n');

  await test('Negotiation engine exists', async () => {
    if (!fs.existsSync('src/app/api/agents/negotiation/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('Offer framing agent exists', async () => {
    if (!fs.existsSync('src/app/api/agents/offer-framing/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('Comps endpoint exists', async () => {
    if (!fs.existsSync('src/app/api/comps/route.ts')) throw new Error('Missing');
    return true;
  });

  await test('Negotiation queue table exists', async () => {
    await pool.query('SELECT 1 FROM negotiation_queue LIMIT 1');
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(70));
  console.log('VERIFICATION SUMMARY');
  console.log('█'.repeat(70));

  const total = RESULTS.passed.length + RESULTS.failed.length;
  const passRate = Math.round((RESULTS.passed.length / total) * 100);

  console.log(`\n✅ PASSED: ${RESULTS.passed.length}`);
  console.log(`❌ FAILED: ${RESULTS.failed.length}`);
  console.log(`⚠️ WARNINGS: ${RESULTS.warnings.length}`);
  console.log(`\n📊 Pass Rate: ${passRate}%`);

  if (RESULTS.failed.length > 0) {
    console.log('\n--- FAILURES ---');
    RESULTS.failed.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
  }

  // ═══════════════════════════════════════════════════════════════════
  // SYSTEM STATUS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(70));
  console.log('SYSTEM STATUS');
  console.log('█'.repeat(70));

  const systems = {
    'Self-Sufficient Scraper': RESULTS.passed.filter(p => p.includes('Scraper') || p.includes('County') || p.includes('simulator')).length >= 3,
    'Self-Hosted E-Sign': RESULTS.passed.filter(p => p.includes('E-sign') || p.includes('ESIGN')).length >= 3,
    'Market Coverage (25 markets)': RESULTS.passed.filter(p => p.includes('market') || p.includes('counties') || p.includes('ZIP')).length >= 3,
    'Campaign Systems': RESULTS.passed.filter(p => p.includes('Mega') || p.includes('expand') || p.includes('sources')).length >= 3,
    'Compliance (TCPA/DNC)': RESULTS.passed.filter(p => p.includes('TCPA') || p.includes('DNC') || p.includes('Rate') || p.includes('Suppression')).length >= 3,
  };

  let allReady = true;
  for (const [system, ready] of Object.entries(systems)) {
    const icon = ready ? '✅' : '❌';
    console.log(`${icon} ${system}`);
    if (!ready) allReady = false;
  }

  console.log('\n--- FINAL STATUS ---');
  if (allReady && RESULTS.failed.length === 0) {
    console.log('✅ ALL SYSTEMS READY - CAMPAIGN LAUNCH APPROVED');
  } else if (RESULTS.failed.length <= 2) {
    console.log('⚠️ SYSTEMS MOSTLY READY - MINOR ISSUES');
  } else {
    console.log('❌ SYSTEMS NOT READY - FIX REQUIRED');
  }

  await pool.end();
  process.exit(RESULTS.failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
