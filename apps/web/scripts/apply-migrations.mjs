#!/usr/bin/env node
/**
 * apply-migrations.mjs
 * Apply migrations using native pg driver
 */

import pg from 'pg';
import { readFileSync } from 'fs';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false }
});

console.log('🔧 APPLYING MIGRATIONS');
console.log('='.repeat(70));
console.log('');

const migrations = [
  'db/migrations/001_add_missing_tables.sql',
  'db/migrations/050_optimization_tables.sql',
  'db/migrations/051_campaign_orchestration.sql'
];

async function main() {
  const client = await pool.connect();

  try {
    console.log('✅ Connected to database\n');

    for (const file of migrations) {
      try {
        console.log(`Applying ${file}...`);
        const sql = readFileSync(file, 'utf8');
        await client.query(sql);
        console.log(`  ✅ Success\n`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`  ⚠️  Already applied (tables exist)\n`);
        } else {
          console.error(`  ❌ Error: ${error.message}\n`);
          throw error;
        }
      }
    }

    console.log('='.repeat(70));
    console.log('✅ ALL MIGRATIONS APPLIED');
    console.log('='.repeat(70));
    process.exit(0);

  } catch (error) {
    console.error('\n💥 FATAL:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
