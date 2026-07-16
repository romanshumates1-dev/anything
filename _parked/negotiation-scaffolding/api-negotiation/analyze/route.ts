import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { analyzeNegotiation, calculateFallbackOffers } from '@/app/api/services/negotiation-engine';
import type { NegotiationInputs } from '@/app/api/utils/negotiation-prompt';

/**
 * POST /api/negotiation/analyze
 * 
 * Analyzes a property and generates wholesale offer recommendations.
 * Requires authentication.
 */
export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.arv || typeof body.arv !== 'number' || body.arv <= 0) {
      return NextResponse.json(
        { error: 'After Repair Value (arv) is required and must be a positive number' },
        { status: 400 }
      );
    }

    const inputs: NegotiationInputs = {
      arv: body.arv,
      repairCosts: body.repairCosts,
      condition: body.condition,
      squareFootage: body.squareFootage,
      bedrooms: body.bedrooms,
      bathrooms: body.bathrooms,
      yearBuilt: body.yearBuilt,
      daysOnMarket: body.daysOnMarket,
      motivation: body.motivation,
      sellerTimeline: body.sellerTimeline,
      taxValue: body.taxValue,
      zestimate: body.zestimate,
      localComps: body.localComps,
      state: body.state,
      county: body.county,
      neighborhood: body.neighborhood,
      marketSpeed: body.marketSpeed,
      holdingCosts: body.holdingCosts,
      closingCosts: body.closingCosts,
    };

    let result;
    try {
      result = await analyzeNegotiation(inputs, session.user.id);
    } catch (aiError: any) {
      // Fallback to heuristic calculation if AI fails
      console.warn('AI negotiation failed, using fallback:', aiError.message);
      result = calculateFallbackOffers(inputs);
    }

    return NextResponse.json({
      success: true,
      result,
      inputs: {
        arv: inputs.arv,
        repairCosts: inputs.repairCosts,
        condition: inputs.condition,
        state: inputs.state,
        county: inputs.county,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('POST /api/negotiation/analyze error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze negotiation' },
      { status: 500 }
    );
  }
}