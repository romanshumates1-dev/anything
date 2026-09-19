-- 081_regional_targeting.sql
-- Regional Targeting System for Campaigns
-- Enables granular geographic targeting with ZIP, County, State, City support
-- Plus saved territories for reuse across campaigns
-- Idempotent. Rollback: DROP TABLE saved_territories, campaign_regions, zip_reference CASCADE;

-- Region type enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'region_type') THEN
    CREATE TYPE region_type AS ENUM ('ZIP', 'COUNTY', 'STATE', 'CITY', 'MSA');
  END IF;
END $$;

-- Campaign regions - links campaigns to specific geographic targets
CREATE TABLE IF NOT EXISTS public.campaign_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,
  campaign_id TEXT REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,

  -- Region definition
  name TEXT,  -- Display name (optional, auto-populated)
  type TEXT NOT NULL,  -- ZIP, COUNTY, STATE, CITY, MSA
  value TEXT NOT NULL,  -- The actual value (e.g., "90210", "Los Angeles", "CA")

  -- Targeting mode
  include BOOLEAN NOT NULL DEFAULT true,  -- true = include, false = exclude

  -- Parent hierarchy (for filtering)
  parent_state TEXT,  -- State abbreviation for counties/cities/zips
  parent_county TEXT, -- County name for cities/zips

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,  -- Additional data (population, lead count estimates, etc.)

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_regions_org ON public.campaign_regions(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_regions_campaign ON public.campaign_regions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_regions_type_value ON public.campaign_regions(type, value);
CREATE INDEX IF NOT EXISTS idx_campaign_regions_include ON public.campaign_regions(campaign_id, include);

-- Unique constraint: no duplicate region for same campaign
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_region ON public.campaign_regions(campaign_id, type, value)
  WHERE campaign_id IS NOT NULL;

COMMENT ON TABLE public.campaign_regions IS 'Geographic targeting regions for campaigns with include/exclude support';

-- Saved territories - reusable region sets
CREATE TABLE IF NOT EXISTS public.saved_territories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,

  -- Territory definition
  name TEXT NOT NULL,
  description TEXT,

  -- Regions as JSONB array: [{type: 'ZIP', value: '90210', include: true}, ...]
  regions JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Targeting summary (cached for display)
  region_count INTEGER NOT NULL DEFAULT 0,
  estimated_leads INTEGER,  -- Cached lead count estimate

  -- Usage tracking
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Metadata
  color TEXT,  -- UI display color
  is_default BOOLEAN NOT NULL DEFAULT false,  -- Org-wide default territory

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_territories_org ON public.saved_territories(organization_id);
CREATE INDEX IF NOT EXISTS idx_saved_territories_default ON public.saved_territories(organization_id, is_default)
  WHERE is_default = true;

-- Unique constraint: no duplicate territory names per org
CREATE UNIQUE INDEX IF NOT EXISTS uniq_territory_name_org ON public.saved_territories(organization_id, name);

COMMENT ON TABLE public.saved_territories IS 'Reusable geographic region sets for campaign targeting';

-- ZIP code reference table (simplified for lookups)
CREATE TABLE IF NOT EXISTS public.zip_reference (
  zip TEXT PRIMARY KEY,
  city TEXT,
  county TEXT,
  state TEXT NOT NULL,

  -- Geographic data
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  timezone TEXT,

  -- Demographics (for lead estimation)
  population INTEGER,
  households INTEGER,
  median_income INTEGER,  -- dollars

  -- Real estate indicators
  median_home_value INTEGER,  -- dollars
  owner_occupied_pct NUMERIC(5,2),  -- percentage

  -- Metadata
  msa_code TEXT,  -- Metropolitan Statistical Area
  msa_name TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zip_reference_state ON public.zip_reference(state);
CREATE INDEX IF NOT EXISTS idx_zip_reference_county ON public.zip_reference(state, county);
CREATE INDEX IF NOT EXISTS idx_zip_reference_city ON public.zip_reference(state, city);
CREATE INDEX IF NOT EXISTS idx_zip_reference_msa ON public.zip_reference(msa_code);

COMMENT ON TABLE public.zip_reference IS 'ZIP code reference data for regional targeting lookups';

-- County reference table (for county dropdown)
CREATE TABLE IF NOT EXISTS public.county_reference (
  id TEXT PRIMARY KEY,  -- state_county format: "CA_Los Angeles"
  state TEXT NOT NULL,
  county TEXT NOT NULL,
  fips_code TEXT,

  -- Geographic data
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),

  -- Demographics
  population INTEGER,
  households INTEGER,

  -- Aggregated ZIP data
  zip_count INTEGER,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_county_reference_state ON public.county_reference(state);

COMMENT ON TABLE public.county_reference IS 'County reference data for regional targeting dropdowns';

-- State reference table (for state dropdown with counts)
CREATE TABLE IF NOT EXISTS public.state_reference (
  code TEXT PRIMARY KEY,  -- 2-letter state code
  name TEXT NOT NULL,

  -- Aggregates
  county_count INTEGER,
  zip_count INTEGER,
  population INTEGER,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.state_reference IS 'State reference data for regional targeting';

-- Seed US states
INSERT INTO public.state_reference (code, name, county_count, zip_count, population) VALUES
  ('AL', 'Alabama', 67, 810, 5024279),
  ('AK', 'Alaska', 30, 268, 733391),
  ('AZ', 'Arizona', 15, 524, 7151502),
  ('AR', 'Arkansas', 75, 698, 3011524),
  ('CA', 'California', 58, 2653, 39538223),
  ('CO', 'Colorado', 64, 654, 5773714),
  ('CT', 'Connecticut', 8, 421, 3605944),
  ('DE', 'Delaware', 3, 92, 989948),
  ('FL', 'Florida', 67, 1479, 21538187),
  ('GA', 'Georgia', 159, 944, 10711908),
  ('HI', 'Hawaii', 5, 121, 1455271),
  ('ID', 'Idaho', 44, 320, 1839106),
  ('IL', 'Illinois', 102, 1590, 12812508),
  ('IN', 'Indiana', 92, 991, 6785528),
  ('IA', 'Iowa', 99, 1069, 3190369),
  ('KS', 'Kansas', 105, 795, 2937880),
  ('KY', 'Kentucky', 120, 946, 4505836),
  ('LA', 'Louisiana', 64, 647, 4657757),
  ('ME', 'Maine', 16, 482, 1362359),
  ('MD', 'Maryland', 24, 591, 6177224),
  ('MA', 'Massachusetts', 14, 671, 7029917),
  ('MI', 'Michigan', 83, 1097, 10077331),
  ('MN', 'Minnesota', 87, 963, 5706494),
  ('MS', 'Mississippi', 82, 499, 2961279),
  ('MO', 'Missouri', 115, 1120, 6154913),
  ('MT', 'Montana', 56, 401, 1084225),
  ('NE', 'Nebraska', 93, 621, 1961504),
  ('NV', 'Nevada', 17, 247, 3104614),
  ('NH', 'New Hampshire', 10, 295, 1377529),
  ('NJ', 'New Jersey', 21, 695, 9288994),
  ('NM', 'New Mexico', 33, 418, 2117522),
  ('NY', 'New York', 62, 2177, 20201249),
  ('NC', 'North Carolina', 100, 1037, 10439388),
  ('ND', 'North Dakota', 53, 416, 779094),
  ('OH', 'Ohio', 88, 1375, 11799448),
  ('OK', 'Oklahoma', 77, 767, 3959353),
  ('OR', 'Oregon', 36, 483, 4237256),
  ('PA', 'Pennsylvania', 67, 2194, 13002700),
  ('RI', 'Rhode Island', 5, 90, 1097379),
  ('SC', 'South Carolina', 46, 498, 5118425),
  ('SD', 'South Dakota', 66, 411, 886667),
  ('TN', 'Tennessee', 95, 755, 6910840),
  ('TX', 'Texas', 254, 2676, 29145505),
  ('UT', 'Utah', 29, 349, 3271616),
  ('VT', 'Vermont', 14, 308, 643077),
  ('VA', 'Virginia', 133, 1209, 8631393),
  ('WA', 'Washington', 39, 731, 7614893),
  ('WV', 'West Virginia', 55, 688, 1793716),
  ('WI', 'Wisconsin', 72, 879, 5893718),
  ('WY', 'Wyoming', 23, 193, 576851),
  ('DC', 'District of Columbia', 1, 56, 689545)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  county_count = EXCLUDED.county_count,
  zip_count = EXCLUDED.zip_count,
  population = EXCLUDED.population,
  updated_at = NOW();

-- Add region column to campaign_contacts if not exists (for lead filtering)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'campaign_contacts' AND column_name = 'zip') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN zip TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'campaign_contacts' AND column_name = 'county') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN county TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'campaign_contacts' AND column_name = 'state') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN state TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'campaign_contacts' AND column_name = 'city') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN city TEXT;
  END IF;
END $$;

-- Add indexes for regional filtering on contacts
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_state ON public.campaign_contacts(state);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_county ON public.campaign_contacts(state, county);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_zip ON public.campaign_contacts(zip);

-- Add region column to leads if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'leads' AND column_name = 'zip') THEN
    ALTER TABLE public.leads ADD COLUMN zip TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'leads' AND column_name = 'county') THEN
    ALTER TABLE public.leads ADD COLUMN county TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'leads' AND column_name = 'state') THEN
    ALTER TABLE public.leads ADD COLUMN state TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'leads' AND column_name = 'city') THEN
    ALTER TABLE public.leads ADD COLUMN city TEXT;
  END IF;
END $$;

-- Add indexes for regional filtering on leads
CREATE INDEX IF NOT EXISTS idx_leads_state ON public.leads(state);
CREATE INDEX IF NOT EXISTS idx_leads_county ON public.leads(state, county);
CREATE INDEX IF NOT EXISTS idx_leads_zip ON public.leads(zip);

-- Function to estimate lead count for a region set
CREATE OR REPLACE FUNCTION estimate_leads_for_regions(
  p_organization_id TEXT,
  p_regions JSONB
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_region JSONB;
  v_include_zips TEXT[] := '{}';
  v_exclude_zips TEXT[] := '{}';
  v_include_states TEXT[] := '{}';
  v_exclude_states TEXT[] := '{}';
  v_include_counties TEXT[] := '{}';
  v_exclude_counties TEXT[] := '{}';
BEGIN
  -- Parse regions into include/exclude arrays
  FOR v_region IN SELECT * FROM jsonb_array_elements(p_regions)
  LOOP
    CASE v_region->>'type'
      WHEN 'ZIP' THEN
        IF (v_region->>'include')::boolean THEN
          v_include_zips := array_append(v_include_zips, v_region->>'value');
        ELSE
          v_exclude_zips := array_append(v_exclude_zips, v_region->>'value');
        END IF;
      WHEN 'STATE' THEN
        IF (v_region->>'include')::boolean THEN
          v_include_states := array_append(v_include_states, v_region->>'value');
        ELSE
          v_exclude_states := array_append(v_exclude_states, v_region->>'value');
        END IF;
      WHEN 'COUNTY' THEN
        IF (v_region->>'include')::boolean THEN
          v_include_counties := array_append(v_include_counties, v_region->>'value');
        ELSE
          v_exclude_counties := array_append(v_exclude_counties, v_region->>'value');
        END IF;
    END CASE;
  END LOOP;

  -- Count matching leads
  -- This is a simplified estimation; in production you'd want more sophisticated matching
  SELECT COUNT(*) INTO v_count
  FROM leads l
  WHERE (
    -- Include logic (if any includes specified)
    (array_length(v_include_zips, 1) IS NULL AND
     array_length(v_include_states, 1) IS NULL AND
     array_length(v_include_counties, 1) IS NULL)
    OR
    (l.zip = ANY(v_include_zips))
    OR
    (l.state = ANY(v_include_states))
    OR
    (l.county = ANY(v_include_counties))
  )
  AND (
    -- Exclude logic
    (l.zip IS NULL OR NOT (l.zip = ANY(v_exclude_zips)))
    AND
    (l.state IS NULL OR NOT (l.state = ANY(v_exclude_states)))
    AND
    (l.county IS NULL OR NOT (l.county = ANY(v_exclude_counties)))
  );

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION estimate_leads_for_regions IS 'Estimate lead count matching a set of regions with include/exclude support';
