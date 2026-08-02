/**
 * Seller Scoring API
 * POST /api/prospects/seller-scoring
 * Scores seller prospects based on distress signals.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { scoreSeller, SellerSignals, isContactable } from '../scoring-engine';

interface SellerScoringBody {
  propertyAddress?: string;
  signals: SellerSignals;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: SellerScoringBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { propertyAddress, signals } = body;

  if (!signals || typeof signals !== 'object') {
    return Response.json({ error: 'signals object required' }, { status: 400 });
  }

  try {
    const result = scoreSeller(signals);
    const contactable = isContactable(result.tier);

    console.log(
      `[SELLER-SCORE] ${propertyAddress || 'Unknown'}: Score ${result.score} | Tier: ${result.tier} | Contactable: ${contactable}`
    );

    return Response.json({
      propertyAddress,
      score: result.score,
      tier: result.tier,
      signals: result.signals,
      recommendedAction: result.recommendedAction,
      contactable,
      scoredAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[SELLER-SCORE] Error:', error);
    return Response.json(
      { error: 'Failed to score seller', details: error.message },
      { status: 500 }
    );
  }
}
