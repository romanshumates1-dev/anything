/**
 * SIGNUP-HOOK VERIFICATION (production, read-back).
 *
 * WHY THIS EXISTS
 * ---------------
 * `live-auth-probe.mjs` signs up, then PROMOTES its own account to ADMIN/OWNER
 * before touching any route. That promotion masks the exact defect the C9 fix
 * targets: the `user.create.after` hook inserts the organization, the OWNER
 * `organization_members` row and the trial subscription, and it SWALLOWS its
 * errors. So "all routes returned 200" is consistent with BOTH a working hook
 * and a hook that failed 100% of the time - the probe cannot tell them apart.
 *
 * This script closes that gap by asserting the hook's DATABASE side-effects
 * directly, for a brand-new account, with no promotion of any kind:
 *
 *   1. organization row exists
 *   2. organization_members row exists with role OWNER
 *   3. organization_subscriptions row exists (free/trial)
 *
 * It also asserts the negative half of the tenant-isolation contract: that the
 * new account is NOT silently attached to `org_default`, which is the mass
 * data-exposure fallback guarded in organization-context.ts.
 *
 * Deliberately NOT done here: no promotion, no writes beyond the signup itself,
 * no leads/campaigns/payments. Creates only its own synthetic account on this
 * probe's allowlisted domain. Prints no cookie, token or credential.
 *
 * Usage: node scripts/signup-hook-verify.mjs [baseUrl]
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const BASE = process.argv[2] || 'https://dealswiftautomation.com';
const email = `c9-hook-verify-${Date.now()}@dealswiftautomation.com`;
const password = 'Test1234!pass';
const sql = neon(env.DATABASE_URL);

const signup = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email, password, name: 'C9 Hook Verify' }),
});
console.log(`signup: ${signup.status}`);
if (!signup.ok) {
  console.error('SIGNUP FAILED - hook side-effects cannot be assessed');
  process.exit(1);
}

const users = await sql`SELECT id, email FROM "user" WHERE email = ${email} LIMIT 1`;
const userId = users[0]?.id;
if (!userId) {
  console.error('user row not found after successful signup');
  process.exit(1);
}

const orgs = await sql`
  SELECT o.id, o.name, o.slug FROM organization_members om
  JOIN organizations o ON o.id = om.organization_id
  WHERE om.user_id = ${userId} ORDER BY om.created_at ASC
`;
const memberRows = await sql`
  SELECT organization_id, role FROM organization_members WHERE user_id = ${userId}
`;
const subs = await sql`
  SELECT plan_id, status, trial_ends_at FROM organization_subscriptions
  WHERE organization_id = ${memberRows[0]?.organization_id ?? ''} LIMIT 1
`;

console.log(`\nuser ${userId.slice(0, 8)}…`);
console.log('organizations:      ', orgs.map((o) => o.slug).join(', ') || '(none)');
console.log('organization_members:', JSON.stringify(memberRows));
console.log('subscription:       ', JSON.stringify(subs[0] ?? null));

const problems = [];
if (orgs.length === 0) problems.push('hook created NO organization for a new signup');
if (memberRows.length === 0) problems.push('hook created NO organization_members row (user is ORPHANED)');
if (memberRows[0]?.role !== 'OWNER') problems.push(`expected OWNER role, got ${memberRows[0]?.role}`);
if (subs.length === 0) problems.push('hook created NO trial subscription');
// Tenant isolation: a fresh signup must never land in org_default.
if (memberRows[0]?.organization_id === 'org_default')
  problems.push('new signup attached to org_default (mass data-exposure fallback)');

console.log('');
if (problems.length === 0) {
  console.log('SIGNUP HOOK VERIFIED: org + OWNER membership + trial subscription all present');
} else {
  console.log('SIGNUP HOOK DEFECT:');
  for (const p of problems) console.log(`  - ${p}`);
}
process.exit(problems.length ? 1 : 0);