// One-off RBAC DB state check (Gate A2 evidence). Plain JS, run with:
//   node --env-file=.env scripts/check-rbac-db.mjs
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const col = await sql`
  SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'role'
`;
console.log('role column:', JSON.stringify(col));

const constraint = await sql`
  SELECT conname FROM pg_constraint WHERE conname = 'user_role_check'
`;
console.log('user_role_check constraint:', JSON.stringify(constraint));

const admins = await sql`
  SELECT id, email, role, "createdAt" FROM "user" WHERE role = 'ADMIN' ORDER BY "createdAt"
`;
console.log('ADMIN rows:', JSON.stringify(admins, null, 2));

const counts = await sql`
  SELECT role, COUNT(*)::int AS n FROM "user" GROUP BY role ORDER BY role
`;
console.log('role distribution:', JSON.stringify(counts));

const owner = await sql`
  SELECT id, email, role FROM "user" WHERE lower(email) = 'roman.shumate@dealswiftautomation.com'
`;
console.log('owner row:', JSON.stringify(owner));
