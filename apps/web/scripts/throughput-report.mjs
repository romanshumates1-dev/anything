import {
  computeDailyCapacity,
  requiredNumbersForVolume,
  canFitDailyVolume,
  DEFAULT_THROUGHPUT,
} from '../src/app/api/utils/numberPool.ts';

const TRUST_SCENARIOS = [
  { key: 'low', label: 'Low trust (sole-proprietor / unvetted)' },
  { key: 'medium', label: 'Medium trust (vetted / registered brand)' },
  { key: 'high', label: 'High trust (enterprise / pre-vetted)' },
];

const VOLUMES = [50, 100, 1000, 5000];
const WINDOW_HOURS = 13; // TCPA 8am-9pm

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║        10DLC THROUGHPUT REPORT: Volume Planning by Trust       ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log(`Assumptions: ${WINDOW_HOURS}-hour TCPA send window (8am-9pm recipient local)\n`);
console.log('NOTE: After Twilio A2P campaign approval, update .env with real assigned throughput.\n');

for (const scenario of TRUST_SCENARIOS) {
  const config = DEFAULT_THROUGHPUT[scenario.key];
  console.log(`\n┌─ ${scenario.label} ────────────────────────────────────────┐`);
  console.log(`│`);
  console.log(`│  Config: MPS=${config.mps}, T-Mobile daily cap=${config.tMobileDailyCap}`);
  console.log(`│  Max daily capacity: ${computeDailyCapacity(config, WINDOW_HOURS)} messages/day`);
  console.log(`│`);

  for (const volume of VOLUMES) {
    const capacity = computeDailyCapacity(config, WINDOW_HOURS);
    const fits = canFitDailyVolume(volume, WINDOW_HOURS, '10dlc', scenario.key);
    const numbersNeeded = requiredNumbersForVolume(volume, WINDOW_HOURS, '10dlc', scenario.key);

    let result = '';
    if (fits) {
      result = `✓ Fits on 1 number`;
    } else {
      result = `✗ Need ${numbersNeeded} numbers`;
    }

    console.log(`│  ${volume.toString().padStart(5, ' ')}/day: ${result}`);
  }
  console.log(`│`);
  console.log(`└────────────────────────────────────────────────────────────────┘`);
}

console.log('\n\nRECOMMENDATIONS:');
console.log('═══════════════');
console.log('• Low trust (default):   50/100/1000 fine on 1 number, 5000 needs 3 numbers');
console.log('• Medium trust:          All volumes fit on 1 number');
console.log('• High trust:            All volumes fit on 1 number\n');
console.log('ACTION:');
console.log('──────');
console.log('1. Complete Twilio A2P 10DLC brand + campaign registration');
console.log('2. Check your Twilio dashboard for assigned MPS and any carrier-specific caps');
console.log('3. Update .env with TWILIO_10DLC_ASSIGNED_MPS and TWILIO_10DLC_TMOBILE_DAILY_CAP');
console.log('4. Re-run this report to verify planning reflects real limits\n');