/**
 * Apply SPECIFIC, individually-named migrations to the configured database.
 *
 * Deliberately not `migrate.mjs`: that replays all 93 files, and the release
 * gate's job for the shared database is to apply only what has been reviewed
 * for it (each file here is additive and idempotent, and each was verified on
 * a from-scratch PGlite build first). Prints the statement count per file.
 *
 *   node --env-file=.env scripts/apply-specific.mjs 092_contracts_metadata.sql 093_rate_limit_org_text.sql
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './lib/split-sql.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');

if (!process.env.DATABASE_URL) {
  console.error('[apply] DATABASE_URL not set');
  process.exit(1);
}

const wanted = process.argv.slice(2);
if (wanted.length === 0) {
  const all = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  console.error(`[apply] name the files to apply. Available (last 5): ${all.slice(-5).join(', ')}`);
  process.exit(2);
}

const sql = neon(process.env.DATABASE_URL);
const TX_CONTROL = /^(begin|commit|end|rollback|start\s+transaction|abort)\b/i;

for (const name of wanted) {
  const path = join(migrationsDir, name);
  let ddl;
  try {
    ddl = readFileSync(path, 'utf8');
  } catch {
    console.error(`[apply] SKIP ${name}: not found`);
    process.exit(2);
  }
  const statements = splitStatements(ddl).filter((s) => !TX_CONTROL.test(s.trim()));
  let applied = 0;
  for (const stmt of statements) {
    try {
      // The driver's STRING form: sql(text) / sql(text, params). There is no
      // `.query()` method on the tagged function.
      await sql(stmt);
      applied++;
    } catch (err) {
      // Idempotent DDL ("already exists") is a success, not a failure.
      const msg = String(err.message || err);
      if (/already exists|duplicate key|does not need to exist/i.test(msg)) {
        applied++;
        continue;
      }
      console.error(`[apply] FAILED ${name}: ${msg.split('\n')[0]}`);
      console.error(`        stmt: ${stmt.replace(/\s+/g, ' ').slice(0, 160)}`);
      process.exit(1);
    }
  }
  console.log(`[apply] ${name}: ${applied}/${statements.length} statement(s) applied`);
}

console.log('[apply] done');
process.exit(0);
