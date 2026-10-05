import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const migrations = process.argv.slice(2);

if (migrations.length === 0) {
  console.log('Usage: node --env-file=.env scripts/run-migrations.mjs <migration1.sql> [migration2.sql] ...');
  console.log('Example: node --env-file=.env scripts/run-migrations.mjs db/migrations/068_user_profile_and_gamification.sql');
  process.exit(1);
}

/**
 * Strip leading SQL line comments (`--`) from a statement.
 *
 * WHY THIS EXISTS (defect found 2026-10-05, deployed as a live 500)
 * ----------------------------------------------------------------
 * `splitStatements` keeps each statement's preceding comment block attached to
 * the statement text. This runner then did:
 *
 *     const trimmed = stmt.trim();
 *     if (!trimmed || trimmed.startsWith('--')) continue;
 *
 * so ANY migration statement written under a comment block was skipped whole.
 * Migration 099 wrote a `--` header above every `CREATE TABLE`, so the runner
 * executed only the two bare `DROP TRIGGER` statements, printed
 * "All migrations complete!" and exited 0 — while none of the 13 tables were
 * created. The deployed Worker then returned HTTP 500
 * `relation "public.user_spin_wallet" does not exist`.
 *
 * The comment is documentation, not a statement. Strip it, then decide whether
 * anything executable remains.
 */
function stripLeadingComments(stmt) {
  const lines = stmt.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('--')) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n');
}

/**
 * Errors that are genuinely benign for an idempotent, additive migration.
 *
 * Deliberately NARROW. The previous list included `does not exist`, which
 * masked the failure above and would mask a genuinely wrong DATABASE_URL (a
 * database missing the tables a migration's FKs point at). That is a real
 * deployment fault and must stop the run.
 */
const BENIGN_ERROR = /(already exists|duplicate key value violates unique constraint)/i;

async function runMigrations() {
  let failures = 0;
  let applied = 0;
  let skipped = 0;

  for (const file of migrations) {
    console.log(`\n=== Running ${file} ===\n`);
    try {
      const content = readFileSync(file, 'utf-8');
      const statements = splitStatements(content);

      for (const stmt of statements) {
        const trimmed = stripLeadingComments(stmt).trim();
        // Now `trimmed` is empty ONLY when the statement was pure comments.
        if (!trimmed) continue;

        try {
          await sql(trimmed);
          applied++;
          const preview = trimmed.slice(0, 70).replace(/\n/g, ' ').replace(/\s+/g, ' ');
          console.log('OK:', preview + (trimmed.length > 70 ? '...' : ''));
        } catch (err) {
          if (BENIGN_ERROR.test(err.message || '')) {
            skipped++;
            console.log('SKIP:', String(err.message).slice(0, 100));
          } else {
            failures++;
            console.error('ERROR:', err.message);
            console.error('Statement:', trimmed.slice(0, 300));
          }
        }
      }
      console.log(`\n=== Completed ${file} ===`);
    } catch (err) {
      failures++;
      console.error(`Failed to read ${file}:`, err.message);
    }
  }

  // Non-zero exit on any real failure. A migration run that could not apply its
  // statements must never be reported as a success, because the caller cannot
  // otherwise tell a no-op run from a completed one.
  console.log(
    `\nSUMMARY applied=${applied} skipped=${skipped} failed=${failures}`,
  );
  if (failures > 0) {
    console.error('MIGRATION FAILED: the database is not in the expected state.');
    process.exitCode = 1;
  }
}

/**
 * The code part of a line, with any trailing `--` comment removed.
 *
 * Needed because a statement may legally end with a comment AFTER the
 * semicolon — migration 082 line 12 is:
 *
 *     ADD COLUMN ... negotiation_fee_floor_cents INTEGER DEFAULT 500000; -- $5k
 *
 * Testing `line.trim().endsWith(';')` on the raw line fails there, so the
 * statement never terminates and silently merges with the two that follow it.
 * The statement that went missing was
 * `COMMENT ON COLUMN public.pipeline_config.negotiation_strategy`, which left
 * that column undocumented in the database.
 *
 * A `--` only counts as a comment at the start of the line or after whitespace,
 * so one inside a string literal is left alone.
 */
function stripTrailingComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'") {
      if (inString && line[i + 1] === "'") { i++; continue; } // escaped quote
      inString = !inString;
      continue;
    }
    if (!inString && ch === '-' && line[i + 1] === '-') {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function splitStatements(content) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;

  const lines = content.split('\n');
  for (const line of lines) {
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) {
        inDollarQuote = !inDollarQuote;
      }
    }

    current += line + '\n';

    if (!inDollarQuote && stripTrailingComment(line).trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

runMigrations().then(() => {
  console.log('\n\nAll migrations complete!');
  process.exit(0);
}).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
