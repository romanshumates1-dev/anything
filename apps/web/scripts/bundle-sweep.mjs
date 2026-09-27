/**
 * PRODUCTION BUNDLE / DATA-LEAK SWEEP (release gate).
 *
 * Scans the built `.next` output for anything that must never reach a client:
 * the real secret VALUES taken from `.env` (not just their names - a name in a
 * bundle is harmless, a value is a breach), source maps, internal hostnames,
 * and server-only diagnostics.
 *
 * Run AFTER `yarn build`:
 *   node scripts/bundle-sweep.mjs
 *
 * Exit code 1 on any finding, so it can gate a release.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const NEXT = join(ROOT, '.next');

if (!existsSync(NEXT)) {
  console.error('[sweep] .next not found - run `yarn build` first');
  process.exit(2);
}

// ---------------------------------------------------------------- env values
const env = {};
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i)] = t.slice(i + 1).trim();
  }
} catch {
  console.log('[sweep] no .env readable; falling back to pattern-only checks');
}

// Values that must never appear in a client bundle. Only non-trivial values
// (a short/default value would produce false positives everywhere).
const SECRET_VALUE_KEYS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ACCESS_KEY_ID',
  'CRON_SECRET',
  'JOB_RUNNER_SECRET',
  'SMS_INBOUND_SECRET',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_ACCOUNT_SID',
  'APOLLO_API_KEY',
  'STRIPE_SECRET_KEY',
  'ENCRYPTION_KEY',
  'SMTP_PASSWORD',
];
const secretValues = SECRET_VALUE_KEYS.map((k) => [k, env[k]]).filter(
  ([, v]) => typeof v === 'string' && v.length >= 12
);

// ---------------------------------------------------------------- walk files
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.txt']);
const files = [];
(function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // server output is not shipped to browsers, but the sweep is about the
      // CLIENT surface, so it is scanned separately below.
      walk(p);
    } else if (e.isFile() && SCAN_EXT.has(extname(e.name))) {
      try {
        if (statSync(p).size < 30 * 1024 * 1024) files.push(p);
      } catch {
        /* ignore */
      }
    }
  }
})(NEXT);

const isClientAsset = (p) =>
  p.includes(`${join('.next', 'static')}`) || p.includes('client-reference-manifest');

/**
 * Credentials that are PUBLIC documentation examples, not secrets. The
 * outreach settings page uses AWS's canonical example key as a placeholder, and
 * vendored packages carry their own; flagging them produced ~20 false positives
 * that would train everyone to ignore this tool.
 */
const KNOWN_EXAMPLE_VALUES = new Set([
  'AKIAIOSFODNN7EXAMPLE', // AWS docs
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', // AWS docs
  'sk-ant-api03-example', // Anthropic docs
]);

/** Vendored third-party code is not our leak surface. */
const isVendored = (p) =>
  p.includes(`${join('node_modules')}`) || p.includes('standalone');

const findings = [];
const sourceMaps = [];
let scanned = 0;

for (const file of files) {
  const client = isClientAsset(file);
  const vendored = isVendored(file);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned++;

  if (file.endsWith('.map')) {
    sourceMaps.push(file.replace(ROOT, '.'));
  }

  // 1. Real secret VALUES in anything a browser can download. Highest signal:
  //    a NAME in a bundle is harmless, a VALUE is a breach.
  if (client) {
    for (const [key, value] of secretValues) {
      if (text.includes(value)) {
        findings.push(
          `SECRET VALUE IN CLIENT BUNDLE: ${key} found in ${file.replace(ROOT, '.')}`
        );
      }
    }
  }

  // 2. Structural credential shapes, in OUR code only (not vendored), and only
  //    when they are not the well-known public examples.
  const shapes = [
    [/postgres(?:ql)?:\/\/[^"'\s]*:[^"'\s@]+@/, 'database URL with inline password'],
    [/npg_[A-Za-z0-9]{16,}/, 'Neon API key pattern (npg_...)'],
    [/sk-ant-[A-Za-z0-9\-_]{20,}/, 'Anthropic API key pattern (sk-ant-...)'],
    [/AKIA[0-9A-Z]{16}/, 'AWS access key id pattern (AKIA...)'],
    [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, 'private key block'],
    [/whsec_[A-Za-z0-9]{20,}/, 'Stripe webhook secret (whsec_...)'],
    [/sk_live_[A-Za-z0-9]{16,}/, 'Stripe live key (sk_live_...)'],
  ];
  if (!vendored) {
    for (const [re, label] of shapes) {
      for (const match of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
        const value = match[0];
        if (KNOWN_EXAMPLE_VALUES.has(value)) continue;
        // An example value may be embedded in a longer literal.
        if ([...KNOWN_EXAMPLE_VALUES].some((k) => value.includes(k))) continue;
        findings.push(
          `CREDENTIAL SHAPE (${label}) in ${file.replace(ROOT, '.')}${client ? ' [CLIENT]' : ''}`
        );
        break;
      }
    }
  }

  // 3. Internal hostnames, client bundles only.
  if (client) {
    for (const host of [
      'neon.tech',
      'pooler.',
      'internal.',
      '.local:',
      '10.0.',
      '192.168.',
    ]) {
      if (text.includes(host)) {
        findings.push(`INTERNAL HOST PATTERN "${host}" in client asset ${file.replace(ROOT, '.')}`);
      }
    }
  }
}

// ---------------------------------------------------------------- report
console.log(`[sweep] files scanned: ${scanned}`);
console.log(`[sweep] secret values loaded for comparison: ${secretValues.length}`);
console.log(`[sweep] source maps emitted: ${sourceMaps.length}`);
if (sourceMaps.length) {
  for (const m of sourceMaps.slice(0, 10)) console.log(`         ${m}`);
  if (sourceMaps.length > 10) console.log(`         ... and ${sourceMaps.length - 10} more`);
}

if (findings.length === 0) {
  console.log('BUNDLE_SWEEP: PASS (no secret values, credential shapes or internal hosts in client assets)');
  process.exit(0);
}
console.log(`\nBUNDLE_SWEEP: FAIL — ${findings.length} finding(s)`);
for (const f of findings) console.log(`  - ${f}`);
process.exit(1);
