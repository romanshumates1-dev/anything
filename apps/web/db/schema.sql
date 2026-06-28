-- ============================================================================
-- CI TEST SCHEMA BOOTSTRAP (Layer C live flow runner)
--
-- Applied to the Neon test branch before the live flow tests run. Idempotent:
-- safe to run repeatedly. Mirrors the production schema for the tables the
-- flows touch. Auth tables are included because route handlers reference them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.leads (
  id serial PRIMARY KEY,
  type text NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'new',
  metadata jsonb DEFAULT '{}'::jsonb,
  source text,
  dedupe_hash text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leads_type_check CHECK (type IN ('seller','buyer'))
);
CREATE INDEX IF NOT EXISTS idx_leads_dedupe_hash ON public.leads (dedupe_hash);

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id serial PRIMARY KEY,
  lead_id integer UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'sms',
  history jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  confidence_score numeric(3,2) DEFAULT 0.0,
  requires_human boolean DEFAULT false,
  last_message_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id serial PRIMARY KEY,
  name text NOT NULL,
  message_template text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  daily_cap integer NOT NULL DEFAULT 100,
  throttle_per_minute integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT campaigns_status_check CHECK (status IN ('draft','scheduled','launched'))
);

CREATE TABLE IF NOT EXISTS public.campaign_leads (
  id serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id integer NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT campaign_leads_status_check CHECK (status IN ('pending','sent','failed')),
  CONSTRAINT campaign_leads_unique UNIQUE (campaign_id, lead_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign ON public.campaign_leads (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead ON public.campaign_leads (lead_id);

CREATE TABLE IF NOT EXISTS public.jobs (
  id serial PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  error_message text,
  dedupe_key text,
  run_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  locked_until timestamptz,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_jobs_dedupe_key ON public.jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON public.jobs (status, run_at);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id serial PRIMARY KEY,
  user_id text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.compliance_records (
  id serial PRIMARY KEY,
  target text NOT NULL,
  type text NOT NULL,
  channel text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_compliance_target_channel_type
  ON public.compliance_records (target, channel, type);

CREATE TABLE IF NOT EXISTS public.imports (
  id serial PRIMARY KEY,
  source text NOT NULL DEFAULT 'csv',
  filename text,
  total_rows integer NOT NULL DEFAULT 0,
  inserted_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT imports_source_check CHECK (source IN ('csv','paste')),
  CONSTRAINT imports_status_check CHECK (status IN ('processing','completed','failed'))
);

CREATE TABLE IF NOT EXISTS public.import_failures (
  id serial PRIMARY KEY,
  import_id integer NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  row_number integer,
  raw_data jsonb DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.flow_run (
  id serial PRIMARY KEY,
  flow_key text NOT NULL,
  step_id text,
  status text NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  detail text,
  run_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT flow_run_status_check CHECK (status IN ('pass','fail','error'))
);
CREATE INDEX IF NOT EXISTS idx_flow_run_run_id ON public.flow_run (run_id);
CREATE INDEX IF NOT EXISTS idx_flow_run_flow ON public.flow_run (flow_key);

CREATE TABLE IF NOT EXISTS public.execution_runs (
  id serial PRIMARY KEY,
  task text NOT NULL,
  flow text,
  step text,
  status text NOT NULL DEFAULT 'in_progress',
  passed boolean,
  detail text,
  db_assertion text,
  log_assertion text,
  run_id text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT execution_runs_status_check CHECK (status IN ('blocked','in_progress','pass','fail','complete'))
);
CREATE INDEX IF NOT EXISTS idx_execution_runs_flow ON public.execution_runs (flow);
CREATE INDEX IF NOT EXISTS idx_execution_runs_status ON public.execution_runs (status);
CREATE INDEX IF NOT EXISTS idx_execution_runs_run_id ON public.execution_runs (run_id);
