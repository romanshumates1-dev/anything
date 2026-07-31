-- Migration 045: Add Wave 2 lead sources for FL, TX, AZ, CO, IN
-- These sources expand the Lead Finder registry. All are marked as MANUAL_ONLY
-- by default, requiring owner-driven data acquisition. This is an idempotent
-- operation; re-running it will not create duplicate sources.

INSERT INTO lead_sources (name, jurisdiction, seller_category, buyer_category, url, access_method, terms_status) VALUES
-- Florida (FL)
('Florida Statewide Unclaimed Property', 'FL', 'unclaimed_property', 'investor', 'https://www.fltreasurehunt.gov/', 'web_portal', 'MANUAL_ONLY'),
('Miami-Dade County Property Records', 'FL', 'property_records', 'investor', 'https://www.miamidade.gov/pa/property-search.asp', 'web_portal', 'MANUAL_ONLY'),
('Hillsborough County Foreclosures', 'FL', 'foreclosure', 'investor', 'https://www.hillsclerk.com/Court-Services/Foreclosure-Sales', 'web_portal', 'MANUAL_ONLY'),
('Orange County Probate', 'FL', 'probate', 'investor', 'https://www.myorangeclerk.com/Divisions/Probate', 'web_portal', 'MANUAL_ONLY'),
('Broward County Code Violations', 'FL', 'code_violation', 'investor', 'https://www.broward.org/CodeAppeals/Pages/SearchRecords.aspx', 'web_portal', 'MANUAL_ONLY'),

-- Texas (TX)
('Texas Comptroller Unclaimed Property', 'TX', 'unclaimed_property', 'investor', 'https://claimittexas.gov/', 'web_portal', 'MANUAL_ONLY'),
('Harris County Property Tax Delinquency', 'TX', 'tax_delinquent', 'investor', 'https://www.hctax.net/Property/Delinquent', 'web_portal', 'MANUAL_ONLY'),
('Dallas County Probate Records', 'TX', 'probate', 'investor', 'https://www.dallascounty.org/government/courts/probate/', 'web_portal', 'MANUAL_ONLY'),
('Tarrant County Foreclosure Postings', 'TX', 'foreclosure', 'investor', 'https://www.tarrantcounty.com/en/county-clerk/property-records/foreclosure-postings.html', 'web_portal', 'MANUAL_ONLY'),
('Bexar County Property Search', 'TX', 'property_records', 'investor', 'https://bexar.trueautomation.com/clientdb/?cid=110', 'web_portal', 'MANUAL_ONLY'),

-- Arizona (AZ)
('Arizona Unclaimed Property', 'AZ', 'unclaimed_property', 'investor', 'https://azunclaimed.gov/', 'web_portal', 'MANUAL_ONLY'),
('Maricopa County Tax Liens', 'AZ', 'tax_lien', 'investor', 'https://treasurer.maricopa.gov/Pages/TaxLienSale', 'web_portal', 'MANUAL_ONLY'),
('Pima County Assessor Records', 'AZ', 'property_records', 'investor', 'https://www.asr.pima.gov/Search', 'web_portal', 'MANUAL_ONLY'),
('Pinal County Probate Cases', 'AZ', 'probate', 'investor', 'https://www.coscpinalcountyaz.gov/public-access-to-court-information', 'web_portal', 'MANUAL_ONLY'),
('Yavapai County Foreclosures', 'AZ', 'foreclosure', 'investor', 'https://www.yavapaiaz.gov/clerk-of-the-court/foreclosure-sales', 'web_portal', 'MANUAL_ONLY'),

-- Colorado (CO)
('Colorado State Unclaimed Property', 'CO', 'unclaimed_property', 'investor', 'https://colorado.findyourunclaimedproperty.com/', 'web_portal', 'MANUAL_ONLY'),
('Denver County Foreclosure Sales', 'CO', 'foreclosure', 'investor', 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Sheriff-Department/Civil-Process/Foreclosure-Sales', 'web_portal', 'MANUAL_ONLY'),
('El Paso County Public Trustee', 'CO', 'foreclosure', 'investor', 'https://www.elpasopublictrustee.com/', 'web_portal', 'MANUAL_ONLY'),
('Arapahoe County Assessor Records', 'CO', 'property_records', 'investor', 'https://www.arapahoegov.com/assessor', 'web_portal', 'MANUAL_ONLY'),
('Jefferson County Probate', 'CO', 'probate', 'investor', 'https://www.jeffco.us/2186/Probate', 'web_portal', 'MANUAL_ONLY'),

-- Indiana (IN)
('Indiana Unclaimed Property', 'IN', 'unclaimed_property', 'investor', 'https://indianaunclaimed.gov/', 'web_portal', 'MANUAL_ONLY'),
('Marion County Sheriff Sales (Foreclosures)', 'IN', 'foreclosure', 'investor', 'https://www.sheriff.indy.gov/real-estate-sales', 'web_portal', 'MANUAL_ONLY'),
('Lake County Property Tax Search', 'IN', 'property_records', 'investor', 'https://www.lakecounty.in.gov/departments/treasurer/property-tax-search', 'web_portal', 'MANUAL_ONLY'),
('Allen County Assessor Property Search', 'IN', 'property_records', 'investor', 'https://www.allencounty.us/assessor', 'web_portal', 'MANUAL_ONLY'),
('Hamilton County Code Enforcement', 'IN', 'code_violation', 'investor', 'https://www.hamiltoncounty.in.gov/500/Code-Enforcement', 'web_portal', 'MANUAL_ONLY')

ON CONFLICT (name, jurisdiction) DO NOTHING;