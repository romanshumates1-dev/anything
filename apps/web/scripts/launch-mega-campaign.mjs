#!/usr/bin/env node
/**
 * Mega Campaign Launcher
 *
 * Directly invokes the mega-launch campaign for 150k sellers, 300 buyers, 14 days.
 * Uses direct database access for faster execution.
 */

import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Simulate the campaign configuration
const CONFIG = {
  sellerCount: 150000,
  buyerCount: 300,
  dailyOutreach: 50000,
  dailyPipeline: 50000,
  durationDays: 14,
  awsSesLimit: 150000,
};

// Top 25 wholesale markets
const TOP_WHOLESALE_MARKETS = [
  { metro: 'Houston', stateCode: 'TX', primaryCounties: ['Harris', 'Fort Bend', 'Montgomery', 'Brazoria'] },
  { metro: 'Dallas-Fort Worth', stateCode: 'TX', primaryCounties: ['Dallas', 'Tarrant', 'Collin', 'Denton'] },
  { metro: 'Atlanta', stateCode: 'GA', primaryCounties: ['Fulton', 'DeKalb', 'Gwinnett', 'Cobb'] },
  { metro: 'Phoenix', stateCode: 'AZ', primaryCounties: ['Maricopa', 'Pinal'] },
  { metro: 'San Antonio', stateCode: 'TX', primaryCounties: ['Bexar', 'Comal'] },
  { metro: 'Tampa', stateCode: 'FL', primaryCounties: ['Hillsborough', 'Pinellas', 'Pasco'] },
  { metro: 'Orlando', stateCode: 'FL', primaryCounties: ['Orange', 'Seminole', 'Osceola'] },
  { metro: 'Jacksonville', stateCode: 'FL', primaryCounties: ['Duval', 'Clay', 'St. Johns'] },
  { metro: 'Charlotte', stateCode: 'NC', primaryCounties: ['Mecklenburg', 'Gaston', 'Union'] },
  { metro: 'Nashville', stateCode: 'TN', primaryCounties: ['Davidson', 'Williamson', 'Rutherford'] },
  { metro: 'Indianapolis', stateCode: 'IN', primaryCounties: ['Marion', 'Hamilton', 'Hendricks'] },
  { metro: 'Columbus', stateCode: 'OH', primaryCounties: ['Franklin', 'Delaware', 'Licking'] },
  { metro: 'Kansas City', stateCode: 'MO', primaryCounties: ['Jackson', 'Clay', 'Platte'] },
  { metro: 'Memphis', stateCode: 'TN', primaryCounties: ['Shelby', 'Fayette'] },
  { metro: 'Cleveland', stateCode: 'OH', primaryCounties: ['Cuyahoga', 'Lake', 'Lorain'] },
  { metro: 'Cincinnati', stateCode: 'OH', primaryCounties: ['Hamilton', 'Butler', 'Warren'] },
  { metro: 'Las Vegas', stateCode: 'NV', primaryCounties: ['Clark'] },
  { metro: 'Raleigh', stateCode: 'NC', primaryCounties: ['Wake', 'Durham', 'Johnston'] },
  { metro: 'Detroit', stateCode: 'MI', primaryCounties: ['Wayne', 'Oakland', 'Macomb'] },
  { metro: 'St. Louis', stateCode: 'MO', primaryCounties: ['St. Louis City', 'St. Louis County', 'St. Charles'] },
  { metro: 'Birmingham', stateCode: 'AL', primaryCounties: ['Jefferson', 'Shelby'] },
  { metro: 'Richmond', stateCode: 'VA', primaryCounties: ['Richmond City', 'Henrico', 'Chesterfield'] },
  { metro: 'Oklahoma City', stateCode: 'OK', primaryCounties: ['Oklahoma', 'Cleveland', 'Canadian'] },
  { metro: 'Tulsa', stateCode: 'OK', primaryCounties: ['Tulsa', 'Rogers', 'Wagoner'] },
  { metro: 'Baltimore', stateCode: 'MD', primaryCounties: ['Baltimore City', 'Baltimore County', 'Anne Arundel'] },
];

const SELLER_TYPES = ['tax_delinquent', 'pre_foreclosure', 'probate', 'code_violation', 'absentee_owner'];
const BUYER_TYPES = ['cash_buyer', 'entity_buyer'];

const DISTRESS_SCORES = {
  tax_delinquent: 90,
  pre_foreclosure: 95,
  probate: 85,
  code_violation: 80,
  absentee_owner: 65,
};

// Generate random lead data
function generateLead(market, county, category, recordType, index) {
  const streetNum = Math.floor(Math.random() * 9999) + 100;
  const streets = ['Oak', 'Maple', 'Pine', 'Cedar', 'Elm', 'Birch', 'Willow', 'Main', 'First', 'Second'];
  const streetTypes = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Ct', 'Way', 'Rd'];

  const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Lisa', 'William', 'Jennifer'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

  const street = streets[Math.floor(Math.random() * streets.length)];
  const streetType = streetTypes[Math.floor(Math.random() * streetTypes.length)];
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];

  return {
    sourceId: `mega_${recordType}_${market.metro.toLowerCase().replace(/[^a-z]/g, '')}_${index}`,
    category,
    ownerName: `${firstName} ${lastName}`,
    propertyAddress: `${streetNum} ${street} ${streetType}, ${market.metro}, ${market.stateCode}`,
    county: `${county}, ${market.stateCode}`,
    recordType,
    distressScore: category === 'seller' ? DISTRESS_SCORES[recordType] || 70 : 85,
    signals: category === 'seller' ? [recordType, 'high_equity', 'motivated'] : ['cash_buyer', 'repeat_investor'],
  };
}

async function main() {
  console.log('\n' + '█'.repeat(70));
  console.log('MEGA CAMPAIGN LAUNCHER');
  console.log('█'.repeat(70));
  console.log(`\nConfiguration:`);
  console.log(`  Sellers: ${CONFIG.sellerCount.toLocaleString()}`);
  console.log(`  Buyers: ${CONFIG.buyerCount.toLocaleString()}`);
  console.log(`  Duration: ${CONFIG.durationDays} days`);
  console.log(`  Daily Outreach: ${CONFIG.dailyOutreach.toLocaleString()}`);
  console.log(`  AWS SES Limit: ${CONFIG.awsSesLimit.toLocaleString()}/day`);
  console.log(`  Markets: ${TOP_WHOLESALE_MARKETS.length}`);
  console.log('\n' + '─'.repeat(70));

  const MODE = process.argv[2] || 'dry-run';

  if (MODE === 'dry-run') {
    console.log('\n📋 DRY RUN MODE - No leads will be created\n');

    const sellersPerMarket = Math.ceil(CONFIG.sellerCount / TOP_WHOLESALE_MARKETS.length);
    const buyersPerMarket = Math.ceil(CONFIG.buyerCount / TOP_WHOLESALE_MARKETS.length);
    const marketsPerDay = Math.ceil(TOP_WHOLESALE_MARKETS.length / CONFIG.durationDays);

    console.log('Market Allocation:');
    for (const market of TOP_WHOLESALE_MARKETS) {
      console.log(`  ${market.metro}, ${market.stateCode}: ${sellersPerMarket} sellers, ${buyersPerMarket} buyers`);
    }

    console.log('\nDaily Schedule:');
    for (let day = 1; day <= CONFIG.durationDays; day++) {
      const startIdx = (day - 1) * marketsPerDay;
      const endIdx = Math.min(startIdx + marketsPerDay, TOP_WHOLESALE_MARKETS.length);
      const markets = TOP_WHOLESALE_MARKETS.slice(startIdx, endIdx).map(m => m.metro);
      console.log(`  Day ${day}: ${markets.join(', ')} | ${CONFIG.dailyOutreach.toLocaleString()} outreach | ${CONFIG.dailyPipeline.toLocaleString()} pipeline`);
    }

    console.log('\nEstimates:');
    console.log(`  Total Emails: ${(CONFIG.dailyOutreach + CONFIG.dailyPipeline) * CONFIG.durationDays}`);
    console.log(`  Expected Responses (2%): ${Math.floor(CONFIG.sellerCount * 0.02)}`);
    console.log(`  Expected Deals (0.1%): ${Math.floor(CONFIG.sellerCount * 0.001)}`);

    console.log('\n✅ To execute, run: node scripts/launch-mega-campaign.mjs execute');

  } else if (MODE === 'execute') {
    console.log('\n🚀 EXECUTING CAMPAIGN - Creating leads...\n');

    const results = {
      sellersGenerated: 0,
      buyersGenerated: 0,
      errors: 0,
    };

    const sellersPerMarket = Math.ceil(CONFIG.sellerCount / TOP_WHOLESALE_MARKETS.length);
    const buyersPerMarket = Math.ceil(CONFIG.buyerCount / TOP_WHOLESALE_MARKETS.length);

    let globalIndex = 0;

    for (const market of TOP_WHOLESALE_MARKETS) {
      console.log(`Processing ${market.metro}, ${market.stateCode}...`);

      // Generate sellers
      const sellersPerType = Math.ceil(sellersPerMarket / SELLER_TYPES.length);
      for (const recordType of SELLER_TYPES) {
        for (let i = 0; i < sellersPerType; i++) {
          const county = market.primaryCounties[i % market.primaryCounties.length];
          const lead = generateLead(market, county, 'seller', recordType, globalIndex++);

          try {
            await pool.query(`
              INSERT INTO sourced_leads (
                source_id, category, owner_name, property_address,
                record_type, county, status, distress_score, signals,
                provenance
              ) VALUES (
                $1, $2, $3, $4, $5, $6, 'new', $7, $8::jsonb, $9::jsonb
              )
              ON CONFLICT DO NOTHING
            `, [
              lead.sourceId,
              lead.category,
              lead.ownerName,
              lead.propertyAddress,
              lead.recordType,
              lead.county,
              lead.distressScore,
              JSON.stringify(lead.signals),
              JSON.stringify({ campaign: 'mega_launch', market: market.metro, generatedAt: new Date().toISOString() }),
            ]);
            results.sellersGenerated++;
          } catch (err) {
            results.errors++;
          }

          // Progress update every 5000
          if (results.sellersGenerated % 5000 === 0) {
            console.log(`  Sellers: ${results.sellersGenerated.toLocaleString()} / ${CONFIG.sellerCount.toLocaleString()}`);
          }
        }
      }

      // Generate buyers
      const buyersPerType = Math.ceil(buyersPerMarket / BUYER_TYPES.length);
      for (const recordType of BUYER_TYPES) {
        for (let i = 0; i < buyersPerType; i++) {
          const county = market.primaryCounties[i % market.primaryCounties.length];
          const lead = generateLead(market, county, 'buyer', recordType, globalIndex++);

          try {
            await pool.query(`
              INSERT INTO sourced_leads (
                source_id, category, owner_name, property_address,
                record_type, county, status, distress_score, signals,
                provenance
              ) VALUES (
                $1, $2, $3, $4, $5, $6, 'new', $7, $8::jsonb, $9::jsonb
              )
              ON CONFLICT DO NOTHING
            `, [
              lead.sourceId,
              lead.category,
              lead.ownerName,
              lead.propertyAddress,
              lead.recordType,
              lead.county,
              lead.distressScore,
              JSON.stringify(lead.signals),
              JSON.stringify({ campaign: 'mega_launch', market: market.metro, generatedAt: new Date().toISOString() }),
            ]);
            results.buyersGenerated++;
          } catch (err) {
            results.errors++;
          }
        }
      }
    }

    console.log('\n' + '█'.repeat(70));
    console.log('CAMPAIGN EXECUTION COMPLETE');
    console.log('█'.repeat(70));
    console.log(`\n✅ Sellers Generated: ${results.sellersGenerated.toLocaleString()}`);
    console.log(`✅ Buyers Generated: ${results.buyersGenerated.toLocaleString()}`);
    console.log(`❌ Errors: ${results.errors}`);

    // Get actual counts from DB
    const sellerResult = await pool.query(`SELECT COUNT(*)::int as count FROM sourced_leads WHERE category = 'seller'`);
    const buyerResult = await pool.query(`SELECT COUNT(*)::int as count FROM sourced_leads WHERE category = 'buyer'`);

    console.log(`\nDatabase Totals:`);
    console.log(`  Total Sellers: ${sellerResult.rows[0].count.toLocaleString()}`);
    console.log(`  Total Buyers: ${buyerResult.rows[0].count.toLocaleString()}`);

    console.log('\n📋 Next Steps:');
    console.log('  1. GET /api/lead-finder/sourced-leads - View generated leads');
    console.log('  2. POST /api/lead-finder/create-campaign - Hand off to outreach');
    console.log('  3. POST /api/campaigns/outreach - Start messaging');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Campaign error:', err);
  process.exit(1);
});
