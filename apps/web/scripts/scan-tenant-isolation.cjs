/**
 * Tenant-isolation (IDOR/BOLA) scan across every API route.
 *
 * A route is a tenant-isolation risk when it reads or mutates rows keyed by an
 * id that comes from the URL/body, but shows NO organization predicate in the SQL.
 *
 * This is a HEURISTIC and is reported as a candidate list for human review, not as a
 * verdict: some routes legitimately have no org filter (webhooks keyed by provider id,
 * public catalogue reads, routes that only use org-scoped helper functions).
 * What matters is that the candidate list is reviewed, not that it is empty.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src', 'app', 'api');

// Signals that the route is scoped to a tenant.
const ORG_SCOPING = [
  'organization_id',
  'organizationId',
  'authResult.organizationId',
  'getOrganization',
  'requireAdmin',
  'authenticateApiKey',
  'org.id',
];

// Signals that a row is selected by a caller-supplied id.
const ID_FROM_REQUEST = [
  /params\s*[.,)]/,
  /searchParams\.get\(/,
  /body\.\w*[iI]d\b/,
  /\{[^}]*\bid\b[^}]*\}\s*=\s*await\s+params/,
  /request\.json\(\)/,
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'route.ts') out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const candidates = [];
let scoped = 0;
let noIdInput = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');

  const hasOrg = ORG_SCOPING.some((s) => src.includes(s));
  const hasIdInput = ID_FROM_REQUEST.some((re) => re.test(src));

  if (hasOrg) {
    scoped++;
    continue;
  }
  if (!hasIdInput) {
    noIdInput++;
    continue;
  }

  // No org signal + takes an id from the caller -> review candidate.
  const handlers = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g)]
    .map((m) => m[1])
    .join(',');
  candidates.push({ rel, handlers: handlers || '(re-export)' });
}

console.log(`ROUTES SCANNED:            ${files.length}`);
console.log(`  org-scoped:              ${scoped}`);
console.log(`  no caller-supplied id:   ${noIdInput}`);
console.log(`  REVIEW CANDIDATES:       ${candidates.length}\n`);
for (const c of candidates) console.log(`  ${c.rel}   [${c.handlers}]`);
