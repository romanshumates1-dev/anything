/**
 * Pipeline Implementation Verification Script
 * Verifies all components of the wholesaling pipeline optimization are in place.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BASE_PATH = join(process.cwd(), 'src/app/api');

const REQUIRED_FILES = {
  'Regional Contract Engine': [
    'contracts/templates/purchase-agreement.ts',
    'contracts/templates/assignment-contract.ts',
    'contracts/templates/regional/texas.ts',
    'contracts/templates/regional/florida.ts',
    'contracts/templates/regional/california.ts',
    'contracts/templates/regional/generic.ts',
    'contracts/engine.ts',
    'contracts/generate/route.ts',
    'contracts/validate/route.ts',
  ],
  'Regional Compliance Engine': [
    'compliance/regional-messaging/engine.ts',
    'compliance/regional-messaging/rules/federal.ts',
    'compliance/regional-messaging/rules/california.ts',
    'compliance/regional-messaging/rules/florida.ts',
    'compliance/regional-messaging/rules/texas.ts',
    'compliance/regional-messaging/rules/generic.ts',
    'compliance/messaging-gate.ts',
  ],
  'Prospect Scoring': [
    'prospects/scoring-engine.ts',
    'prospects/seller-scoring/route.ts',
    'prospects/buyer-scoring/route.ts',
  ],
  'Alert System': [
    'alerts/notification-engine.ts',
    'alerts/critical/route.ts',
  ],
  'Payment Flow': [
    'payments/buyer-payment/route.ts',
    'payments/charge-assignment/route.ts',
  ],
  'Campaign Infrastructure': [
    'campaigns/config/high-volume.ts',
    'campaigns/preflight/route.ts',
    'campaigns/quality-gate/monitor.ts',
    'campaigns/launch/route.ts',
    'campaigns/templates/assignment-signed-followup.ts',
  ],
  'Deal Summary': [
    'deals/summary/route.ts',
  ],
};

const REQUIRED_EXPORTS = {
  'contracts/engine.ts': ['detectState', 'generateContract', 'validateContractVariables', 'MINIMUM_ASSIGNMENT_FEE'],
  'prospects/scoring-engine.ts': ['scoreSeller', 'scoreBuyer', 'calculateEarnestMoney'],
  'alerts/notification-engine.ts': ['sendAlert', 'alertAssignmentFeePaid', 'alertSellerSigned'],
  'campaigns/config/high-volume.ts': ['HIGH_VOLUME_CONFIG', 'getWarmupTarget', 'checkQualityGates'],
  'compliance/messaging-gate.ts': ['check', 'checkQuietHours'],
  'utils/negotiationEngine.ts': ['negotiateInspectionDays', 'validateFeeFloor', 'FEE_FLOOR_CENTS'],
};

const FEE_FLOOR_CHECK = {
  files: [
    'contracts/templates/assignment-contract.ts',
    'contracts/engine.ts',
    'contracts/validate/route.ts',
    'utils/negotiationEngine.ts',
  ],
  patterns: ['5000', '5,000', 'MINIMUM_ASSIGNMENT_FEE', 'FEE_FLOOR'],
};

console.log('🔍 Verifying Wholesaling Pipeline Implementation\n');
console.log('='.repeat(60) + '\n');

let totalChecks = 0;
let passedChecks = 0;

// Check required files
console.log('📁 CHECKING REQUIRED FILES\n');
for (const [category, files] of Object.entries(REQUIRED_FILES)) {
  console.log(`  ${category}:`);
  for (const file of files) {
    totalChecks++;
    const filePath = join(BASE_PATH, file);
    const exists = existsSync(filePath);
    if (exists) {
      passedChecks++;
      console.log(`    ✅ ${file}`);
    } else {
      console.log(`    ❌ ${file} - MISSING`);
    }
  }
  console.log();
}

// Check required exports
console.log('📤 CHECKING REQUIRED EXPORTS\n');
for (const [file, exports] of Object.entries(REQUIRED_EXPORTS)) {
  const filePath = join(BASE_PATH, file);
  if (!existsSync(filePath)) {
    console.log(`  ⚠️  Skipping ${file} (file not found)`);
    continue;
  }

  const content = readFileSync(filePath, 'utf-8');
  console.log(`  ${file}:`);

  for (const exp of exports) {
    totalChecks++;
    const hasExport = content.includes(`export function ${exp}`) ||
                      content.includes(`export const ${exp}`) ||
                      content.includes(`export { ${exp}`) ||
                      content.includes(`export async function ${exp}`);
    if (hasExport) {
      passedChecks++;
      console.log(`    ✅ ${exp}`);
    } else {
      console.log(`    ❌ ${exp} - NOT EXPORTED`);
    }
  }
  console.log();
}

// Check fee floor enforcement
console.log('💰 CHECKING $5,000 FEE FLOOR ENFORCEMENT\n');
for (const file of FEE_FLOOR_CHECK.files) {
  const filePath = join(BASE_PATH, file);
  if (!existsSync(filePath)) {
    console.log(`  ⚠️  Skipping ${file} (file not found)`);
    continue;
  }

  totalChecks++;
  const content = readFileSync(filePath, 'utf-8');
  const hasFeeFloor = FEE_FLOOR_CHECK.patterns.some(p => content.includes(p));

  if (hasFeeFloor) {
    passedChecks++;
    console.log(`  ✅ ${file} - Fee floor referenced`);
  } else {
    console.log(`  ❌ ${file} - No fee floor reference found`);
  }
}

// Check campaign config
console.log('\n📧 CHECKING CAMPAIGN CONFIGURATION\n');
const configPath = join(BASE_PATH, 'campaigns/config/high-volume.ts');
if (existsSync(configPath)) {
  const configContent = readFileSync(configPath, 'utf-8');

  totalChecks++;
  if (configContent.includes('10064436819')) {
    passedChecks++;
    console.log('  ✅ AWS Credit ID: 10064436819');
  } else {
    console.log('  ❌ AWS Credit ID not found');
  }

  totalChecks++;
  if (configContent.includes('150_000') || configContent.includes('150000')) {
    passedChecks++;
    console.log('  ✅ Daily Target: 150,000');
  } else {
    console.log('  ❌ Daily target 150k not found');
  }

  totalChecks++;
  if (configContent.includes('250_000') || configContent.includes('250000')) {
    passedChecks++;
    console.log('  ✅ Max Cap: 250,000');
  } else {
    console.log('  ❌ Max cap 250k not found');
  }
}

// Check buyer tiers
console.log('\n👥 CHECKING BUYER TIERS & EARNEST MONEY\n');
const scoringPath = join(BASE_PATH, 'prospects/scoring-engine.ts');
if (existsSync(scoringPath)) {
  const scoringContent = readFileSync(scoringPath, 'utf-8');

  const tiers = ['VIP', 'VERIFIED', 'PROSPECT', 'UNVERIFIED'];
  for (const tier of tiers) {
    totalChecks++;
    if (scoringContent.includes(`'${tier}'`) || scoringContent.includes(`"${tier}"`)) {
      passedChecks++;
      console.log(`  ✅ ${tier} tier defined`);
    } else {
      console.log(`  ❌ ${tier} tier not found`);
    }
  }
}

// Check inspection period
console.log('\n📅 CHECKING INSPECTION PERIOD CONFIGURATION\n');
const negotiationPath = join(BASE_PATH, 'utils/negotiationEngine.ts');
if (existsSync(negotiationPath)) {
  const negContent = readFileSync(negotiationPath, 'utf-8');

  totalChecks++;
  if (negContent.includes('min: 7')) {
    passedChecks++;
    console.log('  ✅ Minimum inspection period: 7 days');
  } else {
    console.log('  ❌ Minimum 7 days not found');
  }

  totalChecks++;
  if (negContent.includes('max: 21')) {
    passedChecks++;
    console.log('  ✅ Maximum inspection period: 21 days');
  } else {
    console.log('  ❌ Maximum 21 days not found');
  }

  totalChecks++;
  if (negContent.includes('default: 14')) {
    passedChecks++;
    console.log('  ✅ Default inspection period: 14 days');
  } else {
    console.log('  ❌ Default 14 days not found');
  }
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('\n📊 VERIFICATION SUMMARY\n');
const percentage = Math.round((passedChecks / totalChecks) * 100);
console.log(`  Total Checks: ${totalChecks}`);
console.log(`  Passed: ${passedChecks}`);
console.log(`  Failed: ${totalChecks - passedChecks}`);
console.log(`  Score: ${percentage}%`);

if (percentage === 100) {
  console.log('\n🎉 ALL CHECKS PASSED! Pipeline implementation is complete.\n');
} else if (percentage >= 90) {
  console.log('\n✅ Implementation mostly complete. Review failed checks above.\n');
} else {
  console.log('\n⚠️  Implementation incomplete. Review failed checks above.\n');
}

process.exit(percentage === 100 ? 0 : 1);
