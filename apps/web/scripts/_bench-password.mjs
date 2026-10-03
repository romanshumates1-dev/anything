// ISOLATED BENCHMARK — no production traffic, no network, synthetic password.
//
// FACTS ESTABLISHED BEFORE WRITING THIS (see apps/web/wrangler.jsonc):
//   * account.password holds `hex32:hex128` for all 152 rows, exactly 161 chars.
//     That is @better-auth/utils' format:
//         salt = 16 random bytes -> 32 hex
//         key  = scrypt(N=16384, r=16, p=1, dkLen=64) -> 128 hex
//   * ZERO rows are $argon2, so the argon2 branch of verifyCompatiblePassword()
//     is dead code and no argon2 CPU is being spent today. The cost is scrypt.
//   * Two implementations ship, selected by the "node" export condition:
//       password.node.mjs -> node:crypto scrypt (libuv thread pool)
//       password.mjs      -> @noble/hashes scryptAsync (pure JS)
//     On Node the native one resolves. Cloudflare Workers has no libuv thread
//     pool, so which one is actually bundled there is a separate question that
//     only the deployed Worker can answer; this benchmark prices both.
//
// Run: node scripts/_bench-password.mjs
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const PASSWORD = 'benchmark-only-not-a-real-credential';
const ROUNDS = 20;

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

// The package "exports" map exposes neither ./package.json nor the dist files,
// so resolve them from the node_modules path directly. This is a benchmark
// script that only ever reads installed files, so the path is derived from
// import.meta.url rather than accepted as input.
const distDir = pathToFileURL(
  join(process.cwd(), 'node_modules', '@better-auth', 'utils', 'dist')
).href;
const load = (f) => import(`${distDir}/${f}`);

const native = await load('password.node.mjs');
const pureJs = await load('password.mjs');

const bench = async (label, mod) => {
  const hash = await mod.hashPassword(PASSWORD);
  const times = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    await mod.verifyPassword(hash, PASSWORD);
    times.push(performance.now() - t0);
  }
  const med = pct(times, 50);
  console.log(
    `${label.padEnd(24)} len=${String(hash.length).padStart(3)}  median ${med.toFixed(2)}ms  p95 ${pct(times, 95).toFixed(2)}ms  max ${Math.max(...times).toFixed(2)}ms`
  );
  return { hash, med };
};

console.log('=== password hashing cost (this machine, Node) ===');
const a = await bench('native node:crypto', native);
const b = await bench('pure JS @noble', pureJs);

console.log('\n=== format compatibility ===');
console.log(`  both produce the same 161-char hex:hex shape: ${a.hash.length === b.hash.length && a.hash.length === 161}`);
const crossNative = await native.verifyPassword(b.hash, PASSWORD);
const crossPure = await pureJs.verifyPassword(a.hash, PASSWORD);
console.log(`  each verifies the other's hash (identical algorithm): ${crossNative && crossPure}`);

console.log('\n=== Workers Free budget (10ms CPU per invocation) ===');
console.log(`  native: ${(10 / a.med).toFixed(1)} verifications per budget`);
console.log(`  pureJS: ${(10 / b.med).toFixed(1)} verifications per budget`);
console.log('\n  These numbers are from Node on this host. They bound the WORK, but the');
console.log("  deployed Worker's actual cost depends on which implementation is");
console.log('  bundled under workerd, which is verified separately.');
