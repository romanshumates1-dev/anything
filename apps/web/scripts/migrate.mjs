/**
 * Idempotent migration runner — applies every db/migrations/*.sql in order and
 * seeds the reference data they carry (the negotiation profiles seed lives in
 * 012, so a fresh DB comes up fully configured). Safe to re-run: every
 * migration uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
 *
 *   node --env-file=.env scripts/migrate.mjs
 * The docker seed step and DEPLOY.md both call this.
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
function splitSql(ddl) {
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

let applied = 0;
for (const file of files) {
  const ddl = readFileSync(join(migrationsDir, file), 'utf8');
  const stmts = splitSql(ddl);
  try {
    for (const stmt of stmts) await sql([stmt]);
    console.log(`[migrate] ✓ ${file} (${stmts.length} stmt)`);
    applied++;
  } catch (err) {
    console.error(`[migrate] ✗ ${file}: ${err?.message || err}`);
    process.exit(1);
  }
}
console.log(`[migrate] done — ${applied}/${files.length} applied (idempotent).`);
process.exit(0);
