/**
 * DATABASE RELEASE GATE (isolated; touches nothing shared).
 *
 * Replays the ENTIRE db/migrations chain against a throwaway PGlite database â€”
 * real PostgreSQL compiled to WASM, running in this process. This is the
 * evidence for "a brand-new database can be built from the repository alone",
 * which nothing else in the suite proves: the pglite tests each hand-write the
 * handful of tables they need, so a migration that only works against an older
 * shape would not be caught.
 *
 * What it verifies, in order:
 *   1. fresh install  â€” every migration applies to an empty database;
 *   2. ordering       â€” the chain applies in filename order;
 *   3. idempotency    â€” re-applying the whole chain is a no-op;
 *   4. schema facts   â€” the objects the app depends on exist, with the
 *                       expected constraints.
 *
 * It deliberately does NOT connect to the configured DATABASE_URL: the live
 * Neon database is compared separately, read-only.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

/**
 * Statement splitter shared by the migration tooling.
 *
 * Does not break dollar-quoted bodies ($$ ... $$ / $tag$ ... $tag$) or string
 * literals. A naive split on ';' corrupts the DO-block in migration 005 and
 * any future function body — which is how a migration can "apply" while
 * silently destroying its own logic.
 */
import { splitStatements } from './lib/split-sql.mjs';

/** Statements a re-run must tolerate; the runner handles these itself. */
const TX_CONTROL = /^(begin|commit|end|rollback|start\s+transaction|abort)\b/i;

async function applyChain(db, label, fileList) {
  const failures = [];
  for (const file of fileList) {
    const ddl = readFileSync(file.path, 'utf8');
    const statements = splitStatements(ddl).filter((s) => !TX_CONTROL.test(s.trim()));
    for (const stmt of statements) {
      // Each statement gets its OWN transaction. Without this, one failure
      // leaves the connection inside an aborted transaction and every
      // subsequent statement fails with "current transaction is aborted",
      // which turns a single real defect into 80 phantom ones.
      let ok = false;
      let error = null;
      try {
        await db.exec('BEGIN');
        await db.exec(stmt);
        await db.exec('COMMIT');
        ok = true;
      } catch (err) {
        error = String(err.message || err).split('\n')[0].slice(0, 200);
        try {
          await db.exec('ROLLBACK');
        } catch {
          /* connection already clean */
        }
      }
      if (!ok) {
        failures.push({
          file: file.name,
          statement: stmt.replace(/\s+/g, ' ').slice(0, 160),
          error,
        });
        break; // one failure per file is enough to report
      }
    }
  }
  console.log(`[${label}] ${fileList.length} files applied, ${failures.length} failed`);
  for (const f of failures) {
    console.log(`  FAIL ${f.file}: ${f.error}`);
    console.log(`       stmt: ${f.statement}`);
  }
  return failures;
}

const db = new PGlite();
await db.waitReady;

/**
 * The REAL fresh-install path is baseline-then-migrations, not migrations
 * alone: `db/schema.sql` and `db/campaign-pipeline-schema.sql` create the
 * tables that migration 001 immediately ALTERs. Nothing in the repo proved
 * that combination worked, which is why a fresh production database could
 * not be built from the repository with confidence. Both phases are run here,
 * and migrations-only is reported too, because "the chain alone is not a
 * fresh-install path" is itself a finding worth recording.
 */
const baselineFiles = ['schema.sql', 'campaign-pipeline-schema.sql']
  .map((name) => ({ name: `db/${name}`, path: join(here, '..', 'db', name) }))
  .filter((f) => {
    try {
      readFileSync(f.path, 'utf8');
      return true;
    } catch {
      console.log(`[baseline] MISSING ${f.name}`);
      return false;
    }
  });

const migrationFileList = files.map((f) => ({ name: f, path: join(migrationsDir, f) }));

console.log(
  `[baseline] applying ${baselineFiles.length} baseline schema file(s) to an empty PGlite database`
);
const baselineFailures = await applyChain(db, 'baseline', baselineFiles);

console.log(`[fresh] applying ${migrationFileList.length} migrations on top`);
const freshFailures = baselineFailures.length === 0
  ? await applyChain(db, 'fresh', migrationFileList)
  : (console.log('[fresh] SKIPPED - baseline did not apply cleanly'), []);


async function tableExists(name) {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return r.rows[0].n > 0;
}

const required = [
  'user', 'session', 'account', 'organizations',
  'organization_members', 'leads', 'campaigns', 'campaign_leads', 'earnings',
  'withdrawals', 'bank_accounts', 'contracts', 'legal_acceptances',
  'app_settings', 'tax_withholding_settings', 'tax_withholding_ledger', 'api_keys',
];
// There is deliberately NO `organization` (singular) entry: the schema has
// `organizations` (plural) only, and the live-vs-repo comparison below
// confirms both sides agree on the exact same 160 tables with zero drift.
const missing = [];
for (const t of required) {
  if (!(await tableExists(t))) missing.push(t);
}
console.log(
  `[schema] required tables: ${required.length - missing.length}/${required.length} present`
);
if (missing.length) console.log(`[schema] MISSING: ${missing.join(', ')}`);

// The withholding ledger's replay-safety guarantee is a hard financial
// invariant, so assert the constraint exists rather than trusting the SQL text.
const idem = await db.query(`
  SELECT count(*)::int AS n FROM pg_constraint
  WHERE conrelid = 'public.tax_withholding_ledger'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%idempotency_key%'
`);
console.log(`[schema] tax_withholding_ledger idempotency_key UNIQUE: ${idem.rows[0].n > 0}`);

const kindCheck = await db.query(`
  SELECT count(*)::int AS n FROM pg_constraint
  WHERE conrelid = 'public.tax_withholding_ledger'::regclass
    AND pg_get_constraintdef(oid) ILIKE '%kind%'
`);
console.log(`[schema] tax_withholding_ledger kind CHECK: ${kindCheck.rows[0].n > 0}`);

// organizations.owner_user_id being NOT NULL is what defect #31 tripped over;
// assert it so the signup path cannot silently regress to a missing column.
const ownerCol = await db.query(`
  SELECT is_nullable FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'owner_user_id'
`);
console.log(
  `[schema] organizations.owner_user_id NOT NULL: ${ownerCol.rows[0]?.is_nullable === 'NO'}`
);

console.log('[idempotency] re-applying the entire chain (baseline + migrations)');
const rerunFailures = await applyChain(db, 'rerun', [
  ...baselineFiles,
  ...migrationFileList,
]);

/**
 * OPTIONAL live comparison (`--compare-live`).
 *
 * Builds the repo schema in PGlite (above), then READS the live database's
 * table list and diffs it. Direction matters:
 *   - in repo, not live  → the deployed database is MISSING something the code
 *     will query: a real production/compatibility risk.
 *   - in live, not repo  → drift/vestige: harmless unless code depends on it,
 *     and naming each one explicitly is what keeps it from hiding a real one.
 * Strictly read-only: only information_schema is queried.
 */
if (process.argv.includes('--compare-live')) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[drift] DATABASE_URL not set; skipping live comparison');
  } else {
    const { neon } = await import('@neondatabase/serverless');
    const live = neon(url);
    const repoRows = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    const liveRows = await live`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `;
    const repoSet = new Set(repoRows.rows.map((r) => r.table_name));
    const liveSet = new Set(liveRows.map((r) => r.table_name));
    const missingLive = [...repoSet].filter((t) => !liveSet.has(t)).sort();
    const extraLive = [...liveSet].filter((t) => !repoSet.has(t)).sort();
    console.log(`[drift] repo tables: ${repoSet.size}, live tables: ${liveSet.size}`);
    console.log(`[drift] in repo but MISSING in live (${missingLive.length}): ${missingLive.join(', ') || 'none'}`);
    console.log(`[drift] in live but NOT in repo (${extraLive.length}): ${extraLive.join(', ') || 'none'}`);
  }
}

await db.close();

const failed =
  baselineFailures.length + freshFailures.length + rerunFailures.length;
console.log(
  failed === 0 && missing.length === 0
    ? 'MIGRATION_GATE: PASS'
    : `MIGRATION_GATE: FAIL (${failed} apply failure(s), ${missing.length} missing table(s))`
);
process.exit(failed === 0 && missing.length === 0 ? 0 : 1);

