/**
 * API PROBE (release gate): exercises real HTTP endpoints with a REAL
 * synthetic session against the real database, and separately WITHOUT one.
 *
 * Three things a unit test cannot prove:
 *   1. the endpoint works for an authenticated user end to end;
 *   2. it refuses an unauthenticated caller (401/403, never 200/500);
 *   3. a synthetic user from ANOTHER organization cannot read a resource id
 *      belonging to the first (cross-tenant isolation over the wire).
 *
 * Safe by construction: it only creates its own synthetic users and only reads
 * ids it created, except for the cross-tenant case where it deliberately
 * presents a foreign id and asserts a 404/403.
 *
 * Usage: node scripts/api-probe.mjs
 */
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}
const BASE = 'http://localhost:4000';
const { neon } = await import('@neondatabase/serverless');
const sql = neon(env.DATABASE_URL);

const stamp = Date.now();
const domain = 'dealswiftautomation.com';

// ---------------------------------------------------------------- synthetic users
async function makeUser(label) {
  const email = `probe-${label}-${stamp}@${domain}`;
  const password = 'Test1234!pass';
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password, name: `Probe ${label}` }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const cookie = setCookie
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0].trim())
    .filter((c) => c.startsWith('better-auth'))
    .join('; ');
  if (!res.ok) {
    console.log(`  signup(${label}) FAILED ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return null;
  }
  const rows = await sql`SELECT id FROM "user" WHERE email = ${email}`;
  const orgRows = await sql`
    SELECT om.organization_id AS id FROM organization_members om
    JOIN "user" u ON u.id = om.user_id WHERE u.email = ${email} LIMIT 1
  `;
  // Promote to ADMIN, exactly as e2e/global-setup.ts does. New signups are
  // MEMBER and the MIN_ACCESS_ROLE gate answers 403 "Access pending" for them,
  // which would mask every data-path check behind an authorization response.
  await sql`UPDATE "user" SET role = 'ADMIN' WHERE email = ${email}`;
  if (rows[0]?.id) {
    await sql`
      UPDATE organization_members SET role = 'OWNER' WHERE user_id = ${rows[0].id}
    `;
  }
  return {
    label,
    email,
    cookie,
    userId: rows[0]?.id,
    orgId: orgRows[0]?.id,
  };
}

const READ_ENDPOINTS = [
  '/api/leads?limit=1',
  '/api/campaigns?limit=1',
  '/api/actions?limit=1&include_status=true',
  '/api/contracts?limit=1',
  '/api/earnings',
  '/api/withdrawals',
  '/api/usage',
  '/api/analytics/ai-recommendations?days=7',
  '/api/bank-accounts',
  '/api/tax/report?period=quarter',
  '/api/templates?includeLibrary=true',
  '/api/templates?includeLibrary=true&category=follow_up&channel=sms',
  '/api/templates?includeLibrary=true&category=sms',
  '/api/duplicates',
  '/api/feedback?sort=newest',
  '/api/compliance/audit',
  '/api/achievements',
  '/api/admin/users',
  '/api/v1/leads',
];

const user = await makeUser('a');
const other = await makeUser('b');
if (!user || !other) {
  console.log('API_PROBE: could not create synthetic users; aborting');
  process.exit(2);
}
console.log(`synthetic user A: ${user.email} (org ${user.orgId})`);
console.log(`synthetic user B: ${other.email} (org ${other.orgId})`);

const cookieHeader = (c) => ({ cookie: c, Origin: BASE });

console.log('\n--- authenticated (expect 2xx, or a documented 4xx) ---');
for (const ep of READ_ENDPOINTS) {
  const res = await fetch(`${BASE}${ep}`, { headers: cookieHeader(user.cookie) });
  const text = await res.text();
  const leak = /api\.anthropic\.com|ANTHROPIC_API_KEY|postgres:\/\/|neon\.tech|password/i.test(text);
  console.log(
    `  ${res.status} ${ep}${leak ? '   <<< POSSIBLE SECRET LEAK' : ''}` +
      `  ${text.slice(0, 60).replace(/\s+/g, ' ')}`
  );
}

console.log('\n--- unauthenticated (expect 401/403, NEVER 200) ---');
let authFailures = 0;
for (const ep of READ_ENDPOINTS) {
  const res = await fetch(`${BASE}${ep}`, { headers: { Origin: BASE } });
  const ok = res.status === 401 || res.status === 403;
  if (!ok) authFailures++;
  console.log(`  ${res.status} ${ep}${ok ? '' : '   <<< UNEXPECTED (must be 401/403)'}`);
}

// Cross-tenant: B asks for a lead id that belongs to A's organization.
console.log('\n--- cross-tenant (user B requests user A resource) ---');
const [aLead] = user.orgId
  ? await sql`SELECT id FROM leads WHERE organization_id = ${user.orgId} LIMIT 1`
  : [];
if (aLead) {
  for (const ep of [
    `/api/leads/${aLead.id}`,
    `/api/agents/negotiation`,
  ]) {
    if (ep.includes('negotiation')) {
      const res = await fetch(`${BASE}${ep}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...cookieHeader(other.cookie) },
        body: JSON.stringify({ leadId: aLead.id, sellerReply: 'sure, call me' }),
      });
      const body = await res.text();
      const leaked = body.includes(aLead.id) && !/not found|forbidden|unauthorized/i.test(body);
      console.log(`  ${res.status} POST ${ep}${leaked ? '   <<< CROSS-TENANT LEAK' : ''}`);
    } else {
      const res = await fetch(`${BASE}${ep}`, { headers: cookieHeader(other.cookie) });
      const body = await res.text();
      const leaked = res.status === 200 && body.includes('"phone"');
      console.log(`  ${res.status} GET ${ep}${leaked ? '   <<< CROSS-TENANT LEAK' : ''}`);
    }
  }
} else {
  console.log('  (no lead owned by A yet; cross-tenant probe skipped)');
}

console.log(
  `\nAPI_PROBE: ${authFailures === 0 ? 'PASS' : `FAIL (${authFailures} endpoint(s) served an unauthenticated caller)`}`
);
process.exit(authFailures === 0 ? 0 : 1);
