#!/usr/bin/env node
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log('🔧 CREATING MINIMAL SCHEMA\n');

const client = await pool.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id),
      name TEXT,
      email TEXT,
      phone TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(organization_id, email)
    );

    CREATE TABLE IF NOT EXISTS lead_scores (
      lead_id INT PRIMARY KEY REFERENCES leads(id),
      composite_score FLOAT,
      distress_score FLOAT,
      recency_score FLOAT,
      equity_score FLOAT,
      geo_score FLOAT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS property_valuations (
      lead_id INT PRIMARY KEY REFERENCES leads(id),
      arv INT,
      repairs INT,
      offer_min INT,
      offer_max INT,
      comps_count INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS deal_probabilities (
      lead_id INT PRIMARY KEY REFERENCES leads(id),
      p_close FLOAT,
      expected_value INT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS campaign_lead_queue (
      id SERIAL PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id),
      lead_id INT REFERENCES leads(id) UNIQUE,
      expected_value INT,
      p_close FLOAT,
      offer_min INT,
      offer_max INT,
      status TEXT DEFAULT 'queued',
      scheduled_for TIMESTAMPTZ,
      touch_number INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS email_warmup_config (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
      daily_limit INT DEFAULT 20,
      paused BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  console.log('✅ ALL TABLES CREATED\n');
  process.exit(0);

} catch (error) {
  console.error('❌', error.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
