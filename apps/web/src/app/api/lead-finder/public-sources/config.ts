/**
 * Public Data Sources Configuration
 *
 * Sources for high-probability SELLERS:
 * - Tax delinquent lists (county treasurer)
 * - Pre-foreclosure/NOD (county recorder)
 * - Probate filings (probate court)
 * - Code violations (city/county code enforcement)
 * - Vacant properties (utility disconnects, postal)
 * - Absentee owners (assessor - owner != property address)
 * - High equity + long ownership (assessor)
 * - Divorce filings (family court)
 * - Bankruptcy filings (federal PACER)
 * - Liens (county recorder - IRS, state, mechanic)
 *
 * Sources for local BUYERS:
 * - Recent cash purchases (recorder - no mortgage)
 * - LLC/Corp purchases (recorder - entity buyers)
 * - Flip activity (bought + sold within 12mo)
 * - Rental registrations (city housing dept)
 * - Investor networks (BiggerPockets, local REIAs)
 * - Wholesaler buyers lists (assignment recordings)
 */

export type DataTier = 'A' | 'B';

export interface PublicDataSource {
  id: string;
  name: string;
  category: 'seller' | 'buyer';
  recordType: string;
  distressWeight: number;
  dataTier: DataTier;
  accessMethod: 'API' | 'BULK_DOWNLOAD' | 'SCRAPE' | 'MANUAL';
  refreshCadence: 'daily' | 'weekly' | 'monthly';
  publicEndpoint?: string;
  apiProvider?: string;
  fallbackSource?: string;
  signals: string[];
  description: string;
}

export const SELLER_SOURCES: PublicDataSource[] = [
  // TIER A - API/Bulk Sources (Primary)
  {
    id: 'tax_delinquent_api',
    name: 'Tax Delinquent Properties',
    category: 'seller',
    recordType: 'tax_delinquent',
    distressWeight: 90,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'monthly',
    apiProvider: 'ATTOM',
    fallbackSource: 'tax_delinquent_county',
    signals: ['tax_delinquent', 'financial_distress'],
    description: 'Properties 2+ years behind on taxes, facing tax lien sale',
  },
  {
    id: 'pre_foreclosure_api',
    name: 'Pre-Foreclosure / NOD',
    category: 'seller',
    recordType: 'pre_foreclosure',
    distressWeight: 95,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'pre_foreclosure_county',
    signals: ['pre_foreclosure', 'nod', 'lis_pendens', 'urgent'],
    description: 'Notice of Default filed, 90-120 days before auction',
  },
  {
    id: 'probate_api',
    name: 'Probate Filings',
    category: 'seller',
    recordType: 'probate',
    distressWeight: 85,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'probate_court',
    signals: ['probate', 'inherited', 'estate', 'deceased_owner'],
    description: 'Inherited properties, heirs often motivated to sell quickly',
  },
  {
    id: 'vacant_api',
    name: 'Vacant Properties',
    category: 'seller',
    recordType: 'vacant',
    distressWeight: 75,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'monthly',
    apiProvider: 'ATTOM',
    fallbackSource: 'vacant_usps',
    signals: ['vacant', 'utility_disconnect', 'no_forwarding'],
    description: 'USPS vacancy indicator, utility disconnects',
  },
  {
    id: 'absentee_api',
    name: 'Absentee Owners',
    category: 'seller',
    recordType: 'absentee_owner',
    distressWeight: 65,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'monthly',
    apiProvider: 'ATTOM',
    fallbackSource: 'absentee_assessor',
    signals: ['absentee', 'out_of_state', 'tired_landlord'],
    description: 'Owner address differs from property address',
  },
  {
    id: 'high_equity_api',
    name: 'High Equity Properties',
    category: 'seller',
    recordType: 'high_equity',
    distressWeight: 55,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'monthly',
    apiProvider: 'ATTOM',
    fallbackSource: 'high_equity_assessor',
    signals: ['high_equity', 'free_clear', 'long_ownership'],
    description: '70%+ equity, owned 10+ years, likely no mortgage',
  },
  {
    id: 'code_violation_api',
    name: 'Code Violations',
    category: 'seller',
    recordType: 'code_violation',
    distressWeight: 80,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'code_violation_city',
    signals: ['code_violation', 'deferred_maintenance', 'fines'],
    description: 'Active code violations, fines accumulating',
  },
  {
    id: 'divorce_api',
    name: 'Divorce Filings',
    category: 'seller',
    recordType: 'divorce',
    distressWeight: 80,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'divorce_court',
    signals: ['divorce', 'forced_sale', 'motivated'],
    description: 'Divorce filings often require property liquidation',
  },
  {
    id: 'bankruptcy_api',
    name: 'Bankruptcy Filings',
    category: 'seller',
    recordType: 'bankruptcy',
    distressWeight: 88,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'bankruptcy_pacer',
    signals: ['bankruptcy', 'ch7', 'ch13', 'financial_distress'],
    description: 'Chapter 7/13 filings with real property',
  },
  {
    id: 'liens_api',
    name: 'Tax & Mechanic Liens',
    category: 'seller',
    recordType: 'liens',
    distressWeight: 82,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'liens_recorder',
    signals: ['irs_lien', 'state_lien', 'mechanic_lien', 'judgment'],
    description: 'IRS liens, state tax liens, mechanic liens, judgments',
  },

  // TIER B - County/Public Direct Sources (Fallback)
  {
    id: 'tax_delinquent_county',
    name: 'Tax Delinquent (County Direct)',
    category: 'seller',
    recordType: 'tax_delinquent',
    distressWeight: 90,
    dataTier: 'B',
    accessMethod: 'BULK_DOWNLOAD',
    refreshCadence: 'monthly',
    publicEndpoint: 'county_treasurer',
    signals: ['tax_delinquent', 'financial_distress'],
    description: 'Direct from county treasurer delinquent tax list',
  },
  {
    id: 'pre_foreclosure_county',
    name: 'Pre-Foreclosure (County Recorder)',
    category: 'seller',
    recordType: 'pre_foreclosure',
    distressWeight: 95,
    dataTier: 'B',
    accessMethod: 'BULK_DOWNLOAD',
    refreshCadence: 'weekly',
    publicEndpoint: 'county_recorder',
    signals: ['pre_foreclosure', 'nod', 'lis_pendens'],
    description: 'NOD/Lis Pendens from county recorder',
  },
  {
    id: 'probate_court',
    name: 'Probate (Court Records)',
    category: 'seller',
    recordType: 'probate',
    distressWeight: 85,
    dataTier: 'B',
    accessMethod: 'SCRAPE',
    refreshCadence: 'weekly',
    publicEndpoint: 'probate_court',
    signals: ['probate', 'inherited', 'estate'],
    description: 'Probate court case filings with real property',
  },
  {
    id: 'vacant_usps',
    name: 'Vacant (USPS/Utility)',
    category: 'seller',
    recordType: 'vacant',
    distressWeight: 75,
    dataTier: 'B',
    accessMethod: 'BULK_DOWNLOAD',
    refreshCadence: 'monthly',
    publicEndpoint: 'usps_vacancy',
    signals: ['vacant', 'utility_disconnect'],
    description: 'USPS vacancy data, utility disconnect lists',
  },
  {
    id: 'absentee_assessor',
    name: 'Absentee (County Assessor)',
    category: 'seller',
    recordType: 'absentee_owner',
    distressWeight: 65,
    dataTier: 'B',
    accessMethod: 'BULK_DOWNLOAD',
    refreshCadence: 'monthly',
    publicEndpoint: 'county_assessor',
    signals: ['absentee', 'out_of_state'],
    description: 'Assessor data where owner != property address',
  },
  {
    id: 'code_violation_city',
    name: 'Code Violations (City)',
    category: 'seller',
    recordType: 'code_violation',
    distressWeight: 80,
    dataTier: 'B',
    accessMethod: 'SCRAPE',
    refreshCadence: 'weekly',
    publicEndpoint: 'city_code_enforcement',
    signals: ['code_violation', 'deferred_maintenance'],
    description: 'City code enforcement open cases',
  },
  {
    id: 'divorce_court',
    name: 'Divorce (Family Court)',
    category: 'seller',
    recordType: 'divorce',
    distressWeight: 80,
    dataTier: 'B',
    accessMethod: 'SCRAPE',
    refreshCadence: 'weekly',
    publicEndpoint: 'family_court',
    signals: ['divorce', 'forced_sale'],
    description: 'Family court divorce filings',
  },
  {
    id: 'bankruptcy_pacer',
    name: 'Bankruptcy (PACER)',
    category: 'seller',
    recordType: 'bankruptcy',
    distressWeight: 88,
    dataTier: 'B',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    publicEndpoint: 'pacer.uscourts.gov',
    signals: ['bankruptcy', 'ch7', 'ch13'],
    description: 'Federal PACER bankruptcy filings',
  },
];

export const BUYER_SOURCES: PublicDataSource[] = [
  // TIER A - API Sources
  {
    id: 'cash_buyers_api',
    name: 'Recent Cash Buyers',
    category: 'buyer',
    recordType: 'cash_buyer',
    distressWeight: 90,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'cash_buyers_recorder',
    signals: ['cash_buyer', 'no_mortgage', 'investor'],
    description: 'Purchases with no recorded mortgage (last 12 months)',
  },
  {
    id: 'llc_buyers_api',
    name: 'LLC/Entity Buyers',
    category: 'buyer',
    recordType: 'entity_buyer',
    distressWeight: 85,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'llc_buyers_recorder',
    signals: ['llc_buyer', 'corp_buyer', 'investor', 'entity'],
    description: 'Properties purchased by LLCs/Corps (investors)',
  },
  {
    id: 'flippers_api',
    name: 'Active Flippers',
    category: 'buyer',
    recordType: 'flipper',
    distressWeight: 95,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'flippers_recorder',
    signals: ['flipper', 'quick_turn', 'rehab_investor'],
    description: 'Bought and sold within 12 months (flip activity)',
  },
  {
    id: 'multi_property_api',
    name: 'Multi-Property Owners',
    category: 'buyer',
    recordType: 'portfolio_owner',
    distressWeight: 80,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'monthly',
    apiProvider: 'ATTOM',
    fallbackSource: 'multi_property_assessor',
    signals: ['portfolio', 'landlord', 'multiple_properties'],
    description: 'Owners with 3+ properties in market (active investors)',
  },
  {
    id: 'assignment_buyers_api',
    name: 'Wholesale Assignment Buyers',
    category: 'buyer',
    recordType: 'assignment_buyer',
    distressWeight: 98,
    dataTier: 'A',
    accessMethod: 'API',
    refreshCadence: 'weekly',
    apiProvider: 'ATTOM',
    fallbackSource: 'assignment_buyers_recorder',
    signals: ['assignment_buyer', 'wholesale_buyer', 'proven'],
    description: 'Buyers who have closed on assignments (proven buyers)',
  },

  // TIER B - Direct/Public Sources
  {
    id: 'cash_buyers_recorder',
    name: 'Cash Buyers (County Recorder)',
    category: 'buyer',
    recordType: 'cash_buyer',
    distressWeight: 90,
    dataTier: 'B',
    accessMethod: 'BULK_DOWNLOAD',
    refreshCadence: 'weekly',
    publicEndpoint: 'county_recorder',
    signals: ['cash_buyer', 'no_mortgage'],
    description: 'Deeds with no concurrent mortgage recording',
  },
  {
    id: 'llc_buyers_recorder',
    name: 'LLC Buyers (County Recorder)',
    category: 'buyer',
    recordType: 'entity_buyer',
    distressWeight: 85,
    dataTier: 'B',
    accessMethod: 'BULK_DOWNLOAD',
    refreshCadence: 'weekly',
    publicEndpoint: 'county_recorder',
    signals: ['llc_buyer', 'corp_buyer'],
    description: 'Grantee names containing LLC, Inc, Corp, Trust',
  },
  {
    id: 'flippers_recorder',
    name: 'Flippers (Recorder Analysis)',
    category: 'buyer',
    recordType: 'flipper',
    distressWeight: 95,
    dataTier: 'B',
    accessMethod: 'BULK_DOWNLOAD',
    refreshCadence: 'monthly',
    publicEndpoint: 'county_recorder',
    signals: ['flipper', 'quick_turn'],
    description: 'Same party as grantee then grantor within 12mo',
  },
  {
    id: 'rental_registry',
    name: 'Rental Property Owners',
    category: 'buyer',
    recordType: 'landlord',
    distressWeight: 70,
    dataTier: 'B',
    accessMethod: 'SCRAPE',
    refreshCadence: 'monthly',
    publicEndpoint: 'city_housing',
    signals: ['landlord', 'rental_owner', 'investor'],
    description: 'City rental registration/licensing records',
  },
  {
    id: 'reia_members',
    name: 'Local REIA Members',
    category: 'buyer',
    recordType: 'reia_investor',
    distressWeight: 75,
    dataTier: 'B',
    accessMethod: 'MANUAL',
    refreshCadence: 'monthly',
    publicEndpoint: 'local_reia',
    signals: ['reia_member', 'active_investor', 'networked'],
    description: 'Local real estate investor association members',
  },
];

export const ALL_SOURCES = [...SELLER_SOURCES, ...BUYER_SOURCES];

export function getSourcesByTier(tier: DataTier): PublicDataSource[] {
  return ALL_SOURCES.filter(s => s.dataTier === tier);
}

export function getSourcesByCategory(category: 'seller' | 'buyer'): PublicDataSource[] {
  return ALL_SOURCES.filter(s => s.category === category);
}

export function getSourceWithFallback(sourceId: string): { primary: PublicDataSource | undefined; fallback: PublicDataSource | undefined } {
  const primary = ALL_SOURCES.find(s => s.id === sourceId);
  const fallback = primary?.fallbackSource ? ALL_SOURCES.find(s => s.id === primary.fallbackSource) : undefined;
  return { primary, fallback };
}

export function getTierASourcesWithFallbacks(): Array<{ primary: PublicDataSource; fallback?: PublicDataSource }> {
  return getSourcesByTier('A').map(primary => ({
    primary,
    fallback: primary.fallbackSource ? ALL_SOURCES.find(s => s.id === primary.fallbackSource) : undefined,
  }));
}
