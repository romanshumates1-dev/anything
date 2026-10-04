// Concurrency is the remaining variable in the isolated Worker investigation.
//
// SAFETY CONTRACT
// ---------------
// This script is deliberately constrained rather than being a generic load
// generator. It can target ONLY the disposable `dealswift-loadtest` Worker,
// accepts at most 16 simultaneous requests and three rounds, and stops before
// the next endpoint as soon as any 5xx appears. Never point it at the apex.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOADTEST_HOST = 'dealswift-loadtest.romanshumates1.workers.dev';
const DEFAULT_CONCURRENCY = 12;
const DEFAULT_ROUNDS = 3;
const MAX_CONCURRENCY = 16;
const MAX_ROUNDS = 3;

function readBoundedPositiveInteger(value, name, fallback, max) {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }

  return parsed;
}

/**
 * Validate environment overrides without permitting a caller to silently turn
 * the bounded probe into a stress test.
 */
export function readExperimentConfig(env = process.env) {
  return {
    concurrency: readBoundedPositiveInteger(
      env.CONCURRENCY,
      'CONCURRENCY',
      DEFAULT_CONCURRENCY,
      MAX_CONCURRENCY
    ),
    rounds: readBoundedPositiveInteger(env.ROUNDS, 'ROUNDS', DEFAULT_ROUNDS, MAX_ROUNDS),
  };
}

/** Refuse every host except the explicitly disposable Worker origin. */
export function assertLoadtestOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`REFUSING to run: BASE must be https://${LOADTEST_HOST}`);
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== LOADTEST_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`REFUSING to run: BASE must be exactly https://${LOADTEST_HOST}`);
  }

  return url.origin;
}

async function main() {
  const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
  const base = assertLoadtestOrigin(cred.base);
  const { concurrency, rounds } = readExperimentConfig();
  const payload = JSON.stringify({ email: cred.email, password: cred.password });

  console.log(`target = ${base} (isolated); concurrency=${concurrency}; rounds=${rounds}`);

  async function timed(path, init) {
    const t0 = Date.now();
    try {
      const response = await fetch(base + path, init);
      return { status: response.status, ms: Date.now() - t0 };
    } catch {
      return { status: 'THROW', ms: Date.now() - t0 };
    }
  }

  const signinInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: payload,
  };

  async function burst(label, path, init) {
    const rows = await Promise.all(
      Array.from({ length: concurrency }, () => timed(path, init))
    );
    const statuses = {};
    for (const row of rows) statuses[row.status] = (statuses[row.status] || 0) + 1;
    const fiveXx = Object.entries(statuses)
      .filter(([status]) => status.startsWith('5'))
      .reduce((total, [, count]) => total + count, 0);
    const avgMs = Math.round(rows.reduce((total, row) => total + row.ms, 0) / concurrency);
    const maxMs = Math.max(...rows.map((row) => row.ms));

    console.log(
      `${label.padEnd(38)} ${JSON.stringify(statuses).padEnd(30)} ` +
        `5xx=${fiveXx}/${concurrency} avgMs=${avgMs} maxMs=${maxMs}`
    );
    return fiveXx;
  }

  const endpoints = [
    ['POST sign-in    (HASHES)', '/api/auth/sign-in/email', signinInit],
    ['GET  get-session(no hash)', '/api/auth/get-session', { headers: { origin: base } }],
    ['GET  system/health (no hash)', '/api/system/health', {}],
  ];

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n--- round ${round}/${rounds} ---`);
    if (round > 1) {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 11_000));
    }

    for (const [label, path, init] of endpoints) {
      const fiveXx = await burst(`${label} x${concurrency}`, path, init);
      if (fiveXx > 0) {
        console.error(
          `STOPPED: observed ${fiveXx} 5xx response(s); no further bursts will be sent.`
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  console.log('\nCOMPLETE: no 5xx observed within the configured bounded experiment.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
