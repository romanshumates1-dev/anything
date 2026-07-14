-- 008_lead_finder_states.sql
-- Phase 1 expansion — add North Carolina, Georgia, Missouri (statewide), and
-- St. Louis (metro) to the EXISTING lead_sources registry. Same compliance
-- architecture as the KY seed (006): property + owner-name records only, no
-- contact scraping, provenance per record, MANUAL_ONLY unless a LIVE robots
-- check confirmed automation is permitted. This is a data expansion — no new
-- scraping behavior. Idempotent: ON CONFLICT (name) DO NOTHING.
--
-- Live robots/terms checks (2026-07-14):
--   * Missouri  data.mo.gov (Socrata) — robots allows /resource/, crawl-delay 1s   -> PERMITTED (API)
--   * NC        nconemap.gov (ArcGIS Hub) — /datasets,/api allowed, crawl-delay 60s -> PERMITTED (API)
--   * Georgia   opendata.atlantaregional.com (ArcGIS Hub) — allowed, crawl-delay 60s -> PERMITTED (API)
--   * St. Louis www.stlouis-mo.gov — robots DISALLOWS /data/*json + ?parcelId       -> MANUAL_ONLY
--   * All county probate/tax/deed/code/assessor records default MANUAL_ONLY.
-- NOT LEGAL ADVICE — owner must confirm each source's terms with an attorney per state.

INSERT INTO public.lead_sources
  (name, jurisdiction, record_type, category, access_method, url, robots_status, terms_status, refresh_cadence, distress_weight, notes)
VALUES
  -- ═══ NORTH CAROLINA ═══ (sellers)
  ('NC Probate / Estate Filings (Clerk of Superior Court)', 'North Carolina (per county)', 'probate', 'seller', 'MANUAL_ONLY',
   'https://www.nccourts.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 90,
   'Inherited property. Estate files at the county Clerk of Superior Court. Owner downloads the estate index and uploads it.'),
  ('NC County Tax-Delinquent Property Lists', 'North Carolina (per county)', 'tax_delinquent', 'seller', 'MANUAL_ONLY',
   'https://www.ncdor.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'annual', 85,
   'County tax collector delinquent / tax-foreclosure lists. Owner downloads the county list and uploads it.'),
  ('NC Pre-Foreclosure / Notice of Sale', 'North Carolina (per county)', 'pre_foreclosure', 'seller', 'MANUAL_ONLY',
   'https://www.nccourts.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 88,
   'Special-proceeding foreclosure filings / notices of sale at the Clerk. Owner exports and uploads.'),
  ('NC OneMap — Parcels, Ownership & GIS', 'North Carolina (statewide)', 'absentee', 'seller', 'API',
   'https://www.nconemap.gov/', 'ALLOWED — ArcGIS Hub robots permits /datasets,/api,/search; disallows /admin,/people,/sessions; 60s crawl-delay (verified 2026-07-14)', 'PERMITTED', 'monthly', 80,
   'Statewide parcel/ownership GIS (ArcGIS Hub). Absentee = mailing ≠ situs; assessed value = equity proxy. Live-verified robots-permitted; owner confirms dataset terms with an attorney.'),
  ('NC County Assessor / GIS — Ownership & Absentee', 'North Carolina (per county)', 'absentee', 'seller', 'MANUAL_ONLY',
   'https://www.nconemap.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'quarterly', 60,
   'County assessor ownership rolls where the county portal prohibits automation. Owner uploads the export.'),
  -- NC buyers
  ('NC Cash-Sale Deeds (Register of Deeds, no lien)', 'North Carolina (per county)', 'cash_deed', 'buyer', 'MANUAL_ONLY',
   'https://www.sosnc.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 70,
   'Recorded deeds with no accompanying deed-of-trust = likely cash buyer. Owner exports recent deeds and uploads them.'),
  ('NC Repeat-Grantee LLCs (active investors)', 'North Carolina (per county)', 'repeat_grantee', 'buyer', 'MANUAL_ONLY',
   'https://www.sosnc.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 75,
   'Grantee LLCs on multiple deeds = active investors. Owner uploads deed export; module cross-references frequency.'),

  -- ═══ GEORGIA ═══ (sellers)
  ('GA Probate Court Filings', 'Georgia (per county)', 'probate', 'seller', 'MANUAL_ONLY',
   'https://georgiacourts.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 90,
   'Inherited property. County Probate Court estate filings. Owner downloads and uploads the docket.'),
  ('GA County Tax-Delinquent / Tax-Sale Lists', 'Georgia (per county)', 'tax_delinquent', 'seller', 'MANUAL_ONLY',
   'https://dor.georgia.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 85,
   'County tax commissioner delinquent + judicial tax-sale lists (e.g. Fulton, DeKalb, Gwinnett). Owner uploads the list.'),
  ('GA Foreclosure / Notice of Sale', 'Georgia (per county)', 'pre_foreclosure', 'seller', 'MANUAL_ONLY',
   'https://georgiacourts.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 88,
   'Legal-organ foreclosure advertisements / notices of sale. Owner exports and uploads.'),
  ('Atlanta Regional Open Data — Parcels & GIS', 'Georgia (Atlanta metro)', 'absentee', 'seller', 'API',
   'https://opendata.atlantaregional.com/', 'ALLOWED — ArcGIS Hub robots permits /datasets,/api,/search; disallows /admin,/people,/sessions; 60s crawl-delay (verified 2026-07-14)', 'PERMITTED', 'monthly', 80,
   'Atlanta Regional Commission parcel/GIS open data (ArcGIS Hub). Absentee + equity signals. Live-verified robots-permitted; owner confirms dataset terms.'),
  ('GA County Assessor / qPublic — Ownership & Absentee', 'Georgia (per county)', 'absentee', 'seller', 'MANUAL_ONLY',
   'https://qpublic.schneidercorp.com/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'quarterly', 60,
   'County assessor ownership (many GA counties via qPublic, which prohibits automation). Owner uploads the export.'),
  -- GA buyers
  ('GA Cash-Sale Deeds (Clerk of Superior Court, no lien)', 'Georgia (per county)', 'cash_deed', 'buyer', 'MANUAL_ONLY',
   'https://search.gsccca.org/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 70,
   'Deeds with no security deed recorded = likely cash buyer (GSCCCA real-estate index). Owner exports + uploads.'),
  ('GA Repeat-Grantee LLCs (active investors)', 'Georgia (per county)', 'repeat_grantee', 'buyer', 'MANUAL_ONLY',
   'https://search.gsccca.org/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 75,
   'Grantee LLCs on multiple deeds = active investors. Owner uploads deed export.'),

  -- ═══ MISSOURI (statewide) ═══ (sellers)
  ('MO Probate Filings (Circuit Court)', 'Missouri (per county)', 'probate', 'seller', 'MANUAL_ONLY',
   'https://www.courts.mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 90,
   'Inherited property. Circuit Court probate division (Case.net). Owner downloads and uploads the estate list.'),
  ('MO County Tax-Delinquent / Collector Lists', 'Missouri (per county)', 'tax_delinquent', 'seller', 'MANUAL_ONLY',
   'https://dor.mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'annual', 85,
   'County collector delinquent + tax-sale lists. Owner downloads the county list and uploads it.'),
  ('MO Pre-Foreclosure / Notice of Trustee Sale', 'Missouri (per county)', 'pre_foreclosure', 'seller', 'MANUAL_ONLY',
   'https://www.courts.mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 88,
   'Non-judicial notices of trustee sale. Owner exports and uploads.'),
  ('Missouri Open Data (data.mo.gov)', 'Missouri (statewide)', 'code_violation', 'seller', 'API',
   'https://data.mo.gov/', 'ALLOWED — Socrata robots permits /resource/ (SODA API); crawl-delay 1s (verified 2026-07-14)', 'PERMITTED', 'weekly', 80,
   'Statewide Socrata open-data portal (SODA /resource/ API). Property/code datasets. Live-verified robots-permitted; owner confirms dataset terms.'),
  ('MO County Assessor — Ownership & Absentee', 'Missouri (per county)', 'absentee', 'seller', 'MANUAL_ONLY',
   'https://stc.mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'quarterly', 60,
   'County assessor ownership rolls. Absentee = mailing ≠ situs. Owner uploads the export.'),
  -- MO buyers
  ('MO Cash-Sale Deeds (Recorder of Deeds, no lien)', 'Missouri (per county)', 'cash_deed', 'buyer', 'MANUAL_ONLY',
   'https://www.sos.mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 70,
   'Deeds with no deed-of-trust recorded = likely cash buyer. Owner exports recent deeds and uploads.'),
  ('MO Repeat-Grantee LLCs (active investors)', 'Missouri (per county)', 'repeat_grantee', 'buyer', 'MANUAL_ONLY',
   'https://www.sos.mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 75,
   'Grantee LLCs on multiple deeds = active investors. Owner uploads deed export.'),

  -- ═══ ST. LOUIS (metro) ═══ (sellers)
  ('St. Louis Probate (22nd Circuit)', 'St. Louis City/County, MO', 'probate', 'seller', 'MANUAL_ONLY',
   'https://www.courts.mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 90,
   'Inherited property in the St. Louis metro. Circuit Court probate. Owner downloads + uploads.'),
  ('St. Louis Tax-Delinquent / Sheriff Sale', 'St. Louis City/County, MO', 'tax_delinquent', 'seller', 'MANUAL_ONLY',
   'https://www.stlouis-mo.gov/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'annual', 85,
   'City Collector of Revenue + County Collector delinquent / sheriff-sale lists. Owner uploads.'),
  ('St. Louis Vacant / LRA-Owned Properties', 'St. Louis City, MO', 'vacant', 'seller', 'MANUAL_ONLY',
   'https://www.stlouis-mo.gov/government/departments/sldc/lra/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 84,
   'Land Reutilization Authority + vacant-building inventory (a major STL distress source). Owner uploads the export.'),
  ('St. Louis City Open Data (stlouis-mo.gov)', 'St. Louis City, MO', 'code_violation', 'seller', 'MANUAL_ONLY',
   'https://www.stlouis-mo.gov/data/', 'PROHIBITED-AUTOMATION — robots disallows /data/*&dataType=json + ?parcelId query (verified 2026-07-14) → manual download only', 'MANUAL_ONLY', 'monthly', 80,
   'City open-data (code/vacancy) — robots blocks JSON data automation, so owner downloads the CSV and uploads it.'),
  ('St. Louis Assessor — Ownership & Absentee', 'St. Louis City/County, MO', 'absentee', 'seller', 'MANUAL_ONLY',
   'https://www.stlouis-mo.gov/government/departments/assessor/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'quarterly', 60,
   'Assessor ownership rolls. Absentee = mailing ≠ situs. Owner uploads the export.'),
  -- St. Louis buyers
  ('St. Louis Cash-Sale Deeds (Recorder of Deeds, no lien)', 'St. Louis City/County, MO', 'cash_deed', 'buyer', 'MANUAL_ONLY',
   'https://www.stlouis-mo.gov/government/departments/recorder/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'weekly', 70,
   'Deeds with no deed-of-trust = likely cash buyer. Owner exports + uploads.'),
  ('St. Louis Repeat-Grantee LLCs (active investors)', 'St. Louis City/County, MO', 'repeat_grantee', 'buyer', 'MANUAL_ONLY',
   'https://www.stlouis-mo.gov/government/departments/recorder/', 'NOT_APPLICABLE (manual upload — not scraped)', 'MANUAL_ONLY', 'monthly', 75,
   'Grantee LLCs on multiple deeds = active investors. Owner uploads deed export.')
ON CONFLICT (name) DO NOTHING;
