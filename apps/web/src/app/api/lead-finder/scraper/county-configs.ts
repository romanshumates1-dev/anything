/**
 * County-Specific Scraper Configurations
 *
 * Each county has different websites and HTML structures.
 * This maps the top wholesale markets to their public record sources.
 */

import type { CountyScraperConfig } from './engine';

export const COUNTY_CONFIGS: CountyScraperConfig[] = [
  // ═══════════════════════════════════════════════════════════════════
  // TEXAS
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Harris County',
    state: 'Texas',
    stateCode: 'TX',
    sources: {
      assessor: {
        url: 'https://hcad.org/property-search/',
        method: 'GET',
        selectors: {
          resultRows: '.property-row, tr.search-result',
          ownerName: '.owner-name, td:nth-child(2)',
          address: '.property-address, td:nth-child(3)',
          parcelId: '.account-number, td:nth-child(1)',
          assessedValue: '.market-value, td:nth-child(5)',
          mailingAddress: '.mailing-address',
        },
      },
      treasurer: {
        url: 'https://www.hctax.net/Property/PropertyTax',
        delinquentListUrl: 'https://www.hctax.net/Property/DelinquentTaxSale',
        method: 'GET',
        selectors: {
          resultRows: '.delinquent-row, tr.tax-record',
          ownerName: '.owner, td:nth-child(2)',
          address: '.address, td:nth-child(3)',
          parcelId: '.account, td:nth-child(1)',
          amountDue: '.amount-due, td:nth-child(4)',
          yearsDelinquent: '.years, td:nth-child(5)',
        },
      },
      recorder: {
        url: 'https://www.cclerk.hctx.net/Applications/WebSearch/RP_R.aspx',
        searchTypes: ['NOD', 'LIS_PENDENS', 'DEED', 'DEED_OF_TRUST'],
        method: 'POST',
        selectors: {
          resultRows: '.document-row, tr.record',
          documentType: '.doc-type, td:nth-child(2)',
          grantorGrantee: '.parties, td:nth-child(3)',
          recordDate: '.record-date, td:nth-child(4)',
          propertyDesc: '.legal-desc, td:nth-child(5)',
        },
      },
      probate: {
        url: 'https://www.justex.net/Courts/Probate/CaseSearch.aspx',
        method: 'GET',
        selectors: {
          caseRows: '.case-row, tr.probate-case',
          deceasedName: '.deceased, td:nth-child(2)',
          filingDate: '.filed-date, td:nth-child(3)',
          caseType: '.case-type, td:nth-child(4)',
        },
      },
    },
  },
  {
    county: 'Dallas County',
    state: 'Texas',
    stateCode: 'TX',
    sources: {
      assessor: {
        url: 'https://www.dallascad.org/SearchAddr.aspx',
        method: 'GET',
        selectors: {
          resultRows: '.DataGridItem, .DataGridAltItem',
          ownerName: 'td:nth-child(3)',
          address: 'td:nth-child(2)',
          parcelId: 'td:nth-child(1)',
          assessedValue: 'td:nth-child(5)',
        },
      },
      treasurer: {
        url: 'https://www.dallascounty.org/departments/tax/',
        delinquentListUrl: 'https://www.dallascounty.org/departments/tax/delinquent-tax-sales.php',
        method: 'GET',
        selectors: {
          resultRows: 'tr.delinquent',
          ownerName: 'td:nth-child(2)',
          address: 'td:nth-child(3)',
          parcelId: 'td:nth-child(1)',
          amountDue: 'td:nth-child(4)',
        },
      },
      recorder: {
        url: 'https://www.dallascounty.org/departments/countyclerk/real-property-records.php',
        searchTypes: ['FORECLOSURE', 'DEED'],
        method: 'GET',
        selectors: {
          resultRows: 'tr.record-row',
          documentType: 'td:nth-child(2)',
          grantorGrantee: 'td:nth-child(3)',
          recordDate: 'td:nth-child(1)',
        },
      },
    },
  },
  {
    county: 'Tarrant County',
    state: 'Texas',
    stateCode: 'TX',
    sources: {
      assessor: {
        url: 'https://www.tad.org/property-search',
        method: 'GET',
        selectors: {
          resultRows: '.property-result',
          ownerName: '.owner',
          address: '.situs-address',
          parcelId: '.account-id',
          assessedValue: '.appraised-value',
        },
      },
      treasurer: {
        url: 'https://www.tarrantcounty.com/en/tax/property-tax.html',
        method: 'GET',
        selectors: {
          resultRows: '.tax-record',
          ownerName: '.owner-name',
          address: '.property-address',
          parcelId: '.account',
          amountDue: '.due-amount',
        },
      },
    },
  },
  {
    county: 'Bexar County',
    state: 'Texas',
    stateCode: 'TX',
    sources: {
      assessor: {
        url: 'https://www.bcad.org/ClientDB/PropertySearch.aspx',
        method: 'GET',
        selectors: {
          resultRows: '.grid-row',
          ownerName: '.owner-col',
          address: '.address-col',
          parcelId: '.pid-col',
          assessedValue: '.value-col',
        },
      },
      treasurer: {
        url: 'https://www.bexar.org/1845/Property-Taxes',
        method: 'GET',
        selectors: {
          resultRows: '.tax-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.account',
          amountDue: '.amount',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // FLORIDA
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Hillsborough County',
    state: 'Florida',
    stateCode: 'FL',
    sources: {
      assessor: {
        url: 'https://www.hcpafl.org/Property-Search',
        method: 'GET',
        selectors: {
          resultRows: '.property-item',
          ownerName: '.owner-name',
          address: '.site-address',
          parcelId: '.folio-number',
          assessedValue: '.just-value',
          mailingAddress: '.mailing-addr',
        },
      },
      treasurer: {
        url: 'https://www.hillstax.org/',
        delinquentListUrl: 'https://www.hillstax.org/taxes/delinquent/',
        method: 'GET',
        selectors: {
          resultRows: '.delinquent-item',
          ownerName: '.owner',
          address: '.property',
          parcelId: '.folio',
          amountDue: '.due',
        },
      },
      probate: {
        url: 'https://www.hillsclerk.com/Court-Records/Probate',
        method: 'GET',
        selectors: {
          caseRows: '.case-item',
          deceasedName: '.party-name',
          filingDate: '.filing-date',
          caseType: '.case-type',
        },
      },
    },
  },
  {
    county: 'Orange County',
    state: 'Florida',
    stateCode: 'FL',
    sources: {
      assessor: {
        url: 'https://www.ocpafl.org/searches/parcelsearch.aspx',
        method: 'GET',
        selectors: {
          resultRows: '.parcel-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel-id',
          assessedValue: '.value',
        },
      },
      treasurer: {
        url: 'https://www.octaxcol.com/',
        method: 'GET',
        selectors: {
          resultRows: '.tax-record',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.account',
          amountDue: '.amount',
        },
      },
    },
  },
  {
    county: 'Duval County',
    state: 'Florida',
    stateCode: 'FL',
    sources: {
      assessor: {
        url: 'https://paopropertysearch.coj.net/',
        method: 'GET',
        selectors: {
          resultRows: '.search-result',
          ownerName: '.owner-name',
          address: '.site-address',
          parcelId: '.re-number',
          assessedValue: '.just-value',
        },
      },
      treasurer: {
        url: 'https://www.coj.net/departments/finance/tax-collector',
        method: 'GET',
        selectors: {
          resultRows: '.tax-item',
          ownerName: '.owner',
          address: '.property',
          parcelId: '.account',
          amountDue: '.due',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // GEORGIA
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Fulton County',
    state: 'Georgia',
    stateCode: 'GA',
    sources: {
      assessor: {
        url: 'https://www.fultonassessor.org/property-search/',
        method: 'GET',
        selectors: {
          resultRows: '.property-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel-id',
          assessedValue: '.fair-market',
          mailingAddress: '.mailing',
        },
      },
      treasurer: {
        url: 'https://www.fultoncountytaxes.org/',
        delinquentListUrl: 'https://www.fultoncountytaxes.org/delinquent-taxes',
        method: 'GET',
        selectors: {
          resultRows: '.delinquent-row',
          ownerName: '.owner',
          address: '.property',
          parcelId: '.parcel',
          amountDue: '.balance',
        },
      },
      probate: {
        url: 'https://www.fultoncourt.org/probate/',
        method: 'GET',
        selectors: {
          caseRows: '.case-row',
          deceasedName: '.decedent',
          filingDate: '.filed',
          caseType: '.type',
        },
      },
    },
  },
  {
    county: 'DeKalb County',
    state: 'Georgia',
    stateCode: 'GA',
    sources: {
      assessor: {
        url: 'https://www.dekalbcountyga.gov/tax-assessor/property-search',
        method: 'GET',
        selectors: {
          resultRows: '.result-row',
          ownerName: '.owner-name',
          address: '.property-addr',
          parcelId: '.parcel-num',
          assessedValue: '.value',
        },
      },
      treasurer: {
        url: 'https://www.dekalbcountyga.gov/tax-commissioner',
        method: 'GET',
        selectors: {
          resultRows: '.tax-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          amountDue: '.due',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // ARIZONA
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Maricopa County',
    state: 'Arizona',
    stateCode: 'AZ',
    sources: {
      assessor: {
        url: 'https://mcassessor.maricopa.gov/mcs/',
        method: 'GET',
        selectors: {
          resultRows: '.parcel-result',
          ownerName: '.owner',
          address: '.situs',
          parcelId: '.apn',
          assessedValue: '.fcv',
          mailingAddress: '.mail-addr',
        },
      },
      treasurer: {
        url: 'https://treasurer.maricopa.gov/Parcel/',
        delinquentListUrl: 'https://treasurer.maricopa.gov/TaxLienSale/',
        method: 'GET',
        selectors: {
          resultRows: '.tax-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.apn',
          amountDue: '.amount-due',
          yearsDelinquent: '.years',
        },
      },
      recorder: {
        url: 'https://recorder.maricopa.gov/recdocdata/',
        searchTypes: ['TRUSTEE_DEED', 'NOTICE_DEFAULT', 'DEED'],
        method: 'POST',
        selectors: {
          resultRows: '.doc-row',
          documentType: '.doc-type',
          grantorGrantee: '.parties',
          recordDate: '.rec-date',
          propertyDesc: '.legal',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // OHIO
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Franklin County',
    state: 'Ohio',
    stateCode: 'OH',
    sources: {
      assessor: {
        url: 'https://www.franklincountyauditor.com/real-estate-sales',
        method: 'GET',
        selectors: {
          resultRows: '.property-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          assessedValue: '.value',
        },
      },
      treasurer: {
        url: 'https://treasurer.franklincountyohio.gov/',
        delinquentListUrl: 'https://treasurer.franklincountyohio.gov/delinquent',
        method: 'GET',
        selectors: {
          resultRows: '.delinquent-item',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          amountDue: '.due',
        },
      },
    },
  },
  {
    county: 'Cuyahoga County',
    state: 'Ohio',
    stateCode: 'OH',
    sources: {
      assessor: {
        url: 'https://fiscalofficer.cuyahogacounty.us/en-US/My-Property.aspx',
        method: 'GET',
        selectors: {
          resultRows: '.property-result',
          ownerName: '.owner-name',
          address: '.site-address',
          parcelId: '.parcel-number',
          assessedValue: '.market-value',
        },
      },
      treasurer: {
        url: 'https://fiscalofficer.cuyahogacounty.us/en-US/delinquent-tax.aspx',
        method: 'GET',
        selectors: {
          resultRows: '.tax-row',
          ownerName: '.owner',
          address: '.property',
          parcelId: '.parcel',
          amountDue: '.amount',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // INDIANA
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Marion County',
    state: 'Indiana',
    stateCode: 'IN',
    sources: {
      assessor: {
        url: 'https://maps.indy.gov/AssessorPropertyCards/',
        method: 'GET',
        selectors: {
          resultRows: '.parcel-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel-id',
          assessedValue: '.assessed',
        },
      },
      treasurer: {
        url: 'https://www.indy.gov/agency/office-of-finance',
        method: 'GET',
        selectors: {
          resultRows: '.tax-item',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          amountDue: '.due',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // TENNESSEE
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Shelby County',
    state: 'Tennessee',
    stateCode: 'TN',
    sources: {
      assessor: {
        url: 'https://assessor.shelby.tn.us/',
        method: 'GET',
        selectors: {
          resultRows: '.property-item',
          ownerName: '.owner',
          address: '.location',
          parcelId: '.parcel',
          assessedValue: '.appraised',
        },
      },
      treasurer: {
        url: 'https://www.shelbycountytrustee.com/',
        delinquentListUrl: 'https://www.shelbycountytrustee.com/delinquent-tax-sale',
        method: 'GET',
        selectors: {
          resultRows: '.tax-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          amountDue: '.amount',
        },
      },
    },
  },
  {
    county: 'Davidson County',
    state: 'Tennessee',
    stateCode: 'TN',
    sources: {
      assessor: {
        url: 'https://www.padctn.org/prc/',
        method: 'GET',
        selectors: {
          resultRows: '.property-row',
          ownerName: '.owner-name',
          address: '.property-address',
          parcelId: '.map-parcel',
          assessedValue: '.total-value',
        },
      },
      treasurer: {
        url: 'https://www.nashville.gov/departments/trustee',
        method: 'GET',
        selectors: {
          resultRows: '.tax-record',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          amountDue: '.due',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // NORTH CAROLINA
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Mecklenburg County',
    state: 'North Carolina',
    stateCode: 'NC',
    sources: {
      assessor: {
        url: 'https://property.spatialest.com/nc/mecklenburg/',
        method: 'GET',
        selectors: {
          resultRows: '.parcel-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.pid',
          assessedValue: '.value',
          mailingAddress: '.mailing',
        },
      },
      treasurer: {
        url: 'https://taxcollector.mecklenburgcountync.gov/',
        method: 'GET',
        selectors: {
          resultRows: '.tax-item',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          amountDue: '.amount',
        },
      },
    },
  },
  {
    county: 'Wake County',
    state: 'North Carolina',
    stateCode: 'NC',
    sources: {
      assessor: {
        url: 'https://services.wakegov.com/realestate/',
        method: 'GET',
        selectors: {
          resultRows: '.property-result',
          ownerName: '.owner-name',
          address: '.site-address',
          parcelId: '.pin',
          assessedValue: '.total-value',
        },
      },
      treasurer: {
        url: 'https://services.wakegov.com/tax/',
        method: 'GET',
        selectors: {
          resultRows: '.tax-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.pin',
          amountDue: '.balance',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // MISSOURI
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Jackson County',
    state: 'Missouri',
    stateCode: 'MO',
    sources: {
      assessor: {
        url: 'https://ascensiontech.jacksongov.org/taxsearch',
        method: 'GET',
        selectors: {
          resultRows: '.result-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel-id',
          assessedValue: '.value',
        },
      },
      treasurer: {
        url: 'https://www.jacksongov.org/428/Tax-Collection',
        method: 'GET',
        selectors: {
          resultRows: '.tax-record',
          ownerName: '.owner',
          address: '.property',
          parcelId: '.parcel',
          amountDue: '.due',
        },
      },
    },
  },
  {
    county: 'St. Louis County',
    state: 'Missouri',
    stateCode: 'MO',
    sources: {
      assessor: {
        url: 'https://revenue.stlouisco.com/ias/',
        method: 'GET',
        selectors: {
          resultRows: '.property-item',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.locator',
          assessedValue: '.appraised',
        },
      },
      treasurer: {
        url: 'https://revenue.stlouisco.com/collection/',
        method: 'GET',
        selectors: {
          resultRows: '.tax-item',
          ownerName: '.owner',
          address: '.property',
          parcelId: '.locator',
          amountDue: '.balance',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // MICHIGAN
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Wayne County',
    state: 'Michigan',
    stateCode: 'MI',
    sources: {
      assessor: {
        url: 'https://www.waynecounty.com/elected/register/property-search.aspx',
        method: 'GET',
        selectors: {
          resultRows: '.property-row',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel-id',
          assessedValue: '.sev',
        },
      },
      treasurer: {
        url: 'https://www.waynecounty.com/elected/treasurer/',
        delinquentListUrl: 'https://www.waynecounty.com/elected/treasurer/foreclosure.aspx',
        method: 'GET',
        selectors: {
          resultRows: '.tax-item',
          ownerName: '.owner',
          address: '.address',
          parcelId: '.parcel',
          amountDue: '.amount',
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // KENTUCKY
  // ═══════════════════════════════════════════════════════════════════
  {
    county: 'Jefferson County',
    state: 'Kentucky',
    stateCode: 'KY',
    sources: {
      assessor: {
        url: 'https://jeffersonpva.ky.gov/property-search/',
        method: 'GET',
        selectors: {
          resultRows: '.property-result',
          ownerName: '.owner-name',
          address: '.property-address',
          parcelId: '.pva-id',
          assessedValue: '.fair-cash',
          mailingAddress: '.mailing-address',
        },
      },
      treasurer: {
        url: 'https://jeffersoncountyclerk.org/taxbills/',
        delinquentListUrl: 'https://jeffersoncountyclerk.org/delinquent-tax/',
        method: 'GET',
        selectors: {
          resultRows: '.tax-row',
          ownerName: '.owner',
          address: '.property',
          parcelId: '.parcel',
          amountDue: '.due',
          yearsDelinquent: '.years',
        },
      },
      probate: {
        url: 'https://jeffersoncountyclerk.org/probate/',
        method: 'GET',
        selectors: {
          caseRows: '.case-item',
          deceasedName: '.decedent',
          filingDate: '.filed',
          caseType: '.case-type',
        },
      },
    },
  },
];

export function getConfigByCounty(county: string, state: string): CountyScraperConfig | undefined {
  return COUNTY_CONFIGS.find(
    c => c.county.toLowerCase() === county.toLowerCase() &&
         (c.state.toLowerCase() === state.toLowerCase() || c.stateCode.toLowerCase() === state.toLowerCase())
  );
}

export function getConfigsByState(state: string): CountyScraperConfig[] {
  return COUNTY_CONFIGS.filter(
    c => c.state.toLowerCase() === state.toLowerCase() || c.stateCode.toLowerCase() === state.toLowerCase()
  );
}

export function getAllConfiguredCounties(): string[] {
  return COUNTY_CONFIGS.map(c => `${c.county}, ${c.stateCode}`);
}
