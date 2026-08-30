#!/usr/bin/env node
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const client = await pool.connect();

try {
  console.log('Adding missing columns...\n');

  // Add reply_sentiment if missing
  await client.query(`
    ALTER TABLE campaign_lead_queue
    ADD COLUMN IF NOT EXISTS reply_sentiment TEXT
    CHECK (reply_sentiment IN ('positive', 'neutral', 'negative', 'objection', 'question'))
  `);

  console.log('✅ reply_sentiment column added');

  // Add last_reply_at if missing
  await client.query(`
    ALTER TABLE campaign_lead_queue
    ADD COLUMN IF NOT EXISTS last_reply_at TIMESTAMPTZ
  `);

  console.log('✅ last_reply_at column added\n');
  console.log('Schema fixed. Re-run simulation.');

} catch (error) {
  console.error('Error:', error.message);
} finally {
  client.release();
  await pool.end();
}
