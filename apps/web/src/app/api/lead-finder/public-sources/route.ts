/**
 * Public Data Sources API
 *
 * GET  /api/lead-finder/public-sources           — List all sources
 * GET  /api/lead-finder/public-sources?tier=A    — Tier A (API) sources only
 * GET  /api/lead-finder/public-sources?category=seller — Seller sources only
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import {
  ALL_SOURCES,
  SELLER_SOURCES,
  BUYER_SOURCES,
  getSourcesByTier,
  getSourcesByCategory,
  getTierASourcesWithFallbacks,
  type DataTier,
} from './config';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(req.url);
  const tier = url.searchParams.get('tier') as DataTier | null;
  const category = url.searchParams.get('category') as 'seller' | 'buyer' | null;
  const withFallbacks = url.searchParams.get('withFallbacks') === 'true';

  if (withFallbacks) {
    const sourcesWithFallbacks = getTierASourcesWithFallbacks();
    return Response.json({
      description: 'Tier A sources with Tier B fallbacks',
      protocol: 'Try Tier A (API) first, fall back to Tier B (direct/public) if unavailable',
      sources: sourcesWithFallbacks,
      stats: {
        tierA: sourcesWithFallbacks.length,
        withFallback: sourcesWithFallbacks.filter(s => s.fallback).length,
        noFallback: sourcesWithFallbacks.filter(s => !s.fallback).length,
      },
    });
  }

  let sources = ALL_SOURCES;

  if (tier) {
    sources = getSourcesByTier(tier);
  }

  if (category) {
    sources = sources.filter(s => s.category === category);
  }

  const sellerSources = sources.filter(s => s.category === 'seller');
  const buyerSources = sources.filter(s => s.category === 'buyer');

  return Response.json({
    stats: {
      total: sources.length,
      sellers: sellerSources.length,
      buyers: buyerSources.length,
      tierA: sources.filter(s => s.dataTier === 'A').length,
      tierB: sources.filter(s => s.dataTier === 'B').length,
    },
    protocol: {
      description: 'A/B Fallback Protocol',
      tierA: 'Primary - API-based sources (ATTOM, PropStream)',
      tierB: 'Fallback - Direct county/public sources if Tier A unavailable',
    },
    sellerSources: category === 'buyer' ? undefined : sellerSources,
    buyerSources: category === 'seller' ? undefined : buyerSources,
  });
}
