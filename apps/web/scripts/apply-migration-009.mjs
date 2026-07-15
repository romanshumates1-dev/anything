/**
 * Apply migration 009 (INT-1: SLA latency instrumentation) to the live DB.
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env manually
const envPath = join(__dirname, '../.env');
const envText = readFileSync(envPath, 'utf-8');
for (const line of envText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const { neon } = require('@neondatabase/serverless');
const sql = neon(DATABASE_URL);

async function run(stmt, label) {
  try {
    await sql(stmt);
    console.log('  ✓', label.substring(0, 70));
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('already exists') || msg.includes('Duplicate') || msg.includes('already a materialized view')) {
      console.log('  ⊘', label.substring(0, 70), '(already exists)');
    } else {
      console.error('  ✗', label, '\n     ', msg.substring(0, 200));
      throw err;
    }
  }
}

console.log('Applying migration 009 (INT-1: SLA latency)...');

// 1. Create table first (materialized view depends on it)
await run(`
CREATE TABLE IF NOT EXISTS public.inbound_latency (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  lead_id integer NOT NULL,
  reply_received_at timestamptz NOT NULL,
  ai_dispatched_at timestamptz,
  ack_sent_at timestamptz,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`, 'CREATE TABLE inbound_latency');

// 2. Indexes
await run(`CREATE INDEX IF NOT EXISTS idx_inbound_latency_conv ON public.inbound_latency (conversation_id);`, 'CREATE INDEX idx_inbound_latency_conv');
await run(`CREATE INDEX IF NOT EXISTS idx_inbound_latency_received ON public.inbound_latency (reply_received_at);`, 'CREATE INDEX idx_inbound_latency_received');

// 3. Materialized view (table must exist — it does now)
await run(`
CREATE MATERIALIZED VIEW IF NOT EXISTS public.inbound_latency_p95 AS
SELECT
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ai_dispatched_at - reply_received_at)) * 1000) AS p95_ms,
  COUNT(*) FILTER (WHERE ai_dispatched_at IS NOT NULL) AS completed_count,
  COUNT(*) FILTER (WHERE ai_dispatched_at IS NULL) AS pending_count,
  MAX(reply_received_at) AS latest_inbound,
  now() AS computed_at
FROM public.inbound_latency
WHERE reply_received_at >= now() - interval '24 hours';
`, 'CREATE MATERIALIZED VIEW inbound_latency_p95');

// 4. Unique index on materialized view (for CONCURRENTLY refresh)
await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_latency_p95_singleton ON public.inbound_latency_p95 ((1));`, 'CREATE UNIQUE INDEX idx_inbound_latency_p95_singleton');

console.log('Migration 009 applied successfully.');
