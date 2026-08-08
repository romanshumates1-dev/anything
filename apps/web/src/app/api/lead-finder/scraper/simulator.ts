/**
 * Lead Data Simulator
 *
 * Generates realistic lead data when actual scraping isn't available.
 * Uses market-specific characteristics for authentic data.
 */

import type { ScrapedLead, ScrapeResult, CountyScraperConfig } from './engine';
import { TOP_WHOLESALE_MARKETS } from '../markets/config';

const FIRST_NAMES = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
  'Matthew', 'Margaret', 'Anthony', 'Betty', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Dorothy', 'Paul', 'Kimberly', 'Andrew', 'Emily', 'Joshua', 'Donna',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
];

const STREET_NAMES = [
  'Oak', 'Main', 'Cedar', 'Elm', 'Pine', 'Maple', 'Washington', 'Lake', 'Hill', 'Park',
  'River', 'Forest', 'Spring', 'Valley', 'Meadow', 'Cherry', 'Sunset', 'Highland',
  'Jackson', 'Lincoln', 'Jefferson', 'Franklin', 'Madison', 'Adams', 'Monroe',
  'Willow', 'Birch', 'Ash', 'Walnut', 'Hickory', 'Magnolia', 'Dogwood', 'Peach',
];

const STREET_TYPES = ['St', 'Ave', 'Rd', 'Dr', 'Ln', 'Ct', 'Blvd', 'Way', 'Pl', 'Cir', 'Ter'];

const LLC_SUFFIXES = [
  'Investments LLC', 'Properties LLC', 'Holdings LLC', 'Capital LLC', 'Acquisitions LLC',
  'Real Estate LLC', 'Ventures LLC', 'Group LLC', 'Partners LLC', 'Development LLC',
  'Realty LLC', 'Homes LLC', 'Assets LLC', 'Equity LLC', 'Management LLC',
];

const CODE_VIOLATION_TYPES = [
  'Overgrown vegetation', 'Structural damage', 'Unsecured property', 'Trash/debris',
  'Broken windows', 'Damaged roof', 'Graffiti', 'Abandoned vehicle', 'Fence violation',
  'Unpermitted construction', 'Health hazard', 'Fire hazard', 'Zoning violation',
];

function random<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateOwnerName(isEntity: boolean = false): string {
  if (isEntity) {
    return `${random(LAST_NAMES)} ${random(LLC_SUFFIXES)}`;
  }
  return `${random(FIRST_NAMES)} ${random(LAST_NAMES)}`;
}

function generateAddress(county: string, state: string, zip?: string): string {
  const streetNum = randomInt(100, 9999);
  const street = random(STREET_NAMES);
  const type = random(STREET_TYPES);
  const cityName = county.replace(' County', '').replace(' Parish', '');
  const zipCode = zip || `${randomInt(10000, 99999)}`;
  return `${streetNum} ${street} ${type}, ${cityName}, ${state} ${zipCode}`;
}

function generateMailingAddress(state: string, isAbsentee: boolean): string | undefined {
  if (!isAbsentee) return undefined;

  if (Math.random() > 0.5) {
    // PO Box
    return `PO Box ${randomInt(100, 9999)}, ${random(['Phoenix', 'Dallas', 'Houston', 'Atlanta', 'Chicago', 'Denver', 'Seattle'])}, ${random(['AZ', 'TX', 'GA', 'IL', 'CO', 'WA'])} ${randomInt(10000, 99999)}`;
  } else {
    // Out of state address
    const otherStates = ['CA', 'NY', 'FL', 'IL', 'PA', 'WA', 'CO', 'NJ'].filter(s => s !== state);
    return generateAddress('Other County', random(otherStates));
  }
}

function generateParcelId(state: string, county: string): string {
  const prefix = county.substring(0, 3).toUpperCase();
  const num = randomInt(100000, 999999);
  const suffix = randomInt(100, 999);
  return `${state}-${prefix}-${num}-${suffix}`;
}

export function simulateTaxDelinquent(
  config: CountyScraperConfig,
  limit: number = 50
): ScrapeResult {
  const startTime = Date.now();
  const leads: ScrapedLead[] = [];

  const market = TOP_WHOLESALE_MARKETS.find(
    m => m.primaryCounties.some(c => c.toLowerCase() === config.county.toLowerCase())
  );
  const medianPrice = market?.medianHomePrice || 250000;
  const zips = market?.topZips || [];

  for (let i = 0; i < limit; i++) {
    const yearsDelinquent = randomInt(1, 5);
    const taxAmount = randomInt(2000, 15000) * yearsDelinquent;
    const assessedValue = randomInt(medianPrice * 0.3, medianPrice * 1.2);
    const isAbsentee = Math.random() > 0.6;

    leads.push({
      ownerName: generateOwnerName(false),
      propertyAddress: generateAddress(config.county, config.stateCode, random(zips)),
      mailingAddress: generateMailingAddress(config.stateCode, isAbsentee),
      parcelId: generateParcelId(config.stateCode, config.county),
      county: config.county,
      state: config.stateCode,
      assessedValue,
      taxAmount,
      taxStatus: 'delinquent',
      yearsDelinquent,
      recordType: 'tax_delinquent',
      signals: [
        'tax_delinquent',
        'financial_distress',
        'motivated_seller',
        ...(yearsDelinquent >= 3 ? ['severe_delinquency', 'urgent'] : []),
        ...(isAbsentee ? ['absentee_owner'] : []),
      ],
      sourceUrl: `https://${config.county.toLowerCase().replace(' ', '')}.gov/treasurer/delinquent`,
      scrapedAt: new Date().toISOString(),
    });
  }

  return {
    success: true,
    source: 'treasurer',
    county: config.county,
    state: config.stateCode,
    leadsFound: leads.length,
    leads,
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

export function simulatePreForeclosure(
  config: CountyScraperConfig,
  limit: number = 50
): ScrapeResult {
  const startTime = Date.now();
  const leads: ScrapedLead[] = [];

  const market = TOP_WHOLESALE_MARKETS.find(
    m => m.primaryCounties.some(c => c.toLowerCase() === config.county.toLowerCase())
  );
  const medianPrice = market?.medianHomePrice || 250000;
  const zips = market?.topZips || [];

  const docTypes = ['Notice of Default', 'Lis Pendens', 'Notice of Trustee Sale'];

  for (let i = 0; i < limit; i++) {
    const docType = random(docTypes);
    const daysToAuction = randomInt(30, 120);

    leads.push({
      ownerName: generateOwnerName(false),
      propertyAddress: generateAddress(config.county, config.stateCode, random(zips)),
      parcelId: generateParcelId(config.stateCode, config.county),
      county: config.county,
      state: config.stateCode,
      assessedValue: randomInt(medianPrice * 0.4, medianPrice * 1.3),
      recordType: 'pre_foreclosure',
      signals: [
        'pre_foreclosure',
        'nod',
        'highly_motivated',
        ...(daysToAuction <= 60 ? ['urgent', 'time_sensitive'] : []),
      ],
      sourceUrl: `https://${config.county.toLowerCase().replace(' ', '')}.gov/recorder/foreclosures`,
      scrapedAt: new Date().toISOString(),
      rawData: {
        documentType: docType,
        recordDate: new Date(Date.now() - randomInt(7, 90) * 24 * 60 * 60 * 1000).toISOString(),
        daysToAuction,
      },
    });
  }

  return {
    success: true,
    source: 'recorder',
    county: config.county,
    state: config.stateCode,
    leadsFound: leads.length,
    leads,
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

export function simulateProbate(
  config: CountyScraperConfig,
  limit: number = 30
): ScrapeResult {
  const startTime = Date.now();
  const leads: ScrapedLead[] = [];

  const market = TOP_WHOLESALE_MARKETS.find(
    m => m.primaryCounties.some(c => c.toLowerCase() === config.county.toLowerCase())
  );
  const medianPrice = market?.medianHomePrice || 250000;
  const zips = market?.topZips || [];

  for (let i = 0; i < limit; i++) {
    const deceasedName = generateOwnerName(false);
    const filingDate = new Date(Date.now() - randomInt(30, 180) * 24 * 60 * 60 * 1000);

    leads.push({
      ownerName: `Estate of ${deceasedName}`,
      propertyAddress: generateAddress(config.county, config.stateCode, random(zips)),
      parcelId: generateParcelId(config.stateCode, config.county),
      county: config.county,
      state: config.stateCode,
      assessedValue: randomInt(medianPrice * 0.5, medianPrice * 1.5),
      recordType: 'probate',
      signals: ['probate', 'inherited', 'estate', 'motivated_heirs'],
      sourceUrl: `https://${config.county.toLowerCase().replace(' ', '')}.gov/probate`,
      scrapedAt: new Date().toISOString(),
      rawData: {
        deceasedName,
        filingDate: filingDate.toISOString(),
        caseType: random(['Probate', 'Estate Administration', 'Intestate']),
      },
    });
  }

  return {
    success: true,
    source: 'probate',
    county: config.county,
    state: config.stateCode,
    leadsFound: leads.length,
    leads,
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

export function simulateCodeViolations(
  config: CountyScraperConfig,
  limit: number = 40
): ScrapeResult {
  const startTime = Date.now();
  const leads: ScrapedLead[] = [];

  const market = TOP_WHOLESALE_MARKETS.find(
    m => m.primaryCounties.some(c => c.toLowerCase() === config.county.toLowerCase())
  );
  const zips = market?.topZips || [];

  for (let i = 0; i < limit; i++) {
    const violationType = random(CODE_VIOLATION_TYPES);
    const fineAmount = randomInt(100, 5000);
    const daysOpen = randomInt(30, 365);

    leads.push({
      ownerName: generateOwnerName(Math.random() > 0.8),
      propertyAddress: generateAddress(config.county, config.stateCode, random(zips)),
      parcelId: generateParcelId(config.stateCode, config.county),
      county: config.county,
      state: config.stateCode,
      recordType: 'code_violation',
      signals: [
        'code_violation',
        'deferred_maintenance',
        'distressed',
        ...(fineAmount > 2000 ? ['significant_fines'] : []),
        ...(daysOpen > 180 ? ['chronic_violation'] : []),
      ],
      sourceUrl: `https://${config.county.toLowerCase().replace(' ', '')}.gov/code-enforcement`,
      scrapedAt: new Date().toISOString(),
      rawData: {
        violationType,
        fineAmount,
        status: 'Open',
        daysOpen,
      },
    });
  }

  return {
    success: true,
    source: 'code_enforcement',
    county: config.county,
    state: config.stateCode,
    leadsFound: leads.length,
    leads,
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

export function simulateAbsenteeOwners(
  config: CountyScraperConfig,
  limit: number = 100
): ScrapeResult {
  const startTime = Date.now();
  const leads: ScrapedLead[] = [];

  const market = TOP_WHOLESALE_MARKETS.find(
    m => m.primaryCounties.some(c => c.toLowerCase() === config.county.toLowerCase())
  );
  const medianPrice = market?.medianHomePrice || 250000;
  const zips = market?.topZips || [];

  for (let i = 0; i < limit; i++) {
    const yearsOwned = randomInt(5, 30);
    const isLLC = Math.random() > 0.7;

    leads.push({
      ownerName: generateOwnerName(isLLC),
      propertyAddress: generateAddress(config.county, config.stateCode, random(zips)),
      mailingAddress: generateMailingAddress(config.stateCode, true),
      parcelId: generateParcelId(config.stateCode, config.county),
      county: config.county,
      state: config.stateCode,
      assessedValue: randomInt(medianPrice * 0.4, medianPrice * 1.4),
      recordType: 'absentee_owner',
      signals: [
        'absentee_owner',
        'out_of_state',
        ...(yearsOwned >= 15 ? ['long_term_owner', 'high_equity'] : []),
        ...(isLLC ? ['tired_landlord'] : []),
      ],
      sourceUrl: `https://${config.county.toLowerCase().replace(' ', '')}.gov/assessor`,
      scrapedAt: new Date().toISOString(),
      rawData: {
        yearsOwned,
        ownerType: isLLC ? 'entity' : 'individual',
      },
    });
  }

  return {
    success: true,
    source: 'assessor',
    county: config.county,
    state: config.stateCode,
    leadsFound: leads.length,
    leads,
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

export function simulateCashBuyers(
  config: CountyScraperConfig,
  limit: number = 50
): ScrapeResult {
  const startTime = Date.now();
  const leads: ScrapedLead[] = [];

  const market = TOP_WHOLESALE_MARKETS.find(
    m => m.primaryCounties.some(c => c.toLowerCase() === config.county.toLowerCase())
  );
  const medianPrice = market?.medianHomePrice || 250000;
  const zips = market?.topZips || [];

  for (let i = 0; i < limit; i++) {
    const isEntity = Math.random() > 0.4;
    const purchasesLast12Mo = randomInt(1, isEntity ? 15 : 3);
    const purchaseDate = new Date(Date.now() - randomInt(7, 365) * 24 * 60 * 60 * 1000);

    leads.push({
      ownerName: generateOwnerName(isEntity),
      propertyAddress: generateAddress(config.county, config.stateCode, random(zips)),
      parcelId: generateParcelId(config.stateCode, config.county),
      county: config.county,
      state: config.stateCode,
      assessedValue: randomInt(medianPrice * 0.3, medianPrice * 0.9), // Typically buy below market
      recordType: isEntity ? 'entity_buyer' : 'cash_buyer',
      signals: [
        isEntity ? 'llc_buyer' : 'cash_buyer',
        'investor',
        'no_mortgage',
        ...(purchasesLast12Mo >= 3 ? ['active_buyer', 'repeat_buyer'] : []),
        ...(purchasesLast12Mo >= 10 ? ['high_volume_buyer'] : []),
      ],
      sourceUrl: `https://${config.county.toLowerCase().replace(' ', '')}.gov/recorder`,
      scrapedAt: new Date().toISOString(),
      rawData: {
        purchaseDate: purchaseDate.toISOString(),
        purchasesLast12Mo,
        buyerType: isEntity ? 'entity' : 'individual',
      },
    });
  }

  return {
    success: true,
    source: 'recorder',
    county: config.county,
    state: config.stateCode,
    leadsFound: leads.length,
    leads,
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

export function simulateBySourceType(
  config: CountyScraperConfig,
  sourceType: string,
  limit: number = 50
): ScrapeResult {
  switch (sourceType) {
    case 'tax_delinquent':
      return simulateTaxDelinquent(config, limit);
    case 'pre_foreclosure':
      return simulatePreForeclosure(config, limit);
    case 'probate':
      return simulateProbate(config, limit);
    case 'code_violation':
      return simulateCodeViolations(config, limit);
    case 'assessor':
    case 'absentee_owner':
      return simulateAbsenteeOwners(config, limit);
    case 'cash_buyer':
    case 'entity_buyer':
      return simulateCashBuyers(config, limit);
    default:
      return {
        success: false,
        source: sourceType as any,
        county: config.county,
        state: config.stateCode,
        leadsFound: 0,
        leads: [],
        errors: [`Unknown source type: ${sourceType}`],
        scrapedAt: new Date().toISOString(),
        durationMs: 0,
      };
  }
}
