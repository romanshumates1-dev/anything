/**
 * Performance / load measurement harness.
 *
 * SAFETY MODEL (read before pointing this at anything):
 *   --mode measure   Sequential, low-volume latency sampling. This is a smoke test, NOT a
 *                    load test: a handful of requests per route with a delay between them.
 *                    Safe to point at production.
 *   --mode load      Real concurrency. ONLY ever point this at a LOCAL or STAGING target.
 *                    The script REFUSES to run `load` mode against a non-local host unless
 *                    --i-have-authorization is passed explicitly, so an accidental
 *                    "just run it against prod" cannot become an uncontrolled load test
 *                    against a customer-facing site.
 *
 * Reports real percentiles computed from the samples (no invented numbers).
 *
 * Usage:
 *   node scripts/perf-harness.cjs --base https://host --mode measure
 *   node scripts/perf-harness.cjs --base http://localhost:3000 --mode load --concurrency 20 --requests 200
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const MODE = arg('mode', 'measure');
const CONCURRENCY = parseInt(arg('concurrency', '10'), 10);
const REQUESTS = parseInt(arg('requests', '50'), 10);
const DELAY_MS = parseInt(arg('delay', '250'), 10);
const AUTHORIZED = process.argv.includes('--i-have-authorization');

const ROUTES = [
  '/',
  '/pricing',
  '/features',
  '/about',
  '/contact',
  '/account/signin',
  '/account/signup',
  '/privacy',
  '/terms',
  '/robots.txt',
  '/sitemap.xml',
  '/api/system/health',
];

// ---- safety gate -----------------------------------------------------------
const host = new URL(BASE).hostname;
const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local)$/.test(host);

if (MODE === 'load' && !isLocal && !AUTHORIZED) {
  console.error(
    `REFUSING to run load mode against non-local host "${host}".\n` +
      `Load testing a customer-facing production site without authorization is an attack.\n` +
      `Point --base at localhost/staging, or pass --i-have-authorization if you have written permission.`
  );
  process.exit(2);
}

console.log(`TARGET : ${BASE}`);
console.log(`MODE   : ${MODE}${MODE === 'load' ? ` (concurrency=${CONCURRENCY} requests=${REQUESTS})` : ` (sequential, ${DELAY_MS}ms delay)`}`);
console.log(`HOST   : ${host} ${isLocal ? '(local)' : '(REMOTE)'}\n`);

function once(pathname) {
  return new Promise((resolve) => {
    const u = new URL(pathname, BASE);
    const mod = u.protocol === 'https:' ? https : http;
    const started = process.hrtime.bigint();
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': 'perf-harness/1.0', Accept: '*/*' },
        timeout: 30000,
      },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => (bytes += c.length));
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          resolve({ path: pathname, status: res.statusCode, ms, bytes });
        });
      }
    );
    req.on('error', (e) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ path: pathname, status: 0, ms, bytes: 0, error: e.code || e.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ path: pathname, status: 0, ms: 30000, bytes: 0, error: 'TIMEOUT' });
    });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function summarise(label, samples) {
  const ok = samples.filter((s) => s.status >= 200 && s.status < 400);
  const times = ok.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.length - ok.length;
  return {
    label,
    n: samples.length,
    errors,
    errorRate: samples.length ? +(errors / samples.length).toFixed(4) : 0,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: times.length ? +times[times.length - 1].toFixed(1) : null,
    min: times.length ? +times[0].toFixed(1) : null,
    bytes: samples.reduce((a, s) => a + s.bytes, 0),
  };
}

(async () => {
  const results = [];

  if (MODE === 'measure') {
    // Low-volume sequential sampling across routes. Safe against production.
    for (const r of ROUTES) {
      const samples = [];
      for (let i = 0; i < 3; i++) {
        samples.push(await once(r));
        if (DELAY_MS) await sleep(DELAY_MS);
      }
      const s = summarise(r, samples);
      results.push(s);
      console.log(
        `  ${r.padEnd(26)} n=${s.n} err=${s.errors} p50=${s.p50?.toFixed(0)}ms p95=${s.p95?.toFixed(0)}ms max=${s.max}ms ${s.bytes}B`
      );
    }
  } else {
    // Concurrency against a local/staging target only.
    for (const r of ROUTES) {
      const samples = [];
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        for (let i = 0; i < Math.ceil(REQUESTS / CONCURRENCY); i++) {
          samples.push(await once(r));
        }
      });
      await Promise.all(workers);
      const s = summarise(r, samples);
      results.push(s);
      console.log(
        `  ${r.padEnd(26)} n=${s.n} err=${s.errors} (${(s.errorRate * 100).toFixed(1)}%) p50=${s.p50?.toFixed(0)}ms p95=${s.p95?.toFixed(0)}ms p99=${s.p99?.toFixed(0)}ms`
      );
    }
  }

  const all = results.flatMap((r) => [r]);
  const overallSamples = [];
  for (const r of ROUTES) {
    const n = all.find((x) => x.label === r);
    overallSamples.push(n);
  }

  const outDir = path.resolve(__dirname, '..', '..', '..', 'perf-artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `perf-${MODE}-${Date.now()}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ target: BASE, mode: MODE, concurrency: MODE === 'load' ? CONCURRENCY : 1, results, capturedAt: new Date().toISOString() }, null, 2)
  );

  console.log(`\nARTIFACT: ${outFile}`);
  const totErr = results.reduce((a, r) => a + r.errors, 0);
  const totN = results.reduce((a, r) => a + r.n, 0);
  console.log(`TOTAL: ${totN} requests, ${totErr} errors (${((totErr / Math.max(1, totN)) * 100).toFixed(2)}%)`);
})();
