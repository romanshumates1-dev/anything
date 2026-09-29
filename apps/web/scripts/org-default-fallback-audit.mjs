/** Read-only: how bad is the org_default fallback in getOrganization()? */
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
  } catch (err) {
    console.log(`\n### ${label}\n  ERROR: ${err.message}`);
  }
};

// Does org_default exist and how much real data sits behind it?
await q('org_default exists + data volume', `
  SELECT o.id, o.name,
    (SELECT count(*) FROM organization_members m WHERE m.organization_id = o.id) AS members,
    (SELECT count(*) FROM leads l WHERE l.organization_id = o.id)               AS leads,
    (SELECT count(*) FROM campaigns c WHERE c.organization_id = o.id)           AS campaigns
  FROM organizations o WHERE o.id = 'org_default'
`);

// Who currently resolves to org_default via the fallback?
//   authenticated + NO membership row  ->  fallback grants org_default
await q('users who get org_default VIA THE FALLBACK (no membership)', `
  SELECT u.role, count(*) AS n
  FROM "user" u
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
  GROUP BY 1 ORDER BY 2 DESC
`);

// Of those, how many have a session that is still valid RIGHT NOW?
await q('membership-less users with a LIVE session (actual exposure)', `
  SELECT u.email, u.role, s."expiresAt"
  FROM "user" u
  JOIN session s ON s."userId" = u.id
  WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id = u.id)
    AND s."expiresAt" > now()
  ORDER BY s."expiresAt" DESC
`);

// Sanity: is org_default the org platform admins are meant to use?
await q('members of org_default (is it an admin org?)', `
  SELECT m.role AS membership_role, u.role AS user_role, count(*) AS n
  FROM organization_members m JOIN "user" u ON u.id = m.user_id
  WHERE m.organization_id = 'org_default'
  GROUP BY 1, 2 ORDER BY 3 DESC
`);

console.log('\n=== DONE (read-only) ===');
