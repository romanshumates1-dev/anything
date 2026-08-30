/**
 * Auto-Source Leads from Top Wholesale Markets
 *
 * POST /api/lead-finder/markets/auto-source
 *
 * Automatically registers lead sources for top wholesale markets and
 * queues them for data fetching. This integrates with ATTOM/PropStream
 * APIs when configured.
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { TOP_WHOLESALE_MARKETS, type WholesaleMarket } from '../config';

interface AutoSourceRequest {
  markets?: string[];
  states?: string[];
  topN?: number;
  recordTypes?: string[];
  dryRun?: boolean;
}

const DEFAULT_RECORD_TYPES = [
  'tax_delinquent',
  'pre_foreclosure',
  'probate',
  'code_violation',
  'vacant',
  'absentee_owner',
  'high_equity',
];

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  let body: AutoSourceRequest;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const {
    markets: targetMetros,
    states: targetStates,
    topN,
    recordTypes = DEFAULT_RECORD_TYPES,
    dryRun = false,
  } = body;

  let selectedMarkets: WholesaleMarket[] = [];

  if (targetMetros && targetMetros.length > 0) {
    selectedMarkets = TOP_WHOLESALE_MARKETS.filter(m =>
      targetMetros.some(t => m.metro.toLowerCase().includes(t.toLowerCase()))
    );
  } else if (targetStates && targetStates.length > 0) {
    selectedMarkets = TOP_WHOLESALE_MARKETS.filter(m =>
      targetStates.includes(m.stateCode)
    );
  } else if (topN && topN > 0) {
    selectedMarkets = TOP_WHOLESALE_MARKETS.slice(0, Math.min(topN, 25));
  } else {
    selectedMarkets = TOP_WHOLESALE_MARKETS;
  }

  if (selectedMarkets.length === 0) {
    return Response.json({ error: 'No markets matched criteria' }, { status: 400 });
  }

  const sourcesToCreate: Array<{
    name: string;
    jurisdiction: string;
    recordType: string;
    county: string;
    state: string;
    zips: string[];
    market: WholesaleMarket;
  }> = [];

  for (const market of selectedMarkets) {
    for (const county of market.primaryCounties) {
      for (const recordType of recordTypes) {
        sourcesToCreate.push({
          name: `${county} - ${recordType.replace(/_/g, ' ')}`,
          jurisdiction: `${county}, ${market.stateCode}`,
          recordType,
          county,
          state: market.stateCode,
          zips: market.topZips,
          market,
        });
      }
    }
  }

  if (dryRun) {
    return Response.json({
      dryRun: true,
      wouldCreate: sourcesToCreate.length,
      markets: selectedMarkets.map(m => ({
        rank: m.rank,
        metro: m.metro,
        state: m.stateCode,
        counties: m.primaryCounties.length,
        recordTypes: recordTypes.length,
        sources: m.primaryCounties.length * recordTypes.length,
      })),
      summary: {
        totalMarkets: selectedMarkets.length,
        totalCounties: selectedMarkets.reduce((s, m) => s + m.primaryCounties.length, 0),
        totalSources: sourcesToCreate.length,
        recordTypes,
      },
    });
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  for (const source of sourcesToCreate) {
    try {
      const [existing] = await sql`
        SELECT id FROM lead_sources WHERE name = ${source.name} LIMIT 1
      `;

      if (existing) {
        skipped.push(source.name);
        continue;
      }

      const distressWeight = getDistressWeight(source.recordType);

      await sql`
        INSERT INTO lead_sources (
          name, jurisdiction, record_type, category, access_method,
          terms_status, distress_weight, notes
        ) VALUES (
          ${source.name},
          ${source.jurisdiction},
          ${source.recordType},
          'seller',
          'API',
          'PERMITTED',
          ${distressWeight},
          ${`Auto-registered for ${source.market.metro} market (rank #${source.market.rank}). Target ZIPs: ${source.zips.slice(0, 5).join(', ')}...`}
        )
      `;

      created.push(source.name);
    } catch (err: any) {
      errors.push(`${source.name}: ${err.message}`);
    }
  }

  await logEvent(
    'markets_auto_source',
    'lead_source',
    'batch',
    {
      marketsCount: selectedMarkets.length,
      created: created.length,
      skipped: skipped.length,
      errors: errors.length,
    },
    admin.userId
  );

  return Response.json({
    success: true,
    created: created.length,
    skipped: skipped.length,
    errors: errors.length,
    summary: {
      markets: selectedMarkets.map(m => m.metro),
      recordTypes,
      totalSources: created.length + skipped.length,
    },
    details: {
      created: created.slice(0, 20),
      skipped: skipped.slice(0, 10),
      errors: errors.slice(0, 10),
    },
    next: 'Sources registered. Use /api/lead-finder/sources/[id]/fetch to pull data, or configure ATTOM/PropStream API keys for automated fetching.',
  });
}

function getDistressWeight(recordType: string): number {
  const weights: Record<string, number> = {
    tax_delinquent: 85,
    pre_foreclosure: 90,
    probate: 80,
    code_violation: 75,
    vacant: 70,
    absentee_owner: 60,
    high_equity: 50,
    divorce: 75,
    bankruptcy: 85,
    liens: 80,
  };
  return weights[recordType] || 50;
}
