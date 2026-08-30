/**
 * Top Wholesale Markets API
 *
 * GET  /api/lead-finder/markets           — list all top 25 markets with stats
 * GET  /api/lead-finder/markets?state=TX  — filter by state
 * GET  /api/lead-finder/markets?metro=Houston — get specific metro
 * GET  /api/lead-finder/markets?format=attom — ATTOM-ready format
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import {
  TOP_WHOLESALE_MARKETS,
  getMarketByMetro,
  getMarketsByState,
  getAllCounties,
  getAllZips,
  getMarketStats,
} from './config';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const metro = url.searchParams.get('metro');
  const format = url.searchParams.get('format');

  if (metro) {
    const market = getMarketByMetro(metro);
    if (!market) {
      return Response.json({ error: `Metro "${metro}" not in top 25 markets` }, { status: 404 });
    }
    return Response.json(market);
  }

  if (state) {
    const markets = getMarketsByState(state);
    if (markets.length === 0) {
      return Response.json({ error: `No top 25 markets in state "${state}"` }, { status: 404 });
    }
    return Response.json({
      state,
      markets,
      stats: {
        count: markets.length,
        counties: markets.flatMap(m => m.primaryCounties),
        zips: markets.flatMap(m => m.topZips),
      },
    });
  }

  if (format === 'attom') {
    const counties = getAllCounties();
    const zips = getAllZips();
    return Response.json({
      format: 'ATTOM_DATA_REQUEST',
      description: 'Top 25 wholesale markets for ATTOM Data API coverage',
      totalCounties: counties.length,
      totalZips: zips.length,
      counties: counties.sort(),
      zips: zips.sort(),
      markets: TOP_WHOLESALE_MARKETS.map(m => ({
        rank: m.rank,
        metro: m.metro,
        state: m.stateCode,
        counties: m.primaryCounties,
        zipCount: m.topZips.length,
      })),
      suggestedResponse: `We need coverage for ${counties.length} counties across ${[...new Set(TOP_WHOLESALE_MARKETS.map(m => m.stateCode))].length} states (the top 25 US wholesale real estate markets). Primary focus is comp data for distressed property valuation. Can you provide pricing for: (1) county-level coverage for all ${counties.length} counties, or (2) ZIP-level coverage for ${zips.length} target ZIPs?`,
    });
  }

  const stats = getMarketStats();
  return Response.json({
    stats,
    markets: TOP_WHOLESALE_MARKETS,
    endpoints: {
      byState: '/api/lead-finder/markets?state=TX',
      byMetro: '/api/lead-finder/markets?metro=Houston',
      attomFormat: '/api/lead-finder/markets?format=attom',
    },
  });
}
