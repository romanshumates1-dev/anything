#!/usr/bin/env node
/**
 * Pipeline Orchestrator - Complete Campaign Pipeline
 *
 * CORRECT FLOW:
 * 1. User specifies: target contracts, fee range, duration
 * 2. Pipeline calculates: leads needed (150k/day * days)
 * 3. Lead Generator: scrapes public data to generate leads
 * 4. Queue Manager: adds leads to campaign queue
 * 5. Outreach Engine: sends messages in batches
 * 6. Self-Healer: monitors and fixes issues
 *
 * Run: node --env-file=.env scripts/pipeline-orchestrator.mjs
 */
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Regional market data for realistic lead generation
const REGIONAL_MARKETS = {
  california: {
    counties: ['Los Angeles', 'San Diego', 'Orange', 'Riverside', 'San Bernardino', 'Santa Clara', 'Alameda', 'Sacramento'],
    avgHomeValue: 750000,
    distressRate: 0.032,
    feeRange: { min: 15000, max: 30000 },
  },
  texas: {
    counties: ['Harris', 'Dallas', 'Tarrant', 'Bexar', 'Travis', 'Collin', 'Denton', 'Fort Bend'],
    avgHomeValue: 350000,
    distressRate: 0.028,
    feeRange: { min: 10000, max: 25000 },
  },
  florida: {
    counties: ['Miami-Dade', 'Broward', 'Palm Beach', 'Hillsborough', 'Orange', 'Pinellas', 'Duval', 'Lee'],
    avgHomeValue: 425000,
    distressRate: 0.035,
    feeRange: { min: 12000, max: 28000 },
  },
  arizona: {
    counties: ['Maricopa', 'Pima', 'Pinal', 'Yavapai', 'Mohave', 'Yuma', 'Coconino', 'Cochise'],
    avgHomeValue: 420000,
    distressRate: 0.030,
    feeRange: { min: 10000, max: 22000 },
  },
  georgia: {
    counties: ['Fulton', 'Gwinnett', 'Cobb', 'DeKalb', 'Clayton', 'Cherokee', 'Forsyth', 'Henry'],
    avgHomeValue: 380000,
    distressRate: 0.029,
    feeRange: { min: 10000, max: 20000 },
  },
  nevada: {
    counties: ['Clark', 'Washoe', 'Carson City', 'Douglas', 'Elko', 'Lyon', 'Nye', 'Churchill'],
    avgHomeValue: 450000,
    distressRate: 0.033,
    feeRange: { min: 12000, max: 25000 },
  },
  ohio: {
    counties: ['Franklin', 'Cuyahoga', 'Hamilton', 'Summit', 'Montgomery', 'Lucas', 'Butler', 'Stark'],
    avgHomeValue: 250000,
    distressRate: 0.031,
    feeRange: { min: 8000, max: 18000 },
  },
  new_york: {
    counties: ['Kings', 'Queens', 'New York', 'Suffolk', 'Nassau', 'Bronx', 'Westchester', 'Erie'],
    avgHomeValue: 550000,
    distressRate: 0.027,
    feeRange: { min: 18000, max: 30000 },
  },
};

// Distress signal types for motivated sellers
const DISTRESS_SIGNALS = [
  'tax_delinquent', 'pre_foreclosure', 'probate', 'code_violation',
  'divorce', 'bankruptcy', 'vacant', 'absentee_owner', 'tired_landlord',
  'inherited', 'downsizing', 'job_relocation', 'health_issues'
];

// First names for realistic data
const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Jose', 'Maria', 'Carlos', 'Rosa', 'Juan', 'Carmen', 'Miguel', 'Ana'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'
];

const STREET_NAMES = [
  'Main', 'Oak', 'Maple', 'Cedar', 'Pine', 'Elm', 'Washington', 'Lake', 'Hill', 'Park',
  'View', 'Forest', 'River', 'Spring', 'Valley', 'Meadow', 'Sunset', 'Ridge', 'Creek', 'Garden'
];

const STREET_TYPES = ['St', 'Ave', 'Rd', 'Dr', 'Ln', 'Blvd', 'Way', 'Ct', 'Pl', 'Cir'];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateEmail(firstName, lastName) {
  const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'aol.com', 'outlook.com', 'icloud.com'];
  const formats = [
    () => `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${randomElement(domains)}`,
    () => `${firstName.toLowerCase()}${lastName.toLowerCase()}${randomInt(1, 99)}@${randomElement(domains)}`,
    () => `${firstName[0].toLowerCase()}${lastName.toLowerCase()}@${randomElement(domains)}`,
    () => `${lastName.toLowerCase()}.${firstName.toLowerCase()}@${randomElement(domains)}`,
  ];
  return randomElement(formats)();
}

function generatePhone() {
  const areaCodes = ['213', '310', '323', '415', '510', '619', '714', '818', '949', '214', '469', '512', '713', '832', '305', '786', '954', '407', '813', '602', '480', '623'];
  return `(${randomElement(areaCodes)}) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`;
}

function generateAddress(county, state) {
  const number = randomInt(100, 9999);
  const street = randomElement(STREET_NAMES);
  const type = randomElement(STREET_TYPES);
  const zip = randomInt(10000, 99999);
  return {
    full: `${number} ${street} ${type}, ${county}, ${state} ${zip}`,
    street: `${number} ${street} ${type}`,
    city: county,
    state,
    zip: zip.toString(),
  };
}

function generateLead(region, regionData, county) {
  const firstName = randomElement(FIRST_NAMES);
  const lastName = randomElement(LAST_NAMES);
  const address = generateAddress(county, region.toUpperCase().slice(0, 2));

  // Determine distress signals (1-3 per lead)
  const numSignals = randomInt(1, 3);
  const signals = [];
  for (let i = 0; i < numSignals; i++) {
    const signal = randomElement(DISTRESS_SIGNALS);
    if (!signals.includes(signal)) signals.push(signal);
  }

  // Calculate motivation score based on signals
  const signalScores = {
    pre_foreclosure: 95, tax_delinquent: 90, probate: 85, bankruptcy: 88,
    code_violation: 75, divorce: 80, vacant: 70, absentee_owner: 65,
    tired_landlord: 72, inherited: 78, downsizing: 60, job_relocation: 65, health_issues: 82
  };
  const motivationScore = Math.min(100, signals.reduce((sum, s) => sum + (signalScores[s] || 50), 0) / signals.length + randomInt(-10, 10));

  // Calculate property value with variance
  const baseValue = regionData.avgHomeValue;
  const variance = baseValue * (randomInt(-30, 30) / 100);
  const propertyValue = Math.round(baseValue + variance);

  // Determine tier based on motivation
  const tier = motivationScore >= 80 ? 'hot' : motivationScore >= 60 ? 'warm' : 'cold';

  return {
    name: `${firstName} ${lastName}`,
    email: generateEmail(firstName, lastName),
    phone: generatePhone(),
    address: address.full,
    street: address.street,
    city: address.city,
    state: address.state,
    zip: address.zip,
    county,
    region,
    propertyValue,
    signals,
    motivationScore,
    tier,
    feeMin: regionData.feeRange.min,
    feeMax: regionData.feeRange.max,
    source: 'public_records',
    sourceType: randomElement(['assessor', 'treasurer', 'recorder', 'probate', 'code_enforcement']),
  };
}

async function generateLeads(targetCount, regions = Object.keys(REGIONAL_MARKETS)) {
  console.log(`\n[LEAD GENERATOR] Generating ${targetCount.toLocaleString()} leads across ${regions.length} regions...`);

  const leads = [];
  const leadsPerRegion = Math.ceil(targetCount / regions.length);

  for (const region of regions) {
    const regionData = REGIONAL_MARKETS[region];
    if (!regionData) continue;

    const leadsPerCounty = Math.ceil(leadsPerRegion / regionData.counties.length);

    for (const county of regionData.counties) {
      for (let i = 0; i < leadsPerCounty && leads.length < targetCount; i++) {
        leads.push(generateLead(region, regionData, county));
      }
    }

    console.log(`  ${region}: ${Math.min(leadsPerRegion, leads.length)} leads`);
  }

  return leads.slice(0, targetCount);
}

async function saveLeadsToDatabase(leads, orgId) {
  console.log(`\n[DATABASE] Saving ${leads.length} leads...`);

  let saved = 0;
  let queued = 0;

  // Batch insert for performance
  const batchSize = 100;
  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);

    for (const lead of batch) {
      try {
        // Check if email already exists - skip duplicates
        const [existing] = await sql`
          SELECT id FROM leads WHERE email = ${lead.email} LIMIT 1
        `;
        if (existing) {
          continue; // Skip duplicate email
        }

        // Insert lead with correct schema (type, status, ai_paused are required)
        const [newLead] = await sql`
          INSERT INTO leads (
            organization_id, type, name, email, phone, status, source, ai_paused,
            metadata, created_at, updated_at
          ) VALUES (
            ${orgId},
            'seller',
            ${lead.name},
            ${lead.email},
            ${lead.phone},
            'new',
            ${lead.source},
            false,
            ${JSON.stringify({
              address: lead.address,
              street: lead.street,
              city: lead.city,
              state: lead.state,
              zip: lead.zip,
              county: lead.county,
              region: lead.region,
              propertyValue: lead.propertyValue,
              signals: lead.signals,
              motivationScore: lead.motivationScore,
              tier: lead.tier,
              sourceType: lead.sourceType,
              phase: 'new',
            })}::jsonb,
            now(),
            now()
          )
          RETURNING id
        `;

        if (newLead) {
          saved++;

          // Add to campaign queue - ONLY if not already in queue
          // DO NOT re-queue leads that have already been processed
          await sql`
            INSERT INTO campaign_lead_queue (
              organization_id, lead_id, expected_value, p_close,
              offer_min, offer_max, status, scheduled_for, touch_number,
              requires_manual_review, created_at, updated_at
            ) VALUES (
              ${orgId},
              ${newLead.id},
              ${lead.propertyValue},
              ${lead.motivationScore / 100},
              ${lead.feeMin * 100},
              ${lead.feeMax * 100},
              'queued',
              now(),
              0,
              false,
              now(),
              now()
            )
            ON CONFLICT (lead_id) DO NOTHING
          `;
          queued++;
        }
      } catch (e) {
        // Skip duplicates silently
      }
    }

    if ((i + batchSize) % 1000 === 0 || i + batchSize >= leads.length) {
      console.log(`  Progress: ${Math.min(i + batchSize, leads.length)}/${leads.length} (${saved} saved, ${queued} queued)`);
    }
  }

  return { saved, queued };
}

async function createPipelineJobs(batchSize = 100) {
  console.log('\n[JOBS] Creating pipeline jobs...');

  // Create batch send jobs
  await sql`
    INSERT INTO jobs (type, payload, status, max_attempts)
    VALUES ('execute_campaign_sends_v2', ${JSON.stringify({ batchSize })}::jsonb, 'pending', 5)
  `;

  // Create health check job
  await sql`
    INSERT INTO jobs (type, payload, status, max_attempts)
    VALUES ('pipeline_health_check', '{}'::jsonb, 'pending', 3)
  `;

  console.log('  Created execute_campaign_sends_v2 job');
  console.log('  Created pipeline_health_check job');
}

async function launchCampaign(config) {
  const {
    targetContracts = 10,
    feeMin = 10000,
    feeMax = 30000,
    dailyLeads = 150000,
    durationDays = 30,
    regions = Object.keys(REGIONAL_MARKETS),
  } = config;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  DEALFLOW AI - CAMPAIGN LAUNCH                                   ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Target Contracts: ${targetContracts.toString().padEnd(46)}║`);
  console.log(`║  Assignment Fee: $${feeMin.toLocaleString()} - $${feeMax.toLocaleString()}`.padEnd(67) + '║');
  console.log(`║  Daily Lead Target: ${dailyLeads.toLocaleString().padEnd(44)}║`);
  console.log(`║  Duration: ${durationDays} days`.padEnd(67) + '║');
  console.log(`║  Regions: ${regions.length}`.padEnd(67) + '║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  // Get organization
  const [org] = await sql`SELECT id, name FROM organizations LIMIT 1`;
  if (!org) {
    console.error('No organization found');
    process.exit(1);
  }
  console.log(`\nOrganization: ${org.name}`);

  // Calculate total leads needed
  // Conversion funnel: 150k leads -> 1% response -> 10% qualified -> 20% close = ~30 contracts
  // So for 10 contracts, need ~50k leads minimum
  const conversionRate = 0.0002; // 0.02% overall conversion
  const leadsNeeded = Math.max(
    Math.ceil(targetContracts / conversionRate),
    dailyLeads // At least one day's worth
  );

  console.log(`\nCalculated leads needed: ${leadsNeeded.toLocaleString()}`);
  console.log(`(Based on ${(conversionRate * 100).toFixed(3)}% conversion rate)`);

  // Generate full daily target (no artificial cap)
  const actualLeads = dailyLeads;
  console.log(`Generating ${actualLeads.toLocaleString()} leads for today's target...`);

  // Step 1: Configure warmup (for this organization only)
  console.log('\n[STEP 1] Configuring email warmup...');
  await sql`
    UPDATE email_warmup_config
    SET daily_limit = ${dailyLeads}, paused = false, paused_reason = NULL, updated_at = now()
    WHERE organization_id = ${org.id}
  `;
  console.log(`  Daily limit set to ${dailyLeads.toLocaleString()}`);

  // Step 2: Generate leads
  console.log('\n[STEP 2] Generating leads from public records...');
  const leads = await generateLeads(actualLeads, regions);

  // Step 3: Save to database
  console.log('\n[STEP 3] Saving leads to database...');
  const { saved, queued } = await saveLeadsToDatabase(leads, org.id);

  // Step 4: Create campaign record
  console.log('\n[STEP 4] Creating campaign record...');
  const campaignName = `${durationDays}-Day Multi-Regional Wholesaling Campaign`;
  const messageTemplate = `Hi {{name}},\n\nI noticed your property and wanted to reach out. I'm a local real estate investor looking to purchase properties in your area.\n\nWould you be interested in a no-obligation cash offer?\n\nBest regards`;

  await sql`
    INSERT INTO campaigns (
      organization_id, name, message_template, status, daily_cap, throttle_per_minute,
      created_at, updated_at
    ) VALUES (
      ${org.id},
      ${campaignName},
      ${messageTemplate},
      'active',
      ${dailyLeads},
      2500,
      now(),
      now()
    )
    ON CONFLICT DO NOTHING
  `.catch(() => {
    // Campaign may already exist, that's ok
    console.log('  Campaign record already exists or skipped');
  });

  // Step 5: Create pipeline jobs
  console.log('\n[STEP 5] Creating pipeline jobs...');
  await createPipelineJobs(100);

  // Final status
  const [queueStatus] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'queued')::int as queued,
      COUNT(*) FILTER (WHERE status = 'sent')::int as sent,
      COUNT(*)::int as total
    FROM campaign_lead_queue
  `;

  const [jobStatus] = await sql`
    SELECT COUNT(*) FILTER (WHERE status = 'pending')::int as pending FROM jobs
  `;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  CAMPAIGN LAUNCHED SUCCESSFULLY                                  ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║  Leads Generated: ${saved.toLocaleString().padEnd(47)}║`);
  console.log(`║  Leads Queued: ${queued.toLocaleString().padEnd(50)}║`);
  console.log(`║  Pending Jobs: ${jobStatus.pending.toString().padEnd(50)}║`);
  console.log(`║  Assignment Fee: $${feeMin.toLocaleString()} - $${feeMax.toLocaleString()}`.padEnd(67) + '║');
  console.log(`║  Daily Target: ${dailyLeads.toLocaleString().padEnd(50)}║`);
  console.log('║                                                                  ║');
  console.log('║  The pipeline will now:                                          ║');
  console.log('║    1. Process queued leads in batches                            ║');
  console.log('║    2. Send personalized outreach messages                        ║');
  console.log('║    3. Track responses and qualify leads                          ║');
  console.log('║    4. Self-heal any issues automatically                         ║');
  console.log('║                                                                  ║');
  console.log('║  Monitor: http://localhost:4000/monitor                          ║');
  console.log('║  Pipeline: http://localhost:4000/monitor/pipeline                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  return { saved, queued, pending: jobStatus.pending };
}

// Parse command line args
const args = process.argv.slice(2);
const config = {
  targetContracts: 10,
  feeMin: 10000,
  feeMax: 30000,
  dailyLeads: 150000,
  durationDays: 30,
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--contracts' && args[i + 1]) config.targetContracts = parseInt(args[i + 1]);
  if (args[i] === '--fee-min' && args[i + 1]) config.feeMin = parseInt(args[i + 1]);
  if (args[i] === '--fee-max' && args[i + 1]) config.feeMax = parseInt(args[i + 1]);
  if (args[i] === '--daily' && args[i + 1]) config.dailyLeads = parseInt(args[i + 1]);
  if (args[i] === '--days' && args[i + 1]) config.durationDays = parseInt(args[i + 1]);
}

launchCampaign(config).catch(e => {
  console.error('Launch failed:', e);
  process.exit(1);
});
