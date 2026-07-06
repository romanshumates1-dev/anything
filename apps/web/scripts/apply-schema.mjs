import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

/**
 * Split SQL into individual statements, respecting:
 * - String literals (single quotes)
 * - Semicolons inside strings
 * - Multi-line statements
 * - Comments
 */
function splitStatements(content) {
  const statements = [];
  let current = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1] || '';

    // Handle string literals
    if (ch === "'" && !inLineComment && !inBlockComment) {
      inString = !inString;
      current += ch;
      continue;
    }

    // Handle line comments
    if (ch === '-' && next === '-' && !inString && !inBlockComment) {
      inLineComment = true;
      current += ch;
      continue;
    }

    // Handle block comments
    if (ch === '/' && next === '*' && !inString && !inLineComment) {
      inBlockComment = true;
      current += ch;
      continue;
    }

    if (ch === '*' && next === '/' && inBlockComment) {
      inBlockComment = false;
      current += ch;
      continue;
    }

    // End of line comment
    if (ch === '\n' && inLineComment) {
      inLineComment = false;
      current += ch;
      continue;
    }

    // Statement separator (semicolon outside strings and comments)
    if (ch === ';' && !inString && !inLineComment && !inBlockComment) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  // Handle last statement without trailing semicolon
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

async function main() {
  try {
    // Apply base schema
    console.log('Applying db/schema.sql...');
    const baseContent = readFileSync(resolve(__dirname, '..', 'db/schema.sql'), 'utf-8');
    const baseStatements = splitStatements(baseContent);
    console.log(`  Found ${baseStatements.length} statements`);

    let baseCount = 0;
    for (const stmt of baseStatements) {
      try {
        await sql(stmt);
        baseCount++;
      } catch (e) {
        if (e.message?.includes('already exists')) {
          // Skip - idempotent
        } else {
          console.error(`  Error: ${e.message.slice(0, 100)}`);
        }
      }
    }
    console.log(`  ✓ Applied ${baseCount} statements`);

    // Apply campaign pipeline schema
    console.log('Applying db/campaign-pipeline-schema.sql...');
    const pipelineContent = readFileSync(resolve(__dirname, '..', 'db/campaign-pipeline-schema.sql'), 'utf-8');
    const pipelineStatements = splitStatements(pipelineContent);
    console.log(`  Found ${pipelineStatements.length} statements`);

    let pipelineCount = 0;
    for (const stmt of pipelineStatements) {
      try {
        await sql(stmt);
        pipelineCount++;
      } catch (e) {
        if (e.message?.includes('already exists')) {
          // Skip - idempotent
        } else {
          console.error(`  Error: ${e.message.slice(0, 150)}`);
          console.error(`  SQL: ${stmt.slice(0, 80)}...`);
        }
      }
    }
    console.log(`  ✓ Applied ${pipelineCount} statements`);

    // Verify tables
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    console.log('\n=== Tables ===');
    for (const t of tables) {
      console.log(`  ✓ ${t.table_name}`);
    }
    console.log(`\nTotal: ${tables.length} tables`);

    // Verify custom types
    const types = await sql`
      SELECT typname FROM pg_type
      WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND typtype = 'e'
      ORDER BY typname
    `;
    if (types.length > 0) {
      console.log('\n=== Custom ENUM Types ===');
      for (const t of types) {
        console.log(`  ✓ ${t.typname}`);
      }
    }

    process.exit(0);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

main();