/**
 * ORPHANED-ACCOUNT REMEDIATION PLAN (dry-run by default).
 *
 * WHY A PLAN AND NOT A CLEANUP SCRIPT: the orphaned set mixes genuine operator
 * accounts with synthetic e2e/probe accounts, and the two need opposite
 * treatment. Deleting a real account locks a human out; deleting a probe
 * account is harmless but pointless. Guessing wrong in either direction is
 * unacceptable, so this classifies first, shows the plan, and only writes when
 * explicitly passed --apply.
 *
 * Evidence used for classification (no guessing):
 *   - no organization_members row (the orphan condition itself)
 *   - the email prefixes the harnesses in scripts/ and playwright.config
 *     actually generate (e2e-, c8-live-probe-, c9-, a4-, b1-, walk-, ...)
 *   - domains only those harnesses ever use
 *
 * Categories:
 *   A  REAL      -> backfill an organization + OWNER membership (non-destructive)
 *   B  SYNTHETIC -> revoke sessions, anonymise; DELETE only with --purge
 *   C  UNCERTAIN -> revoke access, preserve every row, report for a human
 *
 * Usage:
 *   node scripts/orphan-remediation.mjs                  # plan only (default)
 *   node scripts/orphan-remediation.mjs --apply          # act on A + B, hold C
 *   node scripts/orphan-remediation.mjs --apply --purge  # also delete B rows
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

const APPLY = process.argv.includes('--apply');
const PURGE = process.argv.includes('--purge');
const sql = neon(env.DATABASE_URL);

/**
 * Prefixes emitted by the repo's own harnesses. Kept explicit rather than
 * matched loosely, so an account is only called synthetic on the strength of a
 * prefix we can point at inside this repository.
 */
const SYNTHETIC_PREFIXES = [
  'e2e-', 'c8-live-probe-', 'c9-', 'c9', 'a4-', 'b1-', 'walk-', 'probe-',
  'import-', 'verifyc-', 'verify-', 'phase2-', 'phase3-', 'phase5-', 'int3-',
  'p1-', 'p3-', 'desktop-proxy-', 'test-', 'demo-', 'mev1-', 'onb',
  // scripts/quick-launch-verify.mjs:10 builds exactly `ql-${Date.now()}@...`.
  'ql-',
];

/** Domains that only the test harnesses ever use. */
const SYNTHETIC_DOMAINS = ['dealflow.test', 'ci.invalid', 'example.com', 'example.test'];

/**
 * The operator account. Listed explicitly rather than inferred, because
 * "looks human" is exactly the judgement that must not be automated.
 */
const OPERATOR_EMAILS = ['roman.shumate@dealswiftautomation.com'];

function classify(email) {
  const lower = email.toLowerCase();
  if (OPERATOR_EMAILS.includes(lower)) {
    return { category: 'A', why: 'operator account (explicitly listed)' };
  }
  if (SYNTHETIC_DOMAINS.some((d) => lower.endsWith(`@${d}`))) {
    return { category: 'B', why: 'non-production domain used only by test harnesses' };
  }
  const local = lower.split('@')[0];
  const hit = SYNTHETIC_PREFIXES.find((p) => local.startsWith(p));
  if (hit) return { category: 'B', why: `local-part matches harness prefix "${hit}"` };
  if (lower.includes('anonymized.invalid')) {
    return { category: 'C', why: 'already-anonymised marker but the row survives' };
  }
  return { category: 'C', why: 'no synthetic evidence and not on the operator list' };
}

const orphans = await sql`
  SELECT u.id, u.email, u.role, u."createdAt" AS created_at
  FROM "user" u
  LEFT JOIN organization_members om ON om.user_id = u.id
  WHERE om.user_id IS NULL
  ORDER BY u."createdAt" DESC
`;

const results = orphans.map((u) => ({ ...u, ...classify(u.email) }));

const byCat = { A: [], B: [], C: [] };
for (const r of results) byCat[r.category].push(r);

console.log(`orphaned accounts: ${results.length}`);
console.log(`  A REAL      ${byCat.A.length}`);
console.log(`  B SYNTHETIC ${byCat.B.length}`);
console.log(`  C UNCERTAIN ${byCat.C.length}`);

for (const cat of ['A', 'B', 'C']) {
  if (!byCat[cat].length) continue;
  console.log(`\n=== CATEGORY ${cat} (${byCat[cat].length}) ===`);
  for (const r of byCat[cat]) {
    console.log(`  ${r.email}  role=${r.role}  ${r.why}`);
  }
}

console.log('');
if (!APPLY) {
  console.log('DRY RUN - nothing was written. Re-run with --apply to act.');
  process.exit(0);
}

const actions = [];

// ---- Category A: backfill a real organization + OWNER membership ----------
// Non-destructive: creates rows, deletes nothing, preserves every existing
// record and billing relationship.
for (const u of byCat.A) {
  const orgId = `org_${u.id.slice(0, 24)}`;
  const slug = u.email.split('@')[0].replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await sql`
    INSERT INTO organizations (id, name, slug, owner_user_id, created_at, updated_at)
    VALUES (${orgId}, ${u.email.split('@')[0]}, ${slug}, ${u.id}, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO organization_members (id, user_id, organization_id, role, created_at)
    VALUES (${`mem_${u.id.slice(0, 24)}`}, ${u.id}, ${orgId}, 'OWNER', NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, trial_ends_at, created_at)
    VALUES (${`sub_${u.id.slice(0, 24)}`}, ${orgId}, 'plan_free', 'trial', NOW() + INTERVAL '14 days', NOW())
    ON CONFLICT (id) DO NOTHING
  `;
  actions.push(`A backfilled org ${orgId} for ${u.email}`);
}

// ---- Category B: revoke sessions, anonymise; delete only with --purge -----
for (const u of byCat.B) {
  await sql`DELETE FROM session WHERE "userId" = ${u.id}`;
  if (PURGE) {
    await sql`DELETE FROM account WHERE "userId" = ${u.id}`;
    await sql`DELETE FROM "user" WHERE id = ${u.id}`;
    actions.push(`B revoked sessions + PURGED ${u.email}`);
  } else {
    // Anonymise rather than delete by default: the row stays as evidence, but
    // the address can no longer receive mail or be mistaken for a live user.
    await sql`UPDATE "user" SET email = ${`deleted+${u.id}@anonymized.invalid`} WHERE id = ${u.id}`;
    actions.push(`B revoked sessions + anonymised ${u.email}`);
  }
}

// ---- Category C: quarantine only, never delete ---------------------------
for (const u of byCat.C) {
  await sql`DELETE FROM session WHERE "userId" = ${u.id}`;
  actions.push(`C revoked sessions ONLY, preserved ${u.email}`);
}

console.log(`APPLIED ${actions.length} action(s):`);
for (const a of actions) console.log(`  - ${a}`);