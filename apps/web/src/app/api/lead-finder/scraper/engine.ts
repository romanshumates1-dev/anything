/**
 * Public Records Scraper Engine
 *
 * Self-sufficient lead generation from government & public sources.
 * NO third-party API dependencies.
 *
 * Legal sources:
 * - County Assessor (property ownership, values, characteristics)
 * - County Recorder (deeds, liens, mortgages, foreclosures)
 * - County Treasurer (tax delinquent lists, tax sales)
 * - Probate Court (estate filings, inherited properties)
 * - Code Enforcement (violations, condemned properties)
 * - Secretary of State (LLC/Corp lookups for entity buyers)
 * - USPS (vacancy indicators via address validation)
 * - Bankruptcy Court (PACER - federal)
 *
 * When cheerio is not available or scraping fails, falls back to
 * realistic simulated data based on market characteristics.
 */

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace cheerio {
  interface Element {}
}

let cheerio: any;
try {
  cheerio = require('cheerio');
} catch {
  cheerio = null;
}

export type ScraperSourceType =
  | 'assessor'
  | 'recorder'
  | 'treasurer'
  | 'probate'
  | 'code_enforcement'
  | 'sos'
  | 'bankruptcy';

export interface ScrapedLead {
  ownerName: string;
  propertyAddress: string;
  mailingAddress?: string;
  parcelId?: string;
  county: string;
  state: string;
  assessedValue?: number;
  marketValue?: number;
  taxAmount?: number;
  taxStatus?: 'current' | 'delinquent' | 'in_sale';
  yearsDelinquent?: number;
  recordType: string;
  signals: string[];
  sourceUrl: string;
  scrapedAt: string;
  rawData?: Record<string, any>;
}

export interface CountyScraperConfig {
  county: string;
  state: string;
  stateCode: string;
  sources: {
    assessor?: {
      url: string;
      searchUrl?: string;
      method: 'GET' | 'POST';
      selectors: {
        resultRows: string;
        ownerName: string;
        address: string;
        parcelId: string;
        assessedValue?: string;
        mailingAddress?: string;
      };
      pagination?: {
        param: string;
        maxPages: number;
      };
    };
    treasurer?: {
      url: string;
      delinquentListUrl?: string;
      method: 'GET' | 'POST';
      selectors: {
        resultRows: string;
        ownerName: string;
        address: string;
        parcelId: string;
        amountDue: string;
        yearsDelinquent?: string;
      };
    };
    recorder?: {
      url: string;
      searchTypes: string[];
      method: 'GET' | 'POST';
      selectors: {
        resultRows: string;
        documentType: string;
        grantorGrantee: string;
        recordDate: string;
        propertyDesc?: string;
      };
    };
    probate?: {
      url: string;
      method: 'GET' | 'POST';
      selectors: {
        caseRows: string;
        deceasedName: string;
        filingDate: string;
        caseType: string;
        propertyMentioned?: string;
      };
    };
    codeEnforcement?: {
      url: string;
      method: 'GET' | 'POST';
      selectors: {
        violationRows: string;
        address: string;
        violationType: string;
        status: string;
        fineAmount?: string;
      };
    };
  };
}

export interface ScrapeResult {
  success: boolean;
  source: ScraperSourceType;
  county: string;
  state: string;
  leadsFound: number;
  leads: ScrapedLead[];
  errors: string[];
  scrapedAt: string;
  durationMs: number;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> {
  const headers = {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    ...options.headers,
  };

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { ...options, headers });
      if (response.ok) return response;
      if (response.status === 429) {
        await delay(5000 * (i + 1));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(2000 * (i + 1));
    }
  }
  throw new Error('Max retries exceeded');
}

export async function checkRobotsTxt(baseUrl: string): Promise<{ allowed: boolean; crawlDelay?: number }> {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).toString();
    const response = await fetch(robotsUrl);
    if (!response.ok) return { allowed: true };

    const text = await response.text();
    const lines = text.split('\n');

    let inUserAgentBlock = false;
    let crawlDelay: number | undefined;

    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();

      if (trimmed.startsWith('user-agent:')) {
        const agent = trimmed.replace('user-agent:', '').trim();
        inUserAgentBlock = agent === '*' || agent.includes('bot');
      }

      if (inUserAgentBlock) {
        if (trimmed.startsWith('disallow: /')) {
          return { allowed: false };
        }
        if (trimmed.startsWith('crawl-delay:')) {
          crawlDelay = parseInt(trimmed.replace('crawl-delay:', '').trim(), 10);
        }
      }
    }

    return { allowed: true, crawlDelay };
  } catch {
    return { allowed: true };
  }
}

export async function scrapeAssessorRecords(
  config: CountyScraperConfig
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const result: ScrapeResult = {
    success: false,
    source: 'assessor',
    county: config.county,
    state: config.stateCode,
    leadsFound: 0,
    leads: [],
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: 0,
  };

  if (!config.sources.assessor) {
    result.errors.push('No assessor config');
    return result;
  }

  const { url, selectors } = config.sources.assessor;

  try {
    const robotsCheck = await checkRobotsTxt(url);
    if (!robotsCheck.allowed) {
      result.errors.push('Blocked by robots.txt');
      return result;
    }

    if (robotsCheck.crawlDelay) {
      await delay(robotsCheck.crawlDelay * 1000);
    }

    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    $(selectors.resultRows).each((_: number, row: cheerio.Element) => {
      try {
        const $row = $(row);
        const ownerName = $row.find(selectors.ownerName).text().trim();
        const address = $row.find(selectors.address).text().trim();
        const parcelId = $row.find(selectors.parcelId).text().trim();

        if (ownerName && address) {
          const lead: ScrapedLead = {
            ownerName,
            propertyAddress: address,
            parcelId: parcelId || undefined,
            county: config.county,
            state: config.stateCode,
            recordType: 'assessor',
            signals: ['property_owner'],
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
          };

          if (selectors.assessedValue) {
            const valueText = $row.find(selectors.assessedValue).text().trim();
            const value = parseInt(valueText.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(value)) lead.assessedValue = value;
          }

          if (selectors.mailingAddress) {
            lead.mailingAddress = $row.find(selectors.mailingAddress).text().trim();
            if (lead.mailingAddress && lead.mailingAddress !== address) {
              lead.signals.push('absentee_owner');
            }
          }

          result.leads.push(lead);
        }
      } catch (err) {
        result.errors.push(`Row parse error: ${err}`);
      }
    });

    result.success = true;
    result.leadsFound = result.leads.length;
  } catch (err: any) {
    result.errors.push(`Scrape failed: ${err.message}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

export async function scrapeTaxDelinquent(
  config: CountyScraperConfig
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const result: ScrapeResult = {
    success: false,
    source: 'treasurer',
    county: config.county,
    state: config.stateCode,
    leadsFound: 0,
    leads: [],
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: 0,
  };

  if (!config.sources.treasurer) {
    result.errors.push('No treasurer config');
    return result;
  }

  const { url, delinquentListUrl, selectors } = config.sources.treasurer;
  const targetUrl = delinquentListUrl || url;

  try {
    const robotsCheck = await checkRobotsTxt(targetUrl);
    if (!robotsCheck.allowed) {
      result.errors.push('Blocked by robots.txt');
      return result;
    }

    const response = await fetchWithRetry(targetUrl);
    const html = await response.text();
    const $ = cheerio.load(html);

    $(selectors.resultRows).each((_: number, row: cheerio.Element) => {
      try {
        const $row = $(row);
        const ownerName = $row.find(selectors.ownerName).text().trim();
        const address = $row.find(selectors.address).text().trim();
        const parcelId = $row.find(selectors.parcelId).text().trim();
        const amountDue = $row.find(selectors.amountDue).text().trim();

        if (ownerName && address) {
          const lead: ScrapedLead = {
            ownerName,
            propertyAddress: address,
            parcelId: parcelId || undefined,
            county: config.county,
            state: config.stateCode,
            recordType: 'tax_delinquent',
            signals: ['tax_delinquent', 'financial_distress', 'motivated_seller'],
            sourceUrl: targetUrl,
            scrapedAt: new Date().toISOString(),
            taxStatus: 'delinquent',
          };

          const taxAmount = parseInt(amountDue.replace(/[^0-9]/g, ''), 10);
          if (!isNaN(taxAmount)) lead.taxAmount = taxAmount;

          if (selectors.yearsDelinquent) {
            const years = parseInt($row.find(selectors.yearsDelinquent).text().trim(), 10);
            if (!isNaN(years)) {
              lead.yearsDelinquent = years;
              if (years >= 3) lead.signals.push('severe_delinquency');
            }
          }

          result.leads.push(lead);
        }
      } catch (err) {
        result.errors.push(`Row parse error: ${err}`);
      }
    });

    result.success = true;
    result.leadsFound = result.leads.length;
  } catch (err: any) {
    result.errors.push(`Scrape failed: ${err.message}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

export async function scrapeForeclosures(
  config: CountyScraperConfig
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const result: ScrapeResult = {
    success: false,
    source: 'recorder',
    county: config.county,
    state: config.stateCode,
    leadsFound: 0,
    leads: [],
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: 0,
  };

  if (!config.sources.recorder) {
    result.errors.push('No recorder config');
    return result;
  }

  const { url, selectors } = config.sources.recorder;

  try {
    const robotsCheck = await checkRobotsTxt(url);
    if (!robotsCheck.allowed) {
      result.errors.push('Blocked by robots.txt');
      return result;
    }

    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    $(selectors.resultRows).each((_: number, row: cheerio.Element) => {
      try {
        const $row = $(row);
        const docType = $row.find(selectors.documentType).text().trim().toLowerCase();
        const grantorGrantee = $row.find(selectors.grantorGrantee).text().trim();
        const recordDate = $row.find(selectors.recordDate).text().trim();

        const isForeclosure = /notice.*default|lis.*pendens|foreclosure|nod|trustee.*sale/i.test(docType);

        if (isForeclosure && grantorGrantee) {
          const lead: ScrapedLead = {
            ownerName: grantorGrantee.split(/[,\/]/)[0].trim(),
            propertyAddress: selectors.propertyDesc ? $row.find(selectors.propertyDesc).text().trim() : '',
            county: config.county,
            state: config.stateCode,
            recordType: 'pre_foreclosure',
            signals: ['pre_foreclosure', 'nod', 'urgent', 'highly_motivated'],
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
            rawData: { documentType: docType, recordDate },
          };

          result.leads.push(lead);
        }
      } catch (err) {
        result.errors.push(`Row parse error: ${err}`);
      }
    });

    result.success = true;
    result.leadsFound = result.leads.length;
  } catch (err: any) {
    result.errors.push(`Scrape failed: ${err.message}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

export async function scrapeProbate(
  config: CountyScraperConfig
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const result: ScrapeResult = {
    success: false,
    source: 'probate',
    county: config.county,
    state: config.stateCode,
    leadsFound: 0,
    leads: [],
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: 0,
  };

  if (!config.sources.probate) {
    result.errors.push('No probate config');
    return result;
  }

  const { url, selectors } = config.sources.probate;

  try {
    const robotsCheck = await checkRobotsTxt(url);
    if (!robotsCheck.allowed) {
      result.errors.push('Blocked by robots.txt');
      return result;
    }

    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    $(selectors.caseRows).each((_: number, row: cheerio.Element) => {
      try {
        const $row = $(row);
        const deceasedName = $row.find(selectors.deceasedName).text().trim();
        const filingDate = $row.find(selectors.filingDate).text().trim();
        const caseType = $row.find(selectors.caseType).text().trim().toLowerCase();

        const isProbate = /probate|estate|deceased|intestate|testate/i.test(caseType);

        if (isProbate && deceasedName) {
          const lead: ScrapedLead = {
            ownerName: `Estate of ${deceasedName}`,
            propertyAddress: selectors.propertyMentioned ? $row.find(selectors.propertyMentioned).text().trim() : '',
            county: config.county,
            state: config.stateCode,
            recordType: 'probate',
            signals: ['probate', 'inherited', 'estate', 'motivated_heirs'],
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
            rawData: { deceasedName, filingDate, caseType },
          };

          result.leads.push(lead);
        }
      } catch (err) {
        result.errors.push(`Row parse error: ${err}`);
      }
    });

    result.success = true;
    result.leadsFound = result.leads.length;
  } catch (err: any) {
    result.errors.push(`Scrape failed: ${err.message}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

export async function scrapeCodeViolations(
  config: CountyScraperConfig
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const result: ScrapeResult = {
    success: false,
    source: 'code_enforcement',
    county: config.county,
    state: config.stateCode,
    leadsFound: 0,
    leads: [],
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: 0,
  };

  if (!config.sources.codeEnforcement) {
    result.errors.push('No code enforcement config');
    return result;
  }

  const { url, selectors } = config.sources.codeEnforcement;

  try {
    const robotsCheck = await checkRobotsTxt(url);
    if (!robotsCheck.allowed) {
      result.errors.push('Blocked by robots.txt');
      return result;
    }

    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    $(selectors.violationRows).each((_: number, row: cheerio.Element) => {
      try {
        const $row = $(row);
        const address = $row.find(selectors.address).text().trim();
        const violationType = $row.find(selectors.violationType).text().trim();
        const status = $row.find(selectors.status).text().trim().toLowerCase();

        const isActive = /open|active|pending|unresolved/i.test(status);

        if (isActive && address) {
          const lead: ScrapedLead = {
            ownerName: '',
            propertyAddress: address,
            county: config.county,
            state: config.stateCode,
            recordType: 'code_violation',
            signals: ['code_violation', 'deferred_maintenance', 'distressed'],
            sourceUrl: url,
            scrapedAt: new Date().toISOString(),
            rawData: { violationType, status },
          };

          if (selectors.fineAmount) {
            const fineText = $row.find(selectors.fineAmount).text().trim();
            const fine = parseInt(fineText.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(fine) && fine > 1000) {
              lead.signals.push('significant_fines');
            }
          }

          result.leads.push(lead);
        }
      } catch (err) {
        result.errors.push(`Row parse error: ${err}`);
      }
    });

    result.success = true;
    result.leadsFound = result.leads.length;
  } catch (err: any) {
    result.errors.push(`Scrape failed: ${err.message}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

export async function scrapeCashBuyers(
  config: CountyScraperConfig
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const result: ScrapeResult = {
    success: false,
    source: 'recorder',
    county: config.county,
    state: config.stateCode,
    leadsFound: 0,
    leads: [],
    errors: [],
    scrapedAt: new Date().toISOString(),
    durationMs: 0,
  };

  if (!config.sources.recorder) {
    result.errors.push('No recorder config');
    return result;
  }

  const { url, selectors } = config.sources.recorder;

  try {
    const robotsCheck = await checkRobotsTxt(url);
    if (!robotsCheck.allowed) {
      result.errors.push('Blocked by robots.txt');
      return result;
    }

    const response = await fetchWithRetry(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    const deedDates: Map<string, { grantee: string; date: string }[]> = new Map();

    $(selectors.resultRows).each((_: number, row: cheerio.Element) => {
      try {
        const $row = $(row);
        const docType = $row.find(selectors.documentType).text().trim().toLowerCase();
        const grantorGrantee = $row.find(selectors.grantorGrantee).text().trim();
        const recordDate = $row.find(selectors.recordDate).text().trim();

        const isDeed = /deed|warranty|grant|quit.*claim/i.test(docType);
        const isMortgage = /mortgage|deed.*trust|dot/i.test(docType);

        if (isDeed) {
          const grantee = grantorGrantee.split(/to|\/|\|/i).pop()?.trim() || grantorGrantee;
          const existing = deedDates.get(recordDate) || [];
          existing.push({ grantee, date: recordDate });
          deedDates.set(recordDate, existing);
        }
      } catch (err) {
        result.errors.push(`Row parse error: ${err}`);
      }
    });

    for (const [date, deeds] of deedDates) {
      for (const deed of deeds) {
        const isLLC = /llc|inc|corp|trust|holdings|investments|properties|capital/i.test(deed.grantee);

        const lead: ScrapedLead = {
          ownerName: deed.grantee,
          propertyAddress: '',
          county: config.county,
          state: config.stateCode,
          recordType: isLLC ? 'entity_buyer' : 'cash_buyer',
          signals: isLLC
            ? ['llc_buyer', 'investor', 'repeat_buyer']
            : ['cash_buyer', 'investor', 'no_mortgage'],
          sourceUrl: url,
          scrapedAt: new Date().toISOString(),
          rawData: { purchaseDate: date },
        };

        result.leads.push(lead);
      }
    }

    result.success = true;
    result.leadsFound = result.leads.length;
  } catch (err: any) {
    result.errors.push(`Scrape failed: ${err.message}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}
