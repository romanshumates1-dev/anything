-- 006_lead_finder.sql
-- LEAD FINDER — standalone Kentucky lead-generation module.
--
-- COMPLIANCE IS THE ARCHITECTURE (enforced in the schema itself):
--   * sourced_leads holds PROPERTY + OWNER-NAME public records ONLY. It has NO
--     phone/email/personal-contact columns by design — phones are resolved
--     exclusively downstream by the owner's EXISTING skip-trace step after a
--     segment is pushed into the campaign pipeline. Do NOT add contact columns
--     to this table.
--   * Every record carries provenance (source name/url, fetch date, public
--     record type) so its origin is auditable + displayable.
--   * lead_sources is a CONFIG registry: sources are added/toggled as data, not
--     code. terms_status gates whether we may fetch (PERMITTED) vs. require an
--     owner upload (MANUAL_ONLY) vs. never touch (PROHIBITED).
--
-- Idempotent (CREATE TABLE / INDEX IF NOT EXISTS; seed is ON CONFLICT DO
-- NOTHING keyed on a natural unique name).

-- ── Source registry ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_sources (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  jurisdiction text NOT NULL,
  record_type text NOT NULL,
  category text NOT NULL DEFAULT 'seller',
  access_method text NOT NULL DEFAULT 'MANUAL_ONLY',
  url text,
  robots_status text NOT NULL DEFAULT 'NOT_CHECKED',
  terms_status text NOT NULL DEFAULT 'MANUAL_ONLY',
  refresh_cadence text,
  distress_weight integer NOT NULL DEFAULT 50,
  enabled boolean NOT NULL DEFAULT true,
  last_refreshed_at timestamptz,
  last_record_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_sources_category_check CHECK (category IN ('seller','buyer')),
  CONSTRAINT lead_sources_access_check CHECK (access_method IN ('API','CSV_DOWNLOAD','HTML_TABLE','MANUAL_ONLY')),
  CONSTRAINT lead_sources_terms_check CHECK (terms_status IN ('PERMITTED','MANUAL_ONLY','PROHIBITED'))
);

-- ── Normalized sourced leads (NO contact-data columns — see header) ─────────
CREATE TABLE IF NOT EXISTS public.sourced_leads (
  id serial PRIMARY KEY,
  source_id integer REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'seller',
  owner_name text,
  property_address text,
  mailing_address text,
  parcel_id text,
  record_type text,
  county text,
  assessed_value_cents bigint,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  distress_score integer NOT NULL DEFAULT 0,
  score_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  handed_off_lead_id integer,
  handed_off_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourced_leads_category_check CHECK (category IN ('seller','buyer')),
  CONSTRAINT sourced_leads_status_check CHECK (status IN ('new','handed_off'))
);

-- dedupe_key = source_id|county|parcel|address|owner (built upstream). Scoped to
-- the SOURCE so the same parcel in two sources isn't dropped; owner_name is
-- included so distinct owner-only rows don't collapse. Unique so re-uploading
-- the same source file is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sourced_leads_dedupe ON public.sourced_leads (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_sourced_leads_score ON public.sourced_leads (distress_score DESC);
CREATE INDEX IF NOT EXISTS idx_sourced_leads_county ON public.sourced_leads (county);
CREATE INDEX IF NOT EXISTS idx_sourced_leads_status ON public.sourced_leads (status);

-- ── MANUAL_ONLY upload audit ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_source_uploads (
  id serial PRIMARY KEY,
  source_id integer REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  filename text,
  total_rows integer NOT NULL DEFAULT 0,
  inserted_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Seed the KY high-distress SELLER + high-probability BUYER categories ─────
-- The CATEGORY is the goal; the specific portal is verified. terms_status is
-- MANUAL_ONLY by default (owner downloads + uploads) UNLESS a live robots/terms
-- check confirmed automated access is permitted. Only Louisville Metro Open
-- Data was verified live-permitted this build (robots allows /resource/, 60s
-- crawl-delay). The owner must still confirm each source's terms with a KY
-- attorney before use (see FINAL_STATE.md — NOT LEGAL ADVICE).
INSERT INTO public.lead_sources
  (name, jurisdiction, record_type, category, access_method, url, robots_status, terms_status, refresh_cadence, distress_weight, notes)
VALUES
  -- SELLER — high distress
  ('Jefferson County Probate / Estate Filings', 'Jefferson County, KY', 'probate', 'seller', 'MANUAL_ONLY',
   'https://legacy.courts.ky.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 90,
   'Inherited property. County clerk / district court probate docket. Owner downloads the filing list and uploads it here.'),
  ('KY County Tax-Delinquent Property Lists', 'Kentucky (per county)', 'tax_delinquent', 'seller', 'MANUAL_ONLY',
   'https://revenue.ky.gov/Property/Pages/Delinquent-Property-Tax.aspx', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'annual', 85,
   'KY Dept. of Revenue + county sheriff/clerk certificate-of-delinquency lists. Owner downloads the county PDF/CSV and uploads it.'),
  ('County Pre-Foreclosure / Lis Pendens Filings', 'Kentucky (per county)', 'pre_foreclosure', 'seller', 'MANUAL_ONLY',
   'https://legacy.courts.ky.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 88,
   'Lis pendens / foreclosure petitions in circuit court. Owner exports the docket and uploads it.'),
  ('Louisville Metro Code Enforcement — Vacant & Abandoned', 'Louisville Metro, KY', 'code_violation', 'seller', 'MANUAL_ONLY',
   'https://louisvilleky.gov/government/develop-louisville/vacant-and-public-property-administration', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 82,
   'Condemned / vacant / code-case registry. Where not exposed via Open Data, owner uploads the exported list.'),
  ('Louisville Metro Open Data (data.louisvilleky.gov)', 'Louisville Metro, KY', 'code_violation', 'seller', 'API',
   'https://data.louisvilleky.gov/', 'ALLOWED — robots.txt permits /resource/ (SODA API); disallows /admin,/people,/sessions; 60s crawl-delay (verified 2026-07-12)', 'PERMITTED', 'weekly', 80,
   'Socrata open-data portal: vacant/abandoned properties, code cases, property data via the public SODA /resource/ API. Live-verified robots-permitted. Owner should still confirm dataset terms with a KY attorney.'),
  ('KY PVA Records — Ownership & Absentee', 'Kentucky (per county PVA)', 'absentee', 'seller', 'MANUAL_ONLY',
   'https://revenue.ky.gov/Property/Pages/PVA-Directory.aspx', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'quarterly', 60,
   'Property Valuation Administrator ownership rolls. Absentee = mailing address ≠ situs address. Assessed value = equity/margin proxy. Owner uploads the PVA export.'),
  -- BUYER — high probability cash buyers
  ('County Cash-Sale Deeds (no mortgage lien)', 'Kentucky (per county clerk)', 'cash_deed', 'buyer', 'MANUAL_ONLY',
   'https://web.jeffersondeeds.com/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 70,
   'Recorded deeds with no accompanying mortgage/deed-of-trust = likely cash buyer. Owner exports recent deeds and uploads them.'),
  ('Repeat-Grantee LLCs (active investors)', 'Kentucky (per county clerk)', 'repeat_grantee', 'buyer', 'MANUAL_ONLY',
   'https://web.jeffersondeeds.com/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 75,
   'Grantee names (usually LLCs) appearing on multiple deeds = active investors. Owner uploads the deed export; the module cross-references frequency.'),
  ('Absentee Owners of Multiple Parcels (portfolio landlords)', 'Kentucky (per county PVA)', 'absentee_portfolio', 'buyer', 'MANUAL_ONLY',
   'https://revenue.ky.gov/Property/Pages/PVA-Directory.aspx', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'quarterly', 72,
   'PVA cross-reference: same owner on multiple parcels with an out-of-area mailing address = portfolio landlord / probable cash buyer.')
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE public.sourced_leads IS
  'Lead Finder normalized public-record leads. PROPERTY + OWNER-NAME only — NEVER stores phone/email (skip-trace resolves contact downstream). Every row carries provenance.';
COMMENT ON TABLE public.lead_sources IS
  'Lead Finder source registry (config, not code). terms_status: PERMITTED=may fetch; MANUAL_ONLY=owner uploads; PROHIBITED=never touch.';
