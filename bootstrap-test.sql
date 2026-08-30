-- ============================================================================
-- TEST SCRIPT: Reproduce the fresh DB bootstrap in order
-- This is the exact sequence from CI:
-- 1. schema.sql
-- 2. campaign-pipeline-schema.sql
-- 3. migrations/001_add_missing_tables.sql
-- 4. migrations/002_pause_ai.sql
-- 5. migrations/003_auth_tables.sql
-- 6-30: SaaS platform migrations (organizations, subscriptions, etc.)
-- ============================================================================

-- Check what tables and types exist at each step
\echo '=== STARTING FRESH DB BOOTSTRAP TEST ==='

-- Step 1: Load schema.sql
\echo '--- STEP 1: Loading schema.sql ---'
\i apps/web/db/schema.sql

\echo '--- After schema.sql: Tables created ---'
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;

-- Step 2: Load campaign-pipeline-schema.sql
\echo '--- STEP 2: Loading campaign-pipeline-schema.sql ---'
\i apps/web/db/campaign-pipeline-schema.sql

\echo '--- After campaign-pipeline-schema.sql: Types and tables ---'
SELECT typname FROM pg_type WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') ORDER BY typname;
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;

-- Step 3: Load migration 001
\echo '--- STEP 3: Loading migrations/001_add_missing_tables.sql ---'
\i apps/web/db/migrations/001_add_missing_tables.sql

\echo '--- After migration 001: Check for new tables ---'
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;

-- Step 4: Load migration 002
\echo '--- STEP 4: Loading migrations/002_pause_ai.sql ---'
\i apps/web/db/migrations/002_pause_ai.sql

-- Step 5: Load migration 003
\echo '--- STEP 5: Loading migrations/003_auth_tables.sql ---'
\i apps/web/db/migrations/003_auth_tables.sql

-- SaaS Platform Migrations
\echo '--- STEP 6: Loading SaaS migrations ---'
\i apps/web/db/migrations/022_organizations.sql
\i apps/web/db/migrations/023_organization_members.sql
\i apps/web/db/migrations/024_invitations.sql
\i apps/web/db/migrations/025_subscription_plans.sql
\i apps/web/db/migrations/026_organization_subscriptions.sql
\i apps/web/db/migrations/027_usage_ledger.sql
\i apps/web/db/migrations/028_twilio_accounts.sql
\i apps/web/db/migrations/029_ai_providers.sql
\i apps/web/db/migrations/030_add_tenant_to_existing_tables.sql

-- Seed subscription plans
\echo '--- Seeding subscription plans ---'
\i apps/web/db/seeds/subscription_plans.sql

\echo '=== BOOTSTRAP TEST COMPLETE ==='