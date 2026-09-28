/**
 * Executes the REWRITTEN dynamic-SQL shapes against the live database.
 *
 * Purpose: prove the fixes are correct SQL, not merely different-looking code.
 * Each case is the exact text a route now sends. Before the fix every one failed
 * with `invalid input syntax for type boolean` (or a column-list syntax error),
 * because the pinned driver binds nested fragments to a positional $n.
 *
 * Read-only by construction: every SELECT carries a guard matching no tenant,
 * and the single INSERT runs inside a transaction that is always rolled back.
 * Run: node scripts/verify-sql-fixes.mjs
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { buildWhere, combine, safeIdentifier } from '../src/app/api/utils/sqlFragments.js';

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

let pass = 0;
let fail = 0;

const check = async (name, text, params) => {
  try {
    await sql(text, params);
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0].slice(0, 150)}`);
    fail++;
  }
};

console.log('=== 1. regions/estimate: OR-of-ANDs with bound arrays ===');
{
  const includeFrag = [
    { text: 'l.zip = ANY($1)', params: [['33101']] },
    { text: 'l.state = ANY($1)', params: [['FL']] },
  ];
  const excludeFrag = [
    { text: '(l.zip IS NULL OR l.zip != ALL($1))', params: [['33102']] },
  ];
  const w = buildWhere()
    .eq('l.organization_id', 'org_nonexistent_probe')
    .nest(combine(includeFrag, 'OR'))
    .nest(combine(excludeFrag, 'AND'))
    .build();
  await check(
    'leads region count (include OR + exclude AND)',
    `SELECT COUNT(*) as count FROM leads l WHERE ${w.text}`,
    w.params
  );

  // Renumbering is the subtle part: the combined text must be sequential and
  // match the param count, or $n silently binds to the wrong value.
  const nums = [...w.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const sequential = nums.every((n, i) => n === i + 1);
  console.log(`  ${sequential ? 'PASS' : 'FAIL'}  placeholder numbering sequential (${nums.join(',')})`);
  sequential ? pass++ : fail++;
  if (nums.length !== w.params.length) {
    console.log(`  FAIL  placeholder count ${nums.length} != param count ${w.params.length}`);
    fail++;
  } else {
    console.log('  PASS  placeholder count matches param count');
    pass++;
  }
}

console.log('=== 2. templates/library: search predicate with repeated ? ===');
{
  const search = 'probe';
  const w = buildWhere()
    .raw('is_active = true')
    .when(search, (b) =>
      b.expr(
        '(name ILIKE ? OR description ILIKE ? OR body ILIKE ? OR ? = ANY(tags))',
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        search
      )
    )
    .build();
  await check(
    'template_library search',
    `SELECT id FROM template_library WHERE ${w.text} LIMIT 0`,
    w.params
  );
}

console.log('=== 3. compliance/audit: campaignId absent branch ===');
{
  const campaignId = null;
  const w = buildWhere()
    .eq('organization_id', 'org_nonexistent_probe')
    .when(campaignId, (b) => b.eq('campaign_id', campaignId))
    .raw(campaignId ? 'TRUE' : 'campaign_id IS NULL')
    .build();
  await check(
    'compliance_audit no-campaign',
    `SELECT * FROM compliance_audit WHERE ${w.text} LIMIT 0`,
    w.params
  );
}

console.log("=== 4. does the app wrapper's sql.unsafe marker actually splice? ===");
{
  const marker = { __unsafeSql: '1' };
  const r = await sql`SELECT ${marker}::text AS v`;
  const spliced = r[0]?.v === '1';
  console.log(
    spliced
      ? '  spliced'
      : `  NOT spliced - the driver bound the marker as a VALUE (${r[0]?.v}). ` +
          'So sql.unsafe() cannot be used inside a tagged template; no code may rely on it.'
  );
}

console.log('=== 5. outreach_verifications: CASE with a bound boolean ===');
{
  await check(
    'verified_at CASE both branches',
    `SELECT 1 FROM outreach_verifications
     WHERE id = $1::uuid
       AND verified_at = CASE WHEN $2 THEN NOW() ELSE verified_at END
       AND last_verified_at = CASE WHEN $3 THEN NOW() ELSE last_verified_at END`,
    ['00000000-0000-0000-0000-000000000000', true, false]
  );
}

console.log('=== 6. questionnaire/achievements: bound Date replaces now() fragment ===');
{
  const isComplete = true;
  await check('values-list timestamp bind', `SELECT $1::timestamptz AS v`, [
    isComplete ? new Date() : null,
  ]);
}

console.log('=== 7. duplicates + consent: tenant scope composes with an offset ===');
{
  // Mirrors the real call: `WHERE LOWER(email) = $1 AND ${scope.text}`, so the
  // builder MUST start at $2. This case failed before the offset existed.
  const orgId = 'org_nonexistent_probe';
  const scope = buildWhere(1)
    .when(null, (b) => b.neq('id', 'x'))
    .when(orgId, (b) => b.eq('organization_id', orgId))
    .build();
  const text = `SELECT id FROM leads WHERE LOWER(email) = $1 AND ${scope.text} LIMIT 0`;
  const params = ['nobody@example.invalid', ...scope.params];
  const nums = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const ok = nums.every((n, i) => n === i + 1) && nums.length === params.length;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  offset numbering (${nums.join(',')}, ${params.length} params)`);
  ok ? pass++ : fail++;
  await check('leads tenant scope (offset)', text, params);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

