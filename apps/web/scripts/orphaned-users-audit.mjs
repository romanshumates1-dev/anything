/**
 * ORPHANED-USER INVESTIGATION (read-only, no writes, no deletions).
 *
 * There are users with no `organization_members` row. Before touching any of
 * them we need to know WHY they exist and what they can actually do - an
 * orphaned account that can still authenticate and read tenant data is an
 * authorization defect, while one that cannot reach anything is a data-hygiene
 * issue. Deleting rows to make the count drop is explicitly out of scope.
 *
 * Reports, for the orphaned set and the healthy set side by side:
 *   - counts and signup spread over time (a step change implies a code path)
 *   - whether they can authenticate (account/session rows)
 *   - whether they hold any tenant-scoped data
 *   - what the role column says (an orphaned ADMIN would be the serious case)
 *   - which signup path created them, if that is recorded
 *
 * Usage: node scripts/orphaned-users-audit.mjs
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sql = neon(env.DATABASE_URL);

const q = async (label, text) => {
  try {
    const rows = await sql(text);
    console.log(`\n### ${label}`);
    console.table(rows);
    return rows;
  } catch (err) {
    console.log(`\n### ${label}\n  ERROR: ${err.message}`);
    return null;
  }
};

console.log('=== ORPHANED USER AUDIT (read-only) ===');

// Baseline counts. Better Auth uses singular `session` (verified against
// information_schema - the earlier `sessions` reference errored).
await q('baseline counts', `
  SELECT
    (SELECT count(*) FROM "user")                              AS users,
    (SELECT count(*) FROM organization_members)                AS memberships,
    (SELECT count(*) FROM "user" u
       WHERE NOT EXISTS (SELECT 1 FROM organization_members m
                          WHERE m.user_id = u.id))             AS orphaned,
    (SELECT count(*) FROM account)                             AS accounts,
    (SELECT count(*) FROM session)                             AS sessions
`);

// The orphaned set itself.
await q('orphaned users (up to 60)', `
  SELECT u.id, u.email, u.role, u."createdAt"::date AS created
  FROM "user" u
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
  ORDER BY u."createdAt" DESC
  LIMIT 60
`);

// Signup spread - a cluster on one date points at a specific code path.
await q('orphaned by signup date', `
  SELECT u."createdAt"::date AS created, count(*) AS n
  FROM "user" u
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
  GROUP BY 1 ORDER BY 1 DESC
`);

// Can they authenticate? Better Auth stores camelCase `userId` (quoted in
// Postgres), which is why the earlier snake_case version errored.
await q('orphaned vs healthy: able to authenticate', `
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
         THEN 'has_membership' ELSE 'ORPHANED' END AS bucket,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM account a WHERE a."userId" = u.id)) AS with_account,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM session s WHERE s."userId" = u.id)) AS with_session,
    count(*) AS total
  FROM "user" u
  GROUP BY 1
`);

// The serious question: does an orphaned account own an organization, or hold
// any org-scoped data? `leads` is scoped by organization_id (there is no
// leads.owner_user_id), so membership is what gates access to it.
await q('orphaned users owning an organization', `
  SELECT u.email, u.role, o.id AS org_id, o.name
  FROM "user" u
  JOIN organizations o ON o.owner_user_id = u.id
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
  ORDER BY u."createdAt" DESC
  LIMIT 40
`);

await q('orphaned users owning an organization (count)', `
  SELECT count(*) AS orphans_that_own_an_org
  FROM "user" u
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
    AND EXISTS (SELECT 1 FROM organizations o WHERE o.owner_user_id = u.id)
`);

// Integrity: an orphan pointing at an org via session.activeOrganizationId
// would be a stale/broken tenancy link - logged in "as" an organization they
// are not a member of. That state must be empty.
await q('orphans with a stale activeOrganizationId', `
  SELECT u.email, s."activeOrganizationId",
         (SELECT count(*) FROM organization_members m
           WHERE m.user_id = u.id
             AND m.organization_id = s."activeOrganizationId") AS is_member
  FROM "user" u
  JOIN session s ON s."userId" = u.id
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
    AND s."activeOrganizationId" IS NOT NULL
  LIMIT 40
`);

// Are any of these org ids real? (A dangling id is a different defect.)
await q('stale activeOrganizationId count', `
  SELECT count(*) AS orphans_with_active_org
  FROM "user" u
  JOIN session s ON s."userId" = u.id
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
    AND s."activeOrganizationId" IS NOT NULL
`);

// Orphan sessions that are still unexpired (i.e. can actually be used now).
await q('orphan sessions still valid', `
  SELECT count(*) AS live_orphan_sessions
  FROM "user" u
  JOIN session s ON s."userId" = u.id
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
    AND s."expiresAt" > now()
`);

// Role distribution - an orphaned ADMIN is the case that matters.
await q('orphaned users by role', `
  SELECT COALESCE(u.role, '<null>') AS role, count(*) AS n
  FROM "user" u
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
  GROUP BY 1 ORDER BY 2 DESC
`);

// Do memberships ever exist for users created in the same window? Checks
// whether the whole table is stale rather than a specific signup path.
await q('membership coverage by signup date (orphans vs total)', `
  SELECT u."createdAt"::date AS created,
         count(*) AS total,
         count(*) FILTER (WHERE EXISTS
           (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)) AS with_membership
  FROM "user" u
  GROUP BY 1 ORDER BY 1 DESC LIMIT 30
`);

console.log('\n=== DONE (no rows were modified) ===');
