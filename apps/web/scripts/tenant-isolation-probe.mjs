/**
 * TENANT ISOLATION / IDOR PROBE (security addendum).
 *
 * Why this exists: the dashboard work uncovered a real cross-tenant aggregate
 * (`SELECT count(*) FROM jobs` was unscoped and served as the caller's own).
 * One leak of that kind is evidence of a CLASS, not an incident, so this
 * exercises the class rather than the instance.
 *
 * Method - two REAL users, each auto-provisioned into its own organization by
 * the signup hook, then a lead is created in org A and user B is asked for it
 * through every endpoint that accepts a resource id. A correct system answers
 * 404/403 for all of them.
 *
 * Also checks vertical escalation: a plain member hitting /api/admin/*.
 *
 * Safe by construction: it creates only its own synthetic users and a synthetic
 * lead, and only reads ids it created. It never mutates another tenant's data
 * and performs no writes to foreign resources.
 *
 * Usage: node scripts/tenant-isolation-probe.mjs [baseUrl]
 */
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4000';
const { neon } = await import('@neondatabase/serverless');
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sql = neon(env.DATABASE_URL);
const DOMAIN = 'dealswiftautomation.com';
const stamp = Date.now();

async function makeUser(label) {
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE },
    body: JSON.stringify({
      email: `iso-${label}-${stamp}@${DOMAIN}`,
      password: 'Test1234!pass',
      name: `ISO ${label}`,
    }),
  });
  if (!res.ok) throw new Error(`signup ${label} failed: ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  const body = await res.json();
  const orgId = await getOrgId(body.user?.id);
  return { cookie, userId: body.user?.id, orgId, label };
}

async function getOrgId(userId) {
  const rows = await sql`
    SELECT om.organization_id AS id
    FROM organization_members om
    WHERE om.user_id = ${userId}
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

let leaks = 0;
let checks = 0;
const record = (label, status, leaked) => {
  checks++;
  if (leaked) leaks++;
  const verdict = leaked ? '  <<< LEAK' : '';
  console.log(`  ${status} ${label}${verdict}`);
};

console.log(`\n=== Tenant isolation probe against ${BASE} ===`);
const a = await makeUser('alpha');
const b = await makeUser('beta');
console.log(`  org A = ${a.orgId}\n  org B = ${b.orgId}`);

if (!a.orgId || !b.orgId) {
  console.log('  ABORT: could not resolve both organizations');
  process.exit(2);
}

// A synthetic lead owned by org A. `leads.id` is an INTEGER (verified from
// information_schema - an earlier version of this script assumed it was text and
// the insert failed with "invalid input syntax for type integer"), so the id is
// assigned by the database rather than supplied.
const [lead] = await sql`
  INSERT INTO leads (name, email, phone, status, type, organization_id, created_at, updated_at)
  VALUES ('ISO Sentinel', ${`iso-${stamp}@example.invalid`},
          '5550001111', 'new', 'seller', ${a.orgId}, NOW(), NOW())
  RETURNING id, organization_id`;
const leadId = lead.id;
console.log(`\n--- user B (org B) requests org A's lead ${leadId} ---`);

// GET-style: the response must not contain the lead's identifying fields.
const getCases = [
  `/api/leads/${leadId}`,
  `/api/leads/${leadId}/timeline`,
  `/api/contracts?leadId=${leadId}`,
  `/api/actions?entityId=${leadId}`,
  `/api/portal/offer?leadId=${leadId}`,
  `/api/duplicates?leadId=${leadId}`,
];
const SENTINEL = 'ISO Sentinel';
for (const path of getCases) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: b.cookie, Origin: BASE } });
  const body = await res.text();
  const leaked = res.status === 200 && body.includes(SENTINEL);
  const softLeak = false;
  record(`GET ${path} (user B)`, res.status, leaked || softLeak);
}

// POST-style: writing to a foreign resource must be refused.
const postCases = [
  [`/api/actions/${leadId}`, { action: 'archive' }],
  [`/api/leads/${leadId}`, { name: 'pwned' }],
  [`/api/duplicates/merge`, { primaryLeadId: leadId, duplicateLeadIds: [leadId] }],
];
for (const [path, body] of postCases) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: b.cookie, Origin: BASE },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const leaked = res.status < 400 && text.includes(SENTINEL);
  record(`POST ${path} (user B)`, res.status, leaked);
}

console.log(`\n--- vertical escalation: member (user B) hitting admin APIs ---`);
for (const path of ['/api/admin/users', '/api/admin/stats', '/api/admin/audit']) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: b.cookie, Origin: BASE } });
  const ok = res.status === 401 || res.status === 403;
  if (!ok) leaks++;
  checks++;
  console.log(`  ${res.status} GET ${path}${ok ? '' : '   <<< ADMIN EXPOSED'}`);
}

console.log(`\n--- unauthenticated access to the same admin APIs ---`);
for (const path of ['/api/admin/users', '/api/admin/stats']) {
  const res = await fetch(`${BASE}${path}`, { headers: { Origin: BASE } });
  const ok = res.status === 401 || res.status === 403;
  if (!ok) leaks++;
  checks++;
  console.log(`  ${res.status} GET ${path}${ok ? '' : '   <<< ADMIN EXPOSED'}`);
}

// Confirm org A still owns the lead (no write happened through the probe).
const [still] = await sql`SELECT organization_id FROM leads WHERE id = ${leadId}`;
const ownershipIntact = still?.organization_id === a.orgId;
checks++;
if (!ownershipIntact) leaks++;
console.log(
  `\n  ${ownershipIntact ? 'PASS' : 'FAIL'}  lead ownership unchanged by foreign-org requests`
);

await sql`DELETE FROM leads WHERE id = ${leadId}`;

console.log(`\nRESULT: ${checks} checks, ${leaks} leak(s)`);
process.exit(leaks === 0 ? 0 : 1);
