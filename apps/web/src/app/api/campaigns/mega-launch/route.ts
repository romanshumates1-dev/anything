/**
 * Mega Campaign Launcher
 *
 * 2-week campaign across all 25 markets:
 * - 150,000 seller leads
 * - 300 buyer leads (network)
 * - 50k/day outreach (1-2 markets)
 * - 50k/day pipeline (negotiation + buyer outreach)
 * - AWS SES 150k/day capacity
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { getOrganization } from '@/lib/organization-context';
import { TOP_WHOLESALE_MARKETS } from '../../lead-finder/markets/config';
import { simulateBySourceType } from '../../lead-finder/scraper/simulator';
import { COUNTY_CONFIGS } from '../../lead-finder/scraper/county-configs';

interface MegaLaunchRequest {
  sellerCount?: number;
  buyerCount?: number;
  dailyOutreach?: number;
  dailyPipeline?: number;
  durationDays?: number;
  markets?: string[];
  awsSesLimit?: number;
  dryRun?: boolean;
}

interface MarketAllocation {
  market: string;
  state: string;
  counties: string[];
  sellerLeads: number;
  buyerLeads: number;
  dailyOutreach: number;
  startDay: number;
  endDay: number;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: MegaLaunchRequest;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const {
    sellerCount = 150000,
    buyerCount = 300,
    dailyOutreach = 50000,
    dailyPipeline = 50000,
    durationDays = 14,
    markets: targetMarkets,
    awsSesLimit = 150000,
    dryRun = false,
  } = body;

  // Select markets
  let selectedMarkets = TOP_WHOLESALE_MARKETS;
  if (targetMarkets && targetMarkets.length > 0) {
    selectedMarkets = TOP_WHOLESALE_MARKETS.filter(m =>
      targetMarkets.some(t => m.metro.toLowerCase().includes(t.toLowerCase()))
    );
  }

  // Calculate per-market allocation
  const totalMarkets = selectedMarkets.length;
  const sellersPerMarket = Math.ceil(sellerCount / totalMarkets);
  const buyersPerMarket = Math.ceil(buyerCount / totalMarkets);
  const marketsPerDay = Math.ceil(totalMarkets / durationDays);

  // Create market schedule
  const marketAllocations: MarketAllocation[] = [];
  let currentDay = 1;

  for (let i = 0; i < selectedMarkets.length; i++) {
    const market = selectedMarkets[i];
    const startDay = currentDay;
    const endDay = Math.min(currentDay + Math.ceil(durationDays / marketsPerDay), durationDays);

    marketAllocations.push({
      market: market.metro,
      state: market.stateCode,
      counties: market.primaryCounties,
      sellerLeads: sellersPerMarket,
      buyerLeads: buyersPerMarket,
      dailyOutreach: Math.ceil(dailyOutreach / marketsPerDay),
      startDay,
      endDay,
    });

    if ((i + 1) % marketsPerDay === 0) {
      currentDay++;
    }
  }

  // Calculate daily breakdown
  const dailySchedule = [];
  for (let day = 1; day <= durationDays; day++) {
    const marketsForDay = marketAllocations.filter(m => m.startDay <= day && m.endDay >= day);
    const outreachForDay = Math.min(dailyOutreach, awsSesLimit / 2);
    const pipelineForDay = Math.min(dailyPipeline, awsSesLimit / 2);

    dailySchedule.push({
      day,
      date: new Date(Date.now() + (day - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      markets: marketsForDay.map(m => m.market),
      newOutreach: outreachForDay,
      pipelineMessages: pipelineForDay,
      totalEmails: outreachForDay + pipelineForDay,
      withinSesLimit: (outreachForDay + pipelineForDay) <= awsSesLimit,
    });
  }

  if (dryRun) {
    return Response.json({
      dryRun: true,
      campaign: {
        duration: `${durationDays} days`,
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
      leads: {
        sellers: {
          total: sellerCount,
          perMarket: sellersPerMarket,
          sources: ['tax_delinquent', 'pre_foreclosure', 'probate', 'code_violation', 'absentee_owner'],
        },
        buyers: {
          total: buyerCount,
          perMarket: buyersPerMarket,
          sources: ['cash_buyer', 'entity_buyer'],
        },
      },
      outreach: {
        dailyNewOutreach: dailyOutreach,
        dailyPipeline: dailyPipeline,
        totalDaily: dailyOutreach + dailyPipeline,
        awsSesLimit,
        withinLimit: (dailyOutreach + dailyPipeline) <= awsSesLimit,
      },
      markets: {
        total: selectedMarkets.length,
        marketsPerDay,
        allocations: marketAllocations,
      },
      schedule: dailySchedule,
      estimates: {
        totalEmails: dailySchedule.reduce((s, d) => s + d.totalEmails, 0),
        totalSms: Math.floor(sellerCount * 0.3), // 30% have phones
        expectedResponses: Math.floor(sellerCount * 0.02), // 2% response rate
        expectedDeals: Math.floor(sellerCount * 0.001), // 0.1% close rate
      },
    });
  }

  // EXECUTE THE LAUNCH
  const MAX_ERRORS = 100; // Prevent unbounded growth
  const results = {
    sellersGenerated: 0,
    buyersGenerated: 0,
    campaignsCreated: 0,
    errors: [] as string[],
    errorCount: 0, // Track total even when array is capped
  };

  console.log(`[MEGA-LAUNCH] Starting campaign: ${sellerCount} sellers, ${buyerCount} buyers, ${durationDays} days`);

  // Generate leads for each market
  for (const allocation of marketAllocations) {
    try {
      console.log(`[MEGA-LAUNCH] Processing ${allocation.market}, ${allocation.state}`);

      // Find county config
      const countyConfigs = COUNTY_CONFIGS.filter(c => c.stateCode === allocation.state);

      if (countyConfigs.length === 0) {
        // Create a minimal config
        const config = {
          county: allocation.counties[0] || `${allocation.market} County`,
          state: allocation.market,
          stateCode: allocation.state,
          sources: {},
        };

        // Generate seller leads
        const sellerTypes = ['tax_delinquent', 'pre_foreclosure', 'probate', 'code_violation', 'absentee_owner'];
        const leadsPerType = Math.ceil(allocation.sellerLeads / sellerTypes.length);

        for (const sourceType of sellerTypes) {
          const result = simulateBySourceType(config as any, sourceType, leadsPerType);

          for (const lead of result.leads) {
            try {
              await sql`
                INSERT INTO sourced_leads (
                  source_id, category, owner_name, property_address, mailing_address,
                  parcel_id, record_type, county, assessed_value_cents, signals,
                  provenance, status, distress_score
                ) VALUES (
                  ${'mega_' + sourceType},
                  'seller',
                  ${lead.ownerName},
                  ${lead.propertyAddress},
                  ${lead.mailingAddress || null},
                  ${lead.parcelId || null},
                  ${lead.recordType},
                  ${lead.county + ', ' + lead.state},
                  ${lead.assessedValue ? Math.round(lead.assessedValue * 100) : null},
                  ${JSON.stringify(lead.signals)},
                  ${JSON.stringify({
                    campaign: 'mega_launch',
                    market: allocation.market,
                    allocation: allocation,
                    generatedAt: new Date().toISOString(),
                  })},
                  'new',
                  ${getDistressScore(sourceType)}
                )
                ON CONFLICT DO NOTHING
              `;
              results.sellersGenerated++;
            } catch (err: any) {
              if (!err.message?.includes('duplicate')) {
                results.errorCount++;
              if (results.errors.length < MAX_ERRORS) {
                results.errors.push(`Seller save: ${err.message}`);
              }
              }
            }
          }
        }

        // Generate buyer leads
        const buyerTypes = ['cash_buyer', 'entity_buyer'];
        const buyersPerType = Math.ceil(allocation.buyerLeads / buyerTypes.length);

        for (const sourceType of buyerTypes) {
          const result = simulateBySourceType(config as any, sourceType, buyersPerType);

          for (const lead of result.leads) {
            try {
              await sql`
                INSERT INTO sourced_leads (
                  source_id, category, owner_name, property_address, mailing_address,
                  parcel_id, record_type, county, assessed_value_cents, signals,
                  provenance, status, distress_score
                ) VALUES (
                  ${'mega_' + sourceType},
                  'buyer',
                  ${lead.ownerName},
                  ${lead.propertyAddress},
                  ${lead.mailingAddress || null},
                  ${lead.parcelId || null},
                  ${lead.recordType},
                  ${lead.county + ', ' + lead.state},
                  ${lead.assessedValue ? Math.round(lead.assessedValue * 100) : null},
                  ${JSON.stringify(lead.signals)},
                  ${JSON.stringify({
                    campaign: 'mega_launch',
                    market: allocation.market,
                    allocation: allocation,
                    generatedAt: new Date().toISOString(),
                  })},
                  'new',
                  ${85}
                )
                ON CONFLICT DO NOTHING
              `;
              results.buyersGenerated++;
            } catch (err: any) {
              if (!err.message?.includes('duplicate')) {
                results.errorCount++;
              if (results.errors.length < MAX_ERRORS) {
                results.errors.push(`Buyer save: ${err.message}`);
              }
              }
            }
          }
        }

      } else {
        // Use existing configs
        for (const config of countyConfigs) {
          const sellerTypes = ['tax_delinquent', 'pre_foreclosure', 'probate'];
          const leadsPerType = Math.ceil(allocation.sellerLeads / countyConfigs.length / sellerTypes.length);

          for (const sourceType of sellerTypes) {
            const result = simulateBySourceType(config, sourceType, leadsPerType);

            for (const lead of result.leads) {
              try {
                await sql`
                  INSERT INTO sourced_leads (
                    source_id, category, owner_name, property_address, mailing_address,
                    parcel_id, record_type, county, assessed_value_cents, signals,
                    provenance, status, distress_score
                  ) VALUES (
                    ${'mega_' + sourceType},
                    'seller',
                    ${lead.ownerName},
                    ${lead.propertyAddress},
                    ${lead.mailingAddress || null},
                    ${lead.parcelId || null},
                    ${lead.recordType},
                    ${lead.county + ', ' + lead.state},
                    ${lead.assessedValue ? Math.round(lead.assessedValue * 100) : null},
                    ${JSON.stringify(lead.signals)},
                    ${JSON.stringify({
                      campaign: 'mega_launch',
                      market: allocation.market,
                    })},
                    'new',
                    ${getDistressScore(sourceType)}
                  )
                  ON CONFLICT DO NOTHING
                `;
                results.sellersGenerated++;
              } catch (err: any) {
                if (!err.message?.includes('duplicate')) {
                  results.errorCount++;
                  if (results.errors.length < MAX_ERRORS) {
                    results.errors.push(err.message);
                  }
                }
              }
            }
          }
        }
      }

      results.campaignsCreated++;

    } catch (err: any) {
      results.errorCount++;
      if (results.errors.length < MAX_ERRORS) {
        results.errors.push(`Market ${allocation.market}: ${err.message}`);
      }
    }

    // Log progress every 5 markets
    if (results.campaignsCreated % 5 === 0) {
      console.log(`[MEGA-LAUNCH] Progress: ${results.campaignsCreated}/${marketAllocations.length} markets, ${results.sellersGenerated} sellers, ${results.buyersGenerated} buyers`);
    }
  }

  await logEvent(
    'mega_campaign_launch',
    'campaign',
    'mega',
    {
      sellerCount,
      buyerCount,
      dailyOutreach,
      durationDays,
      markets: selectedMarkets.length,
      sellersGenerated: results.sellersGenerated,
      buyersGenerated: results.buyersGenerated,
    },
    admin.userId
  );

  return Response.json({
    success: true,
    campaign: {
      id: `mega_${Date.now()}`,
      duration: `${durationDays} days`,
      startDate: new Date().toISOString(),
    },
    results: {
      sellersGenerated: results.sellersGenerated,
      buyersGenerated: results.buyersGenerated,
      marketsProcessed: results.campaignsCreated,
      errors: results.errors.length,
    },
    schedule: {
      dailyOutreach,
      dailyPipeline,
      awsSesLimit,
      marketsPerDay,
    },
    next: {
      step1: 'GET /api/lead-finder/sourced-leads - View generated leads',
      step2: 'POST /api/lead-finder/create-campaign - Hand off to outreach',
      step3: 'POST /api/campaigns/outreach - Start messaging',
    },
  });
}

function getDistressScore(sourceType: string): number {
  const scores: Record<string, number> = {
    tax_delinquent: 90,
    pre_foreclosure: 95,
    probate: 85,
    code_violation: 80,
    absentee_owner: 65,
    vacant: 75,
    high_equity: 55,
  };
  return scores[sourceType] || 50;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    // Get current inventory
    const [sellerCount] = await sql`
      SELECT COUNT(*)::int as count FROM sourced_leads WHERE category = 'seller' AND status = 'new'
    `;
    const [buyerCount] = await sql`
      SELECT COUNT(*)::int as count FROM sourced_leads WHERE category = 'buyer' AND status = 'new'
    `;
    const [handedOff] = await sql`
      SELECT COUNT(*)::int as count FROM sourced_leads WHERE status = 'handed_off'
    `;

    return Response.json({
      description: 'Mega Campaign Launcher - 2 Week Multi-Market Campaign',
      inventory: {
        sellers: sellerCount?.count || 0,
        buyers: buyerCount?.count || 0,
        handedOff: handedOff?.count || 0,
      },
      capacity: {
        awsSes: '150,000/day',
        dailyOutreach: '50,000 new contacts',
        dailyPipeline: '50,000 follow-ups',
      },
      markets: TOP_WHOLESALE_MARKETS.length,
      usage: {
        endpoint: 'POST /api/campaigns/mega-launch',
        example: {
          sellerCount: 150000,
          buyerCount: 300,
          dailyOutreach: 50000,
          dailyPipeline: 50000,
          durationDays: 14,
          awsSesLimit: 150000,
          dryRun: true,
        },
      },
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
