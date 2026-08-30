/**
 * Apply migrations 033 and 034 to the live DB.
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
    if (msg.includes('already exists') || msg.includes('Duplicate')) {
      console.log('  ⊘', label.substring(0, 70), '(already exists)');
    } else {
      console.error('  ✗', label, '\n     ', msg.substring(0, 200));
      throw err;
    }
  }
}

console.log('Applying migrations 033 and 034...');

// Migration 033 - Reviews System
console.log('\n--- Migration 033: Reviews System ---');

await run(`
  CREATE TABLE IF NOT EXISTS public.reviews (
    id text PRIMARY KEY DEFAULT 'rev_' || gen_random_uuid()::text,
    user_id text REFERENCES public."user"(id) ON DELETE SET NULL,
    rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    verified_customer boolean NOT NULL DEFAULT false,
    is_demo boolean NOT NULL DEFAULT false,
    admin_note text,
    UNIQUE (user_id, status)
  );
`, 'CREATE TABLE reviews');

await run(`CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews (status);`, 'CREATE INDEX idx_reviews_status');
await run(`CREATE INDEX IF NOT EXISTS idx_reviews_user ON public.reviews (user_id);`, 'CREATE INDEX idx_reviews_user');
await run(`CREATE INDEX IF NOT EXISTS idx_reviews_created ON public.reviews (created_at DESC);`, 'CREATE INDEX idx_reviews_created');
await run(`CREATE INDEX IF NOT EXISTS idx_reviews_demo ON public.reviews (is_demo) WHERE is_demo = true;`, 'CREATE INDEX idx_reviews_demo');

await run(`
  CREATE TABLE IF NOT EXISTS public.review_audit_log (
    id text PRIMARY KEY DEFAULT 'rev_audit_' || gen_random_uuid()::text,
    actor_id text REFERENCES public."user"(id),
    action text NOT NULL,
    review_id text REFERENCES public.reviews(id) ON DELETE CASCADE,
    reason text,
    metadata jsonb,
    ip text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`, 'CREATE TABLE review_audit_log');

await run(`CREATE INDEX IF NOT EXISTS idx_review_audit_log_review ON public.review_audit_log (review_id);`, 'CREATE INDEX idx_review_audit_log_review');

// Migration 034 - Contact Messages + Admin Audit Log
console.log('\n--- Migration 034: Contact Messages + Admin Audit Log ---');

await run(`
  CREATE TABLE IF NOT EXISTS public.contact_messages (
    id text PRIMARY KEY DEFAULT 'contact_' || gen_random_uuid()::text,
    name text NOT NULL,
    email text NOT NULL,
    company text,
    subject text NOT NULL,
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    ip_address text,
    user_agent text
  );
`, 'CREATE TABLE contact_messages');

await run(`CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON public.contact_messages (email);`, 'CREATE INDEX idx_contact_messages_email');
await run(`CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON public.contact_messages (created_at DESC);`, 'CREATE INDEX idx_contact_messages_created');

await run(`
  CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id text PRIMARY KEY DEFAULT 'audit_' || gen_random_uuid()::text,
    actor_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    metadata jsonb,
    ip text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`, 'CREATE TABLE admin_audit_log');

await run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON public.admin_audit_log (actor_id);`, 'CREATE INDEX idx_admin_audit_log_actor');
await run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC);`, 'CREATE INDEX idx_admin_audit_log_created');
await run(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON public.admin_audit_log (action);`, 'CREATE INDEX idx_admin_audit_log_action');

console.log('\n✅ Migrations 033 and 034 applied successfully.');