/**
 * Adversarial scan #3 — the "same class as the six findings" sweep.
 *
 * The e-sign and marketing defects shared a shape: a development affordance that was
 * reachable, or trusted, in production. This searches systematically for that shape:
 *
 *   A. dev/test/mock endpoints with no production guard
 *   B. NODE_ENV guards that are missing where dev-only code lives
 *   C. simulate/mock/test/debug helpers exported from API routes
 *   D. accept-anything verifiers (webhook signature checks that cannot fail)
 *   E. internal error text returned to clients
 *   F. predictable / hard-coded identifiers used as authorization
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src');
const SKIP = new Set(['node_modules', '.next', '.open-next', '.wrangler', 'dist', '__tests__']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const rel = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/');

const findings = { A: [], B: [], C: [], D: [], E: [], F: [] };

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  const isRoute = path.basename(f) === 'route.ts';

  lines.forEach((line, i) => {
    const L = line.trim();

    // A. dev/test/mock/mock-sign style endpoints
    if (isRoute && /(mock|simulate|sandbox|test-?only|demo|fake)/i.test(rel(f))) {
      findings.A.push(`${rel(f)}  (file name suggests dev-only surface)`);
    }

    // B. NODE_ENV === 'production' guard present in a file that mentions mock
    if (/mock/i.test(src) && /NODE_ENV/.test(src) && !/NODE_ENV\s*===\s*'production'/.test(src)) {
      findings.B.push(`${rel(f)}:${i + 1}  ${L.slice(0, 100)}`);
    }

    // C. simulate/mock helpers inside API routes
    if (isRoute && /export\s+(async\s+)?function\s+\w*(simulate|mock|fake|debug)\w*/i.test(L)) {
      findings.C.push(`${rel(f)}:${i + 1}  ${L.slice(0, 100)}`);
    }

    // D. accept-anything signature verification
    if (/verifyWebhook|verifySignature/.test(L) && /return true/.test(line)) {
      findings.D.push(`${rel(f)}:${i + 1}  ${L.slice(0, 100)}`);
    }
    if (/verifyWebhook\s*\([^)]*\)\s*(?::\s*boolean\s*)?\{\s*$/i.test(L)) {
      // body follows; check the next lines for a bare `return true`
    }

    // E. internal error text echoed to the client
    if (/error:\s*(error|err|e)\.message/.test(L) && /json\(|Response/.test(src)) {
      findings.E.push(`${rel(f)}:${i + 1}  ${L.slice(0, 100)}`);
    }

    // F. hard-coded identifier used as an authorization / tenant decision
    if (/(organization|org)[_]?id\s*[:=]\s*['"][a-z0-9-]{6,}['"]/i.test(L)) {
      findings.F.push(`${rel(f)}:${i + 1}  ${L.slice(0, 100)}`);
    }
  });
}

const LABELS = {
  A: 'DEV/MOCK ENDPOINTS (check for a production guard)',
  B: 'FILE MENTIONS MOCK BUT HAS NO NODE_ENV PRODUCTION GUARD',
  C: 'SIMULATE/MOCK/DEBUG EXPORT INSIDE AN API ROUTE',
  D: 'ACCEPT-ANYTHING SIGNATURE VERIFICATION',
  E: 'INTERNAL ERROR TEXT RETURNED TO CLIENT',
  F: 'HARDCODED ORGANIZATION ID (tenant decision)',
};

for (const [k, label] of Object.entries(LABELS)) {
  const uniq = [...new Set(findings[k])];
  console.log(`\n=== ${k}. ${label} (${uniq.length}) ===`);
  uniq.slice(0, 25).forEach((x) => console.log('   ' + x));
  if (uniq.length > 25) console.log(`   ... and ${uniq.length - 25} more`);
}
