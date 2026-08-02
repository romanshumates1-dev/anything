/**
 * Buyer Scoring API
 * POST /api/prospects/buyer-scoring
 * Scores buyer prospects and determines tier + earnest money requirements.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import {
  scoreBuyer,
  BuyerSignals,
  requiresPOF,
  calculateEarnestAmount,
} from '../scoring-engine';

interface BuyerScoringBody {
  buyerName?: string;
  buyerEmail?: string;
  signals: BuyerSignals;
  dealValue?: number;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: BuyerScoringBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { buyerName, buyerEmail, signals, dealValue } = body;

  if (!signals || typeof signals !== 'object') {
    return Response.json({ error: 'signals object required' }, { status: 400 });
  }

  try {
    const result = scoreBuyer(signals);
    const needsPOF = requiresPOF(result.tier);

    // Calculate specific earnest amount if deal value provided
    const earnestAmount = dealValue
      ? calculateEarnestAmount(result.tier, dealValue)
      : null;

    console.log(
      `[BUYER-SCORE] ${buyerName || buyerEmail || 'Unknown'}: Score ${result.score} | Tier: ${result.tier} | Earnest: $${result.earnestMoney.min}-$${result.earnestMoney.max}`
    );

    return Response.json({
      buyerName,
      buyerEmail,
      score: result.score,
      tier: result.tier,
      earnestMoney: {
        min: result.earnestMoney.min,
        max: result.earnestMoney.max,
        suggested: earnestAmount,
      },
      signals: result.signals,
      priority: result.priority,
      requiresPOF: needsPOF,
      scoredAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[BUYER-SCORE] Error:', error);
    return Response.json(
      { error: 'Failed to score buyer', details: error.message },
      { status: 500 }
    );
  }
}
