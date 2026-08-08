#!/usr/bin/env node
/**
 * Apply schema for nexttodo.md features
 */
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('Applying nexttodo.md schema...\n');

  // Create payments table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID,
      deal_id TEXT NOT NULL,
      buyer_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'usd',
      method TEXT NOT NULL DEFAULT 'wire',
      status TEXT NOT NULL DEFAULT 'unpaid',
      stripe_payment_intent_id TEXT,
      stripe_client_secret TEXT,
      stripe_charge_id TEXT,
      wire_reference_id TEXT,
      wire_proof_url TEXT,
      wire_verified_by UUID,
      wire_verified_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      failure_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    )
  `).then(() => console.log('✅ payments table ready'))
    .catch(e => console.log('⚠️ payments:', e.message));

  // Create wire_instructions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wire_instructions (
      id TEXT PRIMARY KEY,
      organization_id UUID,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      routing_number TEXT,
      swift_code TEXT,
      bank_address TEXT,
      additional_instructions TEXT,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => console.log('✅ wire_instructions table ready'))
    .catch(e => console.log('⚠️ wire_instructions:', e.message));

  // Create system_alerts table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_alerts (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      metadata JSONB DEFAULT '{}',
      acknowledged BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => console.log('✅ system_alerts table ready'))
    .catch(e => console.log('⚠️ system_alerts:', e.message));

  // Seed default wire instructions
  await pool.query(`
    INSERT INTO wire_instructions (id, organization_id, bank_name, account_name, account_number, routing_number, swift_code, bank_address)
    VALUES (
      'default-wire-001',
      '00000000-0000-0000-0000-000000000000',
      'Chase Bank',
      'DealSwift Automation LLC',
      '****7890',
      '021000021',
      'CHASUS33',
      '270 Park Avenue, New York, NY 10017'
    )
    ON CONFLICT (id) DO NOTHING
  `).then(() => console.log('✅ Default wire instructions seeded'))
    .catch(e => console.log('⚠️ wire seed:', e.message));

  // Add closed_deals column to buyers if not exists
  await pool.query(`
    ALTER TABLE buyers ADD COLUMN IF NOT EXISTS closed_deals INTEGER DEFAULT 0
  `).then(() => console.log('✅ buyers.closed_deals column ready'))
    .catch(e => console.log('⚠️ closed_deals:', e.message));

  // Verify
  console.log('\n--- VERIFICATION ---');

  const tables = ['payments', 'wire_instructions', 'system_alerts', 'buyers', 'buyer_assignments'];
  for (const t of tables) {
    const res = await pool.query(`SELECT COUNT(*) as count FROM ${t}`).catch(() => ({ rows: [{ count: -1 }] }));
    console.log(`${t}: ${res.rows[0].count >= 0 ? '✅' : '❌'} (${res.rows[0].count} rows)`);
  }

  await pool.end();
  console.log('\n✅ Schema ready');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
