// Concurrency is the missing variable.
//
// Measured so far:
//   sequential x12 sign-in  -> 3x200, 9x429, 0x503
//   parallel  burst of 8   -> 5x200, 3x503
//   parallel  burst of 5   -> 3x200, 2x503
//
// So 5xx appear only under PARALLEL load, and the rate limiter is not the whole
// story. Discriminator: apply the SAME parallel burst to a hashing endpoint and
// to non-hashing controls. If 5xx land only on the hashing endpoint, the CPU
// budget is being spent in argon2. If they land on both, it is generic
// per-invocation contention (e.g. Neon fetch-per-query fan-out).
import { readFileSync } from 'node:fs';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;
const payload = JSON.stringify({ email: cred.email, password: cred.password });

async function timed(path, init) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, init);
    return { status: r.status, ms: Date.now() - t0 };
  } catch {
    return { status: 'THROW', ms: Date.now() - t0 };
  }
}

const signinInit = { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: payload };
const N = 12;

const burst = async (label, path, init) => {
  const rows = await Promise.all(Array.from({ length: N }, () => timed(path, init)));
  const t = {};
  for (const r of rows) t[r.status] = (t[r.status] || 0) + 1;
  const five = Object.entries(t).filter(([k]) => k.startsWith('5')).reduce((a, [, v]) => a + v, 0);
  console.log(`${label.padEnd(38)} ${JSON.stringify(t).padEnd(30)} 5xx=${five}/${N} avgMs=${Math.round(rows.reduce((a, r) => a + r.ms, 0) / N)}`);
  return five;
};

// Interleave the bursts so any drift in platform load hits all three equally.
let fiveSignin = 0, fiveSession = 0, fiveHealth = 0;
for (let round = 1; round <= 3; round++) {
  console.log(`\n--- round ${round} ---`);
  await new Promise((r) => setTimeout(r, 11_000)); // drain the 10s rate-limit window
  fiveSignin += await burst(`POST sign-in    (HASHES)   x${N}`, '/api/auth/sign-in/email', signinInit);
  fiveSession += await burst(`GET  get-session(no hash) x${N}`, '/api/auth/get-session', { headers: { origin: BASE } });
  fiveHealth += await burst(`GET  system/health (no hash) x${N}`, '/api/system/health', {});
}

console.log('\n--- TOTALS over 3 rounds (36 requests each) ---');
console.log(`5xx hashing endpoint     : ${fiveSignin}/36`);
console.log(`5xx get-session control  : ${fiveSession}/36`);
console.log(`5xx system/health control: ${fiveHealth}/36`);
console.log(
  fiveSignin > fiveSession + fiveHealth
    ? '\n=> 5xx concentrate on the HASHING endpoint: argon2 CPU is implicated.'
    : '\n=> 5xx are not specific to hashing: generic contention / cold-start / platform noise.'
);
