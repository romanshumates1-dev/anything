/** Read-only: are the duplicated auth tables in `public` and `neon_auth` both live? */
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

const counts = await sql(`
  SELECT 'public.user' AS t, count(*)::text AS n FROM public."user"
  UNION ALL SELECT 'neon_auth.user', count(*)::text FROM neon_auth."user"
  UNION ALL SELECT 'public.session', count(*)::text FROM public.session
  UNION ALL SELECT 'neon_auth.session', count(*)::text FROM neon_auth.session
  UNION ALL SELECT 'public.account', count(*)::text FROM public.account
  UNION ALL SELECT 'neon_auth.account', count(*)::text FROM neon_auth.account
`);
console.log('--- row counts per schema ---');
console.table(counts);

// Do the same people exist in both? (split-brain detector)
const overlap = await sql(`
  SELECT
    (SELECT count(*) FROM public."user")     AS public_users,
    (SELECT count(*) FROM neon_auth."user")  AS neon_auth_users,
    (SELECT count(*) FROM public."user" p
       WHERE EXISTS (SELECT 1 FROM neon_auth."user" n WHERE n.id = p.id)) AS in_both_by_id,
    (SELECT count(*) FROM public."user" p
       WHERE EXISTS (SELECT 1 FROM neon_auth."user" n WHERE lower(n.email) = lower(p.email))) AS in_both_by_email
`);
console.log('--- overlap between the two user tables ---');
console.table(overlap);

// Most recent row in each - which one is being written to NOW?
const recent = await sql(`
  SELECT 'public."user"' AS tbl, max("createdAt")::text AS newest
  FROM public."user"
  UNION ALL
  SELECT 'neon_auth."user"', max("createdAt")::text FROM neon_auth."user"
  UNION ALL
  SELECT 'public.session', max("createdAt")::text FROM public.session
  UNION ALL
  SELECT 'neon_auth.session', max("createdAt")::text FROM neon_auth.session
`);
console.log('--- newest row per table (who is live?) ---');
console.table(recent);
