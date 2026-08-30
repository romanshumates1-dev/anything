#!/usr/bin/env node
/**
 * Fix missing database schema for launch gate
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('Checking and fixing missing schema...\n');

  // Check leads table columns
  const leadsCols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'leads'
    ORDER BY ordinal_position
  `);
  console.log('Leads columns:', leadsCols.rows.map(r => r.column_name).join(', '));

  // Check if status column exists
  const hasStatus = leadsCols.rows.some(r => r.column_name === 'status');
  if (!hasStatus) {
    console.log('\nAdding status column to leads table...');
    await pool.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'NEW'
    `);
    console.log('✅ Status column added');
  } else {
    console.log('✅ Status column exists');
  }

  // Check if compliance_gates table exists
  const tablesCheck = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'compliance_gates'
  `);

  if (tablesCheck.rowCount === 0) {
    console.log('\nCreating compliance_gates table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compliance_gates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT,
        jurisdiction TEXT,
        attorney_reviewed BOOLEAN DEFAULT false,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed some default compliance gates
    await pool.query(`
      INSERT INTO compliance_gates (name, description, jurisdiction, attorney_reviewed, active)
      VALUES
        ('kill_switch_emergency', 'Emergency kill switch to halt all operations', 'ALL', false, false),
        ('sms_outbound_general', 'SMS outbound messaging gate', 'ALL', false, true),
        ('email_outbound_general', 'Email outbound messaging gate', 'ALL', false, true),
        ('contract_generation', 'Contract generation gate', 'ALL', false, true),
        ('buyer_matching', 'Buyer matching gate', 'ALL', false, true)
      ON CONFLICT DO NOTHING
    `);

    console.log('✅ Compliance gates table created with default gates');
  } else {
    console.log('✅ Compliance gates table exists');
  }

  // Verify final state
  const gatesCount = await pool.query('SELECT COUNT(*) as count FROM compliance_gates');
  const leadsWithStatus = await pool.query(`SELECT COUNT(*) as count FROM leads WHERE status IS NOT NULL`);

  console.log('\n--- VERIFICATION ---');
  console.log(`Compliance gates: ${gatesCount.rows[0].count}`);
  console.log(`Leads with status: ${leadsWithStatus.rows[0].count}`);

  await pool.end();
  console.log('\n✅ Schema fixes complete');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
