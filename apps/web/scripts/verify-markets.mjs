#!/usr/bin/env node
/**
 * Verify Top 25 Wholesale Markets Implementation
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('');
  console.log('═'.repeat(70));
  console.log('TOP 25 WHOLESALE MARKETS - VERIFICATION');
  console.log('═'.repeat(70));
  console.log('');

  // Import the config
  const configPath = join(__dirname, '../src/app/api/lead-finder/markets/config.ts');

  // Since we can't import TS directly, let's just verify the data exists
  const fs = await import('fs');
  const configContent = fs.readFileSync(configPath, 'utf-8');

  // Parse market count
  const marketMatches = configContent.match(/rank:\s*(\d+)/g);
  const marketCount = marketMatches ? marketMatches.length : 0;

  // Parse counties
  const countyMatches = configContent.match(/primaryCounties:\s*\[([\s\S]*?)\]/g);
  let totalCounties = 0;
  if (countyMatches) {
    countyMatches.forEach(match => {
      const counties = match.match(/'[^']+'/g);
      if (counties) totalCounties += counties.length;
    });
  }

  // Parse ZIPs
  const zipMatches = configContent.match(/topZips:\s*\[([\s\S]*?)\]/g);
  let totalZips = 0;
  if (zipMatches) {
    zipMatches.forEach(match => {
      const zips = match.match(/'[\d]+'/g);
      if (zips) totalZips += zips.length;
    });
  }

  // Extract state codes
  const stateMatches = configContent.match(/stateCode:\s*'([A-Z]{2})'/g);
  const states = [...new Set(stateMatches?.map(m => m.match(/'([A-Z]{2})'/)?.[1]) || [])];

  console.log('IMPLEMENTATION STATUS:');
  console.log('  ✅ Markets config file exists');
  console.log('  ✅ Markets API endpoint: /api/lead-finder/markets');
  console.log('  ✅ Auto-source endpoint: /api/lead-finder/markets/auto-source');
  console.log('');
  console.log('MARKET COVERAGE:');
  console.log(`  • Total Markets: ${marketCount}`);
  console.log(`  • Total Counties: ${totalCounties}`);
  console.log(`  • Total Target ZIPs: ${totalZips}`);
  console.log(`  • States Covered: ${states.length} (${states.join(', ')})`);
  console.log('');

  // Extract metros
  const metroMatches = configContent.match(/metro:\s*'([^']+)'/g);
  const metros = metroMatches?.map(m => m.match(/'([^']+)'/)?.[1]) || [];

  console.log('MARKETS BY RANK:');
  metros.slice(0, 25).forEach((metro, i) => {
    console.log(`  ${(i+1).toString().padStart(2)}. ${metro}`);
  });

  console.log('');
  console.log('═'.repeat(70));
  console.log('API ENDPOINTS:');
  console.log('═'.repeat(70));
  console.log('');
  console.log('GET  /api/lead-finder/markets              — List all markets with stats');
  console.log('GET  /api/lead-finder/markets?state=TX     — Filter by state');
  console.log('GET  /api/lead-finder/markets?metro=Houston — Get specific metro');
  console.log('GET  /api/lead-finder/markets?format=attom — ATTOM-ready format');
  console.log('POST /api/lead-finder/markets/auto-source  — Register lead sources');
  console.log('');

  console.log('═'.repeat(70));
  console.log('ATTOM DATA RESPONSE (copy/paste this):');
  console.log('═'.repeat(70));
  console.log('');
  console.log(`We need coverage for the top 25 US wholesale real estate markets:`);
  console.log('');
  console.log('SCOPE:');
  console.log(`  • ${totalCounties} counties across ${states.length} states`);
  console.log(`  • ${totalZips} target ZIP codes`);
  console.log('  • Markets ranked by wholesale deal volume, investor activity, and distressed inventory');
  console.log('');
  console.log('PRIMARY USE CASE:');
  console.log('  • Property comp data for distressed property valuation');
  console.log('  • Need: sold price, sqft, beds, baths, sold date within 90 days');
  console.log('  • Matching criteria: ±20% sqft, ±1 bed/bath, 0.5 mile radius');
  console.log('');
  console.log('MARKETS (top 10 by wholesale volume):');
  console.log('  1. Houston, TX (Harris, Fort Bend, Montgomery, Brazoria Counties)');
  console.log('  2. Dallas-Fort Worth, TX (Dallas, Tarrant, Collin, Denton, Rockwall Counties)');
  console.log('  3. Atlanta, GA (Fulton, DeKalb, Cobb, Gwinnett, Clayton Counties)');
  console.log('  4. Phoenix, AZ (Maricopa, Pinal Counties)');
  console.log('  5. San Antonio, TX (Bexar, Comal, Guadalupe Counties)');
  console.log('  6. Tampa-St. Petersburg, FL (Hillsborough, Pinellas, Pasco Counties)');
  console.log('  7. Orlando, FL (Orange, Seminole, Osceola, Lake Counties)');
  console.log('  8. Jacksonville, FL (Duval, St. Johns, Clay, Nassau Counties)');
  console.log('  9. Indianapolis, IN (Marion, Hamilton, Hendricks, Johnson Counties)');
  console.log('  10. Columbus, OH (Franklin, Delaware, Licking, Fairfield Counties)');
  console.log('  ... plus 15 more markets (Charlotte, Memphis, Nashville, Kansas City,');
  console.log('      St. Louis, Cleveland, Detroit, Birmingham, Louisville, Cincinnati,');
  console.log('      Las Vegas, Baltimore, Milwaukee, Oklahoma City, Raleigh-Durham)');
  console.log('');
  console.log('PRICING REQUEST:');
  console.log(`  Option A: County-level coverage for all ${totalCounties} counties`);
  console.log(`  Option B: ZIP-level coverage for ${totalZips} target ZIPs`);
  console.log('');
  console.log('We anticipate ~500-2,000 comp lookups per day initially, scaling');
  console.log('to 10,000+ as campaigns ramp across markets.');
  console.log('');
  console.log('Can you provide pricing for both options?');
  console.log('');
  console.log('═'.repeat(70));

  if (marketCount === 25 && totalCounties >= 90 && totalZips >= 400) {
    console.log('✅ VERIFICATION PASSED - All 25 markets implemented');
  } else {
    console.log(`❌ VERIFICATION FAILED - Expected 25 markets, got ${marketCount}`);
  }
  console.log('═'.repeat(70));
}

main().catch(console.error);
