/**
 * Idempotent migration runner — applies every db/migrations/*.sql in order and
 * seeds the reference data they carry (the negotiation profiles seed lives in
 * 012, so a fresh DB comes up fully configured). Safe to re-run: every
 * migration uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
 *
 *   node --env-file=.env scripts/migrate.mjs            # apply
 *   node --env-file=.env scripts/migrate.mjs --dry-run  # verify only, writes nothing
 * The docker seed step and DEPLOY.md both call this.
 *
 * --dry-run replays every migration inside a single BEGIN/ROLLBACK over the
 * `pg` wire protocol and reports each file that cannot apply, in one pass.
 * It exists because the apply path ABORTS on the first failing statement and
 * commits everything before it, so a landmine late in the sequence leaves the
 * DB half-migrated with no way to see the rest. The motivating defect:
 * migrations 066/067 widen subscription_plans_tier_check to 7 tiers and then
 * 075 narrows it back to 4, so on a DB that already holds pro/business/scale
 * rows the ADD CONSTRAINT fails and the entire run stops there.
 */
import { neon } from '@neondatabase/serverless';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');

if (!process.env.DATABASE_URL) {
  console.error('[migrate] DATABASE_URL not set. Point it at Neon (the app uses the neon serverless driver).');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
console.log(`[migrate] ${files.length} migration file(s) in ${migrationsDir}`);

/**
 * Split SQL into statements WITHOUT breaking dollar-quoted bodies ($$...$$ or
 * $tag$...$tag$) — migration 005 carries a DO $$ ... $$; block that a naive
 * `;` split corrupts (found by running this runner, not by review).
 */
export function splitSql(ddl) {
  const stmts = [];
  let buf = '';
  let dollarTag = null; // '$$' or '$tag$' while inside a dollar-quoted body
  let inLineComment = false; // inside `-- ...` until newline
  let inString = false; // inside a '...' literal
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i];
    const rest = ddl.slice(i);

    if (inLineComment) {
      buf += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (inString) {
      buf += ch;
      if (ch === "'" && ddl[i + 1] === "'") { buf += "'"; i++; } // escaped ''
      else if (ch === "'") inString = false;
      continue;
    }
    if (rest.startsWith('--')) {
      inLineComment = true;
      buf += ch;
      continue;
    }
    if (ch === "'") {
      inString = true;
      buf += ch;
      continue;
    }
    const open = rest.match(/^\$[A-Za-z_]*\$/);
    if (open) {
      dollarTag = open[0];
      buf += dollarTag;
      i += dollarTag.length - 1;
      continue;
    }
    if (ch === ';') {
      stmts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) stmts.push(buf);
  return stmts
    .map((s) => s.trim())
    .filter((s) => s && !s.split('\n').every((l) => l.trim().startsWith('--') || l.trim() === ''));
}

/**
 * `--dry-run` — verify every migration against the live schema, writing
 * nothing. All files replay inside ONE BEGIN…ROLLBACK, with a SAVEPOINT per
 * file, so a file sees everything the files before it created (080 must be
 * visible to 086, 077 to 082) while a single failing file is reported and
 * skipped instead of poisoning the rest.
 *
 * Transaction-control statements are stripped: a migration's own `COMMIT;`
 * would end the dry-run transaction and the trailing ROLLBACK would become a
 * no-op, committing the very changes this mode exists to avoid.
 */
const DRY_RUN = process.argv.includes('--dry-run');
const TX_CONTROL = /^(begin|commit|end|rollback|start\s+transaction|abort)\b/i;

let applied = 0;
const failures = [];
let pgClient = null;

if (DRY_RUN) {
  const { default: pg } = await import('pg');
  pgClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  await pgClient.query('BEGIN');
}

for (const file of files) {
  const ddl = readFileSync(join(migrationsDir, file), 'utf8');
  const stmts = splitSql(ddl);

  if (!DRY_RUN) {
    try {
      for (const stmt of stmts) await sql([stmt]);
      console.log(`[migrate] ✓ ${file} (${stmts.length} stmt)`);
      applied++;
    } catch (err) {
      console.error(`[migrate] ✗ ${file}: ${err?.message || err}`);
      process.exit(1);
    }
    continue;
  }

  const runnable = stmts
    .map((s, i) => ({ sql: s.trim().replace(/;\s*$/, ''), at: i + 1 }))
    .filter((s) => s.sql && !TX_CONTROL.test(s.sql));

  const savepoint = `sp_${file.replace(/[^a-z0-9]+/gi, '_')}`;
  await pgClient.query(`SAVEPOINT ${savepoint}`);

  let ok = true;
  for (const stmt of runnable) {
    try {
      await pgClient.query(stmt.sql);
    } catch (err) {
      console.error(`[migrate] ✗ ${file} (stmt ${stmt.at}/${stmts.length}): ${err?.message || err}`);
      ok = false;
      break;
    }
  }

  if (ok) {
    await pgClient.query(`RELEASE SAVEPOINT ${savepoint}`);
    console.log(`[migrate] ✓ ${file} (${runnable.length} stmt, rolled back)`);
    applied++;
  } else {
    // Undo just this file, then let the next file keep replaying against the
    // schema produced by the successful ones.
    await pgClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    failures.push(file);
  }
}

if (DRY_RUN) {
  // Discard every change — this mode must never mutate the database.
  await pgClient.query('ROLLBACK');
  await pgClient.end();
  console.log(`[migrate] dry-run complete — ${applied}/${files.length} file(s) apply cleanly.`);
  if (failures.length) {
    console.error(`[migrate] ${failures.length} file(s) CANNOT apply: ${failures.join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

console.log(`[migrate] done — ${applied}/${files.length} applied (idempotent).`);
process.exit(0);
