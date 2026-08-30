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

async function runMigrations() {
  for (const file of migrations) {
    console.log(`\n=== Running ${file} ===\n`);
    try {
      const content = readFileSync(file, 'utf-8');
      const statements = splitStatements(content);

      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (!trimmed || trimmed.startsWith('--')) continue;

        try {
          await sql(trimmed);
          const preview = trimmed.slice(0, 70).replace(/\n/g, ' ').replace(/\s+/g, ' ');
          console.log('OK:', preview + (trimmed.length > 70 ? '...' : ''));
        } catch (err) {
          if (err.message?.includes('already exists') ||
              err.message?.includes('duplicate key') ||
              err.message?.includes('does not exist') ||
              err.message?.includes('NOTICE')) {
            console.log('SKIP:', err.message.slice(0, 100));
          } else {
            console.error('ERROR:', err.message);
            console.error('Statement:', trimmed.slice(0, 300));
          }
        }
      }
      console.log(`\n=== Completed ${file} ===`);
    } catch (err) {
      console.error(`Failed to read ${file}:`, err.message);
    }
  }
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

    if (!inDollarQuote && line.trim().endsWith(';')) {
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
