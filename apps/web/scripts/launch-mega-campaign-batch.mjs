#!/usr/bin/env node
/**
 * Mega Campaign Launcher - Batch Optimized Version
 *
 * Uses batch inserts for 10-50x faster execution.
 * Generates 150k sellers, 300 buyers across 25 markets.
 */

import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

const BATCH_SIZE = 1000;

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

const streets = ['Oak', 'Maple', 'Pine', 'Cedar', 'Elm', 'Birch', 'Willow', 'Main', 'First', 'Second', 'Third', 'Park', 'Lake', 'River', 'Mountain'];
const streetTypes = ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Ct', 'Way', 'Rd', 'Pl', 'Cir'];
const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Lisa', 'William', 'Jennifer', 'James', 'Mary', 'Richard', 'Patricia', 'Charles'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson'];

function generateLead(market, county, category, recordType, index) {
  const streetNum = 100 + (index % 9900);
  const street = streets[index % streets.length];
  const streetType = streetTypes[Math.floor(index / streets.length) % streetTypes.length];
  const firstName = firstNames[index % firstNames.length];
  const lastName = lastNames[Math.floor(index / firstNames.length) % lastNames.length];

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

async function batchInsert(leads) {
  if (leads.length === 0) return 0;

  const values = [];
  const params = [];
  let paramIndex = 1;

  for (const lead of leads) {
    values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'new', $${paramIndex++}, $${paramIndex++}::jsonb, $${paramIndex++}::jsonb)`);
    params.push(
      lead.sourceId,
      lead.category,
      lead.ownerName,
      lead.propertyAddress,
      lead.recordType,
      lead.county,
      lead.distressScore,
      JSON.stringify(lead.signals),
      JSON.stringify({ campaign: 'mega_launch', market: lead.market, generatedAt: new Date().toISOString() })
    );
  }

  const query = `
    INSERT INTO sourced_leads (
      source_id, category, owner_name, property_address,
      record_type, county, status, distress_score, signals, provenance
    ) VALUES ${values.join(', ')}
    ON CONFLICT (source_id) DO NOTHING
  `;

  try {
    const result = await pool.query(query, params);
    return result.rowCount || 0;
  } catch (err) {
    console.error('Batch insert error:', err.message);
    return 0;
  }
}

async function main() {
  const CONFIG = {
    sellerCount: 150000,
    buyerCount: 300,
  };

  console.log('\n' + '█'.repeat(70));
  console.log('MEGA CAMPAIGN LAUNCHER - BATCH MODE');
  console.log('█'.repeat(70));
  console.log(`\nConfiguration:`);
  console.log(`  Sellers: ${CONFIG.sellerCount.toLocaleString()}`);
  console.log(`  Buyers: ${CONFIG.buyerCount.toLocaleString()}`);
  console.log(`  Markets: ${TOP_WHOLESALE_MARKETS.length}`);
  console.log(`  Batch Size: ${BATCH_SIZE}`);
  console.log('\n' + '─'.repeat(70));

  const startTime = Date.now();
  const results = { sellersGenerated: 0, buyersGenerated: 0 };

  const sellersPerMarket = Math.ceil(CONFIG.sellerCount / TOP_WHOLESALE_MARKETS.length);
  const buyersPerMarket = Math.ceil(CONFIG.buyerCount / TOP_WHOLESALE_MARKETS.length);

  let globalIndex = 0;
  let batch = [];

  console.log('\n🚀 Generating seller leads...\n');

  for (const market of TOP_WHOLESALE_MARKETS) {
    const sellersPerType = Math.ceil(sellersPerMarket / SELLER_TYPES.length);

    for (const recordType of SELLER_TYPES) {
      for (let i = 0; i < sellersPerType; i++) {
        const county = market.primaryCounties[i % market.primaryCounties.length];
        const lead = generateLead(market, county, 'seller', recordType, globalIndex++);
        lead.market = market.metro;
        batch.push(lead);

        if (batch.length >= BATCH_SIZE) {
          const inserted = await batchInsert(batch);
          results.sellersGenerated += inserted;
          batch = [];

          if (results.sellersGenerated % 10000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`  Sellers: ${results.sellersGenerated.toLocaleString()} / ${CONFIG.sellerCount.toLocaleString()} (${elapsed}s)`);
          }
        }
      }
    }
  }

  // Flush remaining sellers
  if (batch.length > 0) {
    const inserted = await batchInsert(batch);
    results.sellersGenerated += inserted;
    batch = [];
  }

  console.log(`\n✅ Sellers complete: ${results.sellersGenerated.toLocaleString()}`);

  console.log('\n🚀 Generating buyer leads...\n');

  globalIndex = 0;
  for (const market of TOP_WHOLESALE_MARKETS) {
    const buyersPerType = Math.ceil(buyersPerMarket / BUYER_TYPES.length);

    for (const recordType of BUYER_TYPES) {
      for (let i = 0; i < buyersPerType; i++) {
        const county = market.primaryCounties[i % market.primaryCounties.length];
        const lead = generateLead(market, county, 'buyer', recordType, globalIndex++);
        lead.market = market.metro;
        batch.push(lead);

        if (batch.length >= BATCH_SIZE) {
          const inserted = await batchInsert(batch);
          results.buyersGenerated += inserted;
          batch = [];
        }
      }
    }
  }

  // Flush remaining buyers
  if (batch.length > 0) {
    const inserted = await batchInsert(batch);
    results.buyersGenerated += inserted;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '█'.repeat(70));
  console.log('CAMPAIGN EXECUTION COMPLETE');
  console.log('█'.repeat(70));
  console.log(`\nExecution Time: ${elapsed} seconds`);
  console.log(`\n✅ Sellers Generated: ${results.sellersGenerated.toLocaleString()}`);
  console.log(`✅ Buyers Generated: ${results.buyersGenerated.toLocaleString()}`);

  // Get actual counts from DB
  const sellerResult = await pool.query(`SELECT COUNT(*)::int as count FROM sourced_leads WHERE category = 'seller'`);
  const buyerResult = await pool.query(`SELECT COUNT(*)::int as count FROM sourced_leads WHERE category = 'buyer'`);

  console.log(`\nDatabase Totals:`);
  console.log(`  Total Sellers: ${sellerResult.rows[0].count.toLocaleString()}`);
  console.log(`  Total Buyers: ${buyerResult.rows[0].count.toLocaleString()}`);

  // Market breakdown
  const marketBreakdown = await pool.query(`
    SELECT
      split_part(county, ',', 2) as state,
      COUNT(*) FILTER (WHERE category = 'seller') as sellers,
      COUNT(*) FILTER (WHERE category = 'buyer') as buyers
    FROM sourced_leads
    WHERE provenance->>'campaign' = 'mega_launch'
    GROUP BY split_part(county, ',', 2)
    ORDER BY sellers DESC
    LIMIT 10
  `);

  console.log('\nTop 10 States by Lead Count:');
  for (const row of marketBreakdown.rows) {
    console.log(`  ${row.state.trim()}: ${parseInt(row.sellers).toLocaleString()} sellers, ${parseInt(row.buyers).toLocaleString()} buyers`);
  }

  console.log('\n📋 Next Steps:');
  console.log('  1. GET /api/lead-finder/sourced-leads - View generated leads');
  console.log('  2. POST /api/lead-finder/create-campaign - Hand off to outreach');
  console.log('  3. POST /api/campaigns/outreach - Start messaging');

  await pool.end();
}

main().catch(err => {
  console.error('Campaign error:', err);
  process.exit(1);
});
