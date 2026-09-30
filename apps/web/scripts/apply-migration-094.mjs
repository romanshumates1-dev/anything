/**
 * Apply migration 094 (user preferences JSONB column) to the live DB.
 *
 * Why this script exists: the offline migration gate proves the chain applies
 * to a fresh database, but the live database is migrated separately — and it
 * was missing the `preferences` column that /api/user/preferences depends on.
 * This records the exact statements applied, idempotently, and verifies the
 * result from information_schema afterward.
 *
 * Usage: node scripts/apply-migration-094.mjs
 */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env manually (same pattern as apply-migration-009.mjs)
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

console.log('Applying migration 094 (user preferences JSONB column)...');

await sql`
  ALTER TABLE public."user"
    ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb
`;
console.log('  ✓ ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS preferences jsonb');

await sql`
  COMMENT ON COLUMN public."user".preferences IS
    'Whitelisted UI/onboarding preferences written via /api/user/preferences (onboarding_completed, tutorial_progress, theme, sidebar_collapsed, dashboard_layout, notification_preferences).'
`;
console.log('  ✓ COMMENT ON COLUMN preferences');

const [col] = await sql`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'preferences'
`;
if (!col) {
  console.error('VERIFY FAILED: preferences column still missing');
  process.exit(1);
}
console.log(
  `VERIFIED: user.preferences present (type=${col.data_type}, nullable=${col.is_nullable}, default=${col.column_default})`
);
