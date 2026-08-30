-- ============================================================================
-- 043 — DNC registry (federal/state/internal) + per-org consent & DNC policy.
--
-- WHY THIS EXISTS
--
-- Before this migration the ONLY suppression the dispatch path knew about was
-- `compliance_records` rows with type='opt-out' — i.e. people who had already
-- texted STOP to *us*. dispatchGate's isSuppressed() checked nothing else. That
-- covers 47 U.S.C. 227's internal-DNC duty but NOT the two bigger exposures for
-- cold real-estate prospecting:
--
--   * The National Do Not Call Registry (FTC, 16 CFR 310.4(b)(1)(iii)(B)).
--     Marketing calls/texts to a registered number carry a private right of
--     action at $500-$1,500 per violation. Access is FREE for up to 5 area
--     codes (FY2026: $82/area code beyond that, $22,626 cap) — so for an
--     operator working a handful of counties there is no cost argument for
--     skipping it.
--   * State DNC lists, several of which are stricter than federal and are
--     where wholesaler suits actually get filed (FL FTSA, OK, WA CEMA, MD).
--
-- SAFE HARBOR IS A FRESHNESS RULE, NOT A PRESENCE RULE.
-- 16 CFR 310.4(b)(3)(iv) grants safe harbor only if the seller "accesses the
-- national registry no more than 31 days before calling any consumer" AND
-- "maintains records documenting this process." A registry snapshot imported
-- once and never refreshed therefore provides NO protection, however many rows
-- it has. That is why `dnc_area_coverage` tracks last_fetched_at PER AREA CODE
-- and `dnc_scrub_runs` keeps the audit trail — the gate needs to answer "is my
-- data for THIS number's area code fresh enough to be defensible?", which a
-- row count cannot answer.
--
-- DESIGN NOTES
--
-- * Keyed (phone, list_source) rather than phone alone: the same number can be
--   on the federal list AND a state list, and the deny reason we log/report
--   must name which. Dropping one source must not delete the other's row.
-- * area_code is stored denormalised so the freshness join is a cheap equality
--   lookup on the hot send path instead of a substring() per row.
-- * No organization_id: the federal and state registries are facts about the
--   world, not tenant data, and one import serves every org. Internal
--   suppressions stay in `compliance_records`, which IS org-scoped.
--
-- POLICY COLUMNS default to the NON-BREAKING setting deliberately:
--   dnc_enforcement='advisory' denies a phone that IS listed but allows one
--   whose area code has no/stale coverage (logging loudly). 'strict' also
--   denies on missing/stale coverage — fail-closed, and REQUIRED before the
--   first live send. Defaulting to 'strict' today would deny every cold send
--   until a registry import runs, silently converting "no DNC data" into "no
--   outreach" for existing tests and flows; making that switch explicit and
--   owner-gated is safer than a default that looks like a no-op but isn't.
--
-- Idempotent (CREATE TABLE/INDEX IF NOT EXISTS; constraints added via guarded
-- DO blocks since ADD CONSTRAINT has no IF NOT EXISTS).
-- ============================================================================

-- ── Registry rows ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dnc_registry (
  phone text NOT NULL,
  list_source text NOT NULL,          -- 'federal' | 'state' | 'internal'
  jurisdiction text,                  -- state code for 'state'; NULL for federal
  area_code text NOT NULL,            -- denormalised NPA for the freshness join
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, list_source)
);

CREATE INDEX IF NOT EXISTS idx_dnc_registry_area
  ON public.dnc_registry (area_code, list_source);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dnc_registry_list_source_check'
  ) THEN
    ALTER TABLE public.dnc_registry
      ADD CONSTRAINT dnc_registry_list_source_check
      CHECK (list_source IN ('federal', 'state', 'internal'));
  END IF;
END $$;

-- ── Per-area-code freshness (the Safe Harbor 31-day clock) ──────────────────
CREATE TABLE IF NOT EXISTS public.dnc_area_coverage (
  area_code text NOT NULL,
  list_source text NOT NULL,
  jurisdiction text,
  row_count integer NOT NULL DEFAULT 0,
  last_fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_code, list_source)
);

-- ── Immutable audit trail: "maintains records documenting this process" ─────
CREATE TABLE IF NOT EXISTS public.dnc_scrub_runs (
  id serial PRIMARY KEY,
  area_code text,
  list_source text NOT NULL,
  jurisdiction text,
  row_count integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_dnc_scrub_runs_fetched
  ON public.dnc_scrub_runs (fetched_at DESC);

-- ── Per-org policy ──────────────────────────────────────────────────────────
-- sms_consent_policy:
--   'required'  — an SMS cold first-touch needs a recorded consent basis
--                 (contact_lists.consent_mode in ('inbound','consented') or a
--                 compliance_records type='consent' row). Consent-first motion.
--   'attested'  — the operator attests to a lawful basis for the list itself;
--                 the gate does not require a per-number consent record. This
--                 is the cold-outreach posture and carries the TCPA/carrier
--                 exposure documented in AWS_CREDITS_PLAN.md. Owner decision.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sms_consent_policy text NOT NULL DEFAULT 'required';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dnc_enforcement text NOT NULL DEFAULT 'advisory';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_sms_consent_policy_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_sms_consent_policy_check
      CHECK (sms_consent_policy IN ('required', 'attested'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_dnc_enforcement_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_dnc_enforcement_check
      CHECK (dnc_enforcement IN ('off', 'advisory', 'strict'));
  END IF;
END $$;

COMMENT ON TABLE public.dnc_registry IS
  'Federal/state/internal Do-Not-Call numbers. Not org-scoped: registries are facts about the world, one import serves all tenants. Internal STOP suppressions live in compliance_records (org-scoped).';

COMMENT ON TABLE public.dnc_area_coverage IS
  'Per (area_code, list_source) last_fetched_at. Drives the 16 CFR 310.4(b)(3)(iv) 31-day Safe Harbor freshness check in dispatchGate. A stale snapshot provides no safe harbor regardless of row count.';

COMMENT ON COLUMN public.organizations.dnc_enforcement IS
  'off | advisory | strict. advisory (default) denies listed numbers but allows missing/stale area-code coverage. strict also denies on missing/stale coverage — fail-closed, REQUIRED before the first live send.';
