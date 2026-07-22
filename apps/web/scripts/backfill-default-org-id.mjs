#!/usr/bin/env node
// One-time data repair: bug #35 (fixed this sprint, see BREAKAGE_TABLE.md)
// closed 25 call-sites that read session.user.organizationId (never set by
// better-auth) and silently fell back to the literal string 'default' -
// which does not match the real seeded org id 'org_default'. Fixing those
// call-sites stopped the bleeding for NEW rows, but left every row written
// under the phantom 'default' string permanently orphaned: getOrganization()
// never returns that literal value, so no user can ever see this data again
// through the app. This script reassigns those rows to the real 'org_default'
// row. Idempotent (re-running finds zero matching rows after the first run).
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const [org] = await sql`SELECT id FROM organizations WHERE id = 'org_default'`;
  if (!org) throw new Error("FATAL: 'org_default' does not exist - refusing to reassign orphaned rows to a nonexistent org");

  const tables = await sql`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'organization_id' AND table_schema = 'public'
    ORDER BY table_name`;

  let totalFixed = 0;
  for (const { table_name } of tables) {
    const [before] = await sql([`SELECT count(*) FROM "${table_name}" WHERE organization_id = 'default'`]);
    const beforeCount = Number(before.count);
    if (beforeCount === 0) continue;

    await sql([`UPDATE "${table_name}" SET organization_id = 'org_default' WHERE organization_id = 'default'`]);

    const [after] = await sql([`SELECT count(*) FROM "${table_name}" WHERE organization_id = 'default'`]);
    console.log(`${table_name}: ${beforeCount} orphaned -> ${after.count} remaining`);
    totalFixed += beforeCount;
  }

  console.log(`\nTotal rows reassigned from 'default' to 'org_default': ${totalFixed}`);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
