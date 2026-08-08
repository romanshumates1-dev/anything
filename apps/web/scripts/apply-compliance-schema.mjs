#!/usr/bin/env node
/**
 * Apply schema for compliance and integration features
 */
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('Applying compliance & integration schema...\n');

  // DNC List
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dnc_list (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone TEXT NOT NULL UNIQUE,
      source TEXT DEFAULT 'manual',
      added_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => console.log('✅ dnc_list table'))
    .catch(e => console.log('⚠️ dnc_list:', e.message));

  // Suppression List (opt-outs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppression_list (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id TEXT,
      phone TEXT,
      email TEXT,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(phone),
      UNIQUE(email)
    )
  `).then(() => console.log('✅ suppression_list table'))
    .catch(e => console.log('⚠️ suppression_list:', e.message));

  // Contact Log (for frequency limits)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID,
      phone TEXT,
      email TEXT,
      channel TEXT NOT NULL,
      lead_id TEXT,
      success BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => console.log('✅ contact_log table'))
    .catch(e => console.log('⚠️ contact_log:', e.message));

  // Rate Limit Log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      lead_id TEXT,
      message_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => console.log('✅ rate_limit_log table'))
    .catch(e => console.log('⚠️ rate_limit_log:', e.message));

  // Negotiation Queue (for inbound processing)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS negotiation_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id TEXT NOT NULL,
      inbound_message TEXT,
      sentiment TEXT,
      processed BOOLEAN DEFAULT false,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => console.log('✅ negotiation_queue table'))
    .catch(e => console.log('⚠️ negotiation_queue:', e.message));

  // Property Comps (for internal comp storage)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS property_comps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      address TEXT NOT NULL,
      zip TEXT NOT NULL,
      sold_price INTEGER NOT NULL,
      sold_date DATE NOT NULL,
      sqft INTEGER,
      beds INTEGER,
      baths NUMERIC(3,1),
      source TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).then(() => console.log('✅ property_comps table'))
    .catch(e => console.log('⚠️ property_comps:', e.message));

  // E-Sign Envelopes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS esign_envelopes (
      id TEXT PRIMARY KEY,
      organization_id UUID,
      deal_id TEXT NOT NULL,
      contract_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      signers JSONB,
      envelope_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ
    )
  `).then(() => console.log('✅ esign_envelopes table'))
    .catch(e => console.log('⚠️ esign_envelopes:', e.message));

  // Add consent columns to leads
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_sms BOOLEAN DEFAULT true
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_call BOOLEAN DEFAULT true
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS consent_email BOOLEAN DEFAULT true
  `).catch(() => {});
  console.log('✅ leads consent columns');

  // Create indexes
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contact_log_phone ON contact_log(phone)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contact_log_created ON contact_log(created_at)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_org_channel ON rate_limit_log(organization_id, channel, provider)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rate_limit_created ON rate_limit_log(created_at)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_suppression_phone ON suppression_list(phone)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comps_zip ON property_comps(zip)`).catch(() => {});
  console.log('✅ indexes created');

  // Verify tables
  console.log('\n--- VERIFICATION ---');
  const tables = [
    'dnc_list', 'suppression_list', 'contact_log', 'rate_limit_log',
    'negotiation_queue', 'property_comps', 'esign_envelopes'
  ];

  for (const t of tables) {
    const res = await pool.query(`SELECT COUNT(*) as count FROM ${t}`).catch(() => ({ rows: [{ count: -1 }] }));
    console.log(`${t}: ${res.rows[0].count >= 0 ? '✅' : '❌'} (${res.rows[0].count} rows)`);
  }

  await pool.end();
  console.log('\n✅ Compliance schema ready');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
