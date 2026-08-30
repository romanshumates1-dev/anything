-- 048: Wave 2 jurisdiction expansion (Phase 7)
-- TN, OH, IN, AL, SC, VA — all MANUAL_ONLY until agent verifies live.
-- KY/AL Jefferson disambiguation: jurisdiction field is the disambiguator.
-- All new jurisdiction x channel combos start attorney_reviewed=false (fail-closed).

INSERT INTO public.lead_sources
  (name, jurisdiction, record_type, category, access_method, url, robots_status, terms_status, refresh_cadence, distress_weight, notes)
VALUES
  ('TN Nashville-Davidson Probate Court','TN-Davidson','probate','seller','MANUAL_ONLY',
   'https://www.nashville.gov/departments/courts/probate','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — TN Nashville-Davidson Probate Court'),
  ('TN Nashville-Davidson Tax Delinquent','TN-Davidson','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.nashville.gov/departments/finance/tax','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — TN Nashville-Davidson Tax Delinquent'),
  ('TN Memphis-Shelby Probate Court','TN-Shelby','probate','seller','MANUAL_ONLY',
   'https://www.shelbycountytn.gov/probate','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — TN Memphis-Shelby Probate Court'),
  ('TN Memphis-Shelby Tax Delinquent','TN-Shelby','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.shelbycountytn.gov/trustee','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — TN Memphis-Shelby Tax Delinquent'),
  ('TN Knoxville-Knox Probate Court','TN-Knox','probate','seller','MANUAL_ONLY',
   'https://www.knoxcounty.org/probate','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — TN Knoxville-Knox Probate Court'),
  ('TN Knoxville-Knox Assessor','TN-Knox','assessor','seller','MANUAL_ONLY',
   'https://www.knoxcounty.org/assessor','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','quarterly',2,
   'Wave 2 — TN Knoxville-Knox Assessor'),
  ('OH Cincinnati-Hamilton Probate Court','OH-Hamilton','probate','seller','MANUAL_ONLY',
   'https://www.probatect.org','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — OH Cincinnati-Hamilton Probate Court'),
  ('OH Cincinnati-Hamilton Tax Delinquent','OH-Hamilton','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.hamiltoncountyohio.gov/government/departments/treasurer','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — OH Cincinnati-Hamilton Tax Delinquent'),
  ('OH Columbus-Franklin Probate Court','OH-Franklin','probate','seller','MANUAL_ONLY',
   'https://www.fcpcourt.org','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — OH Columbus-Franklin Probate Court'),
  ('OH Columbus-Franklin Tax Delinquent','OH-Franklin','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.franklincountytreasurer.com','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — OH Columbus-Franklin Tax Delinquent'),
  ('IN Indianapolis-Marion Probate Court','IN-Marion','probate','seller','MANUAL_ONLY',
   'https://www.indy.gov/activity/probate-court','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — IN Indianapolis-Marion Probate Court'),
  ('IN Indianapolis-Marion Tax Delinquent','IN-Marion','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.indy.gov/activity/treasurer','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — IN Indianapolis-Marion Tax Delinquent'),
  -- AL Jefferson = Birmingham. jurisdiction=AL-Jefferson disambiguates from KY Jefferson (Louisville).
  ('AL Birmingham-Jefferson Probate Court','AL-Jefferson','probate','seller','MANUAL_ONLY',
   'https://www.jeffcointouch.com/probate','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — AL Birmingham-Jefferson Probate Court (state=AL, NOT KY)'),
  ('AL Birmingham-Jefferson Tax Delinquent','AL-Jefferson','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.jeffcointouch.com/revenue','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — AL Birmingham-Jefferson Tax Delinquent (state=AL)'),
  ('SC Charleston Probate Court','SC-Charleston','probate','seller','MANUAL_ONLY',
   'https://www.charlestoncounty.org/departments/probate-court','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — SC Charleston Probate Court'),
  ('SC Charleston Tax Delinquent','SC-Charleston','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.charlestoncounty.org/departments/treasurer','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — SC Charleston Tax Delinquent'),
  ('SC Columbia-Richland Probate Court','SC-Richland','probate','seller','MANUAL_ONLY',
   'https://www.richlandcountysc.gov/Departments/Probate-Court','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — SC Columbia-Richland Probate Court'),
  ('SC Columbia-Richland Tax Delinquent','SC-Richland','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.richlandcountysc.gov/Departments/Treasurer','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — SC Columbia-Richland Tax Delinquent'),
  ('VA Richmond Probate Court','VA-RichmondCity','probate','seller','MANUAL_ONLY',
   'https://www.richmondgov.com/CircuitCourt','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','weekly',5,
   'Wave 2 — VA Richmond Probate Court'),
  ('VA Richmond Tax Delinquent','VA-RichmondCity','tax_delinquent','seller','MANUAL_ONLY',
   'https://www.richmondgov.com/Finance/TaxDelinquent','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','annual',4,
   'Wave 2 — VA Richmond Tax Delinquent'),
  ('VA Richmond Assessor','VA-RichmondCity','assessor','seller','MANUAL_ONLY',
   'https://www.richmondgov.com/Assessor','NOT_APPLICABLE (manual upload — not scraped)','MANUAL_ONLY','quarterly',2,
   'Wave 2 — VA Richmond Assessor')
ON CONFLICT (name) DO NOTHING;

-- Lock compliance gates for all Wave 2 jurisdictions (fail-closed per Phase 0A).
-- Uses a DO block so it works even when organizations table is empty.
DO $$
DECLARE
  org_id TEXT;
  jur TEXT;
  ch TEXT;
BEGIN
  FOR org_id IN SELECT id FROM public.organizations LOOP
    FOREACH jur IN ARRAY ARRAY[
      'TN','TN-Davidson','TN-Shelby','TN-Knox',
      'OH','OH-Hamilton','OH-Franklin',
      'IN','IN-Marion',
      'AL','AL-Jefferson',
      'SC','SC-Charleston','SC-Richland',
      'VA','VA-RichmondCity'
    ] LOOP
      FOREACH ch IN ARRAY ARRAY['sms','email','mail','voice','rvm'] LOOP
        INSERT INTO public.compliance_gates
          (organization_id, jurisdiction, channel, attorney_reviewed, notes)
        VALUES
          (org_id, jur, ch, false, 'Wave 2 — locked until owner+attorney review')
        ON CONFLICT (organization_id, jurisdiction, channel) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;