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

let applied = 0;
for (const file of files) {
  const ddl = readFileSync(join(migrationsDir, file), 'utf8');
  // Split on statement boundaries, drop pure-comment chunks.
  const stmts = ddl
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.split('\n').every((l) => l.trim().startsWith('--')));
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
