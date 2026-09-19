/**
 * GET /api/negotiation/ai-pricing?leadId=123
 *
 * Fetch AI-suggested pricing bounds for a lead based on comparable sales.
 * Returns pricing estimate including ARV, offer range, and confidence level.
 */
import { NextRequest } from 'next/server';
import { requireSession } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { suggestNegotiationBounds, getPriceEstimate } from '@/app/api/utils/comparableSales';
import sql from '@/app/api/utils/sql';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  const leadId = req.nextUrl.searchParams.get('leadId');
  if (!leadId) {
    return Response.json({ error: 'leadId required' }, { status: 400 });
  }

  // Verify lead belongs to organization
  const [lead] = await sql`
    SELECT l.id, l.metadata
    FROM leads l
    JOIN campaign_leads cl ON cl.lead_id = l.id
    JOIN campaigns c ON c.id = cl.campaign_id
    WHERE l.id = ${leadId}
    LIMIT 1
  `.catch(() => []);

  if (!lead) {
    return Response.json({ error: 'Lead not found' }, { status: 404 });
  }

  try {
    const bounds = await suggestNegotiationBounds(
      Number(leadId),
      organization.id
    );

    if (!bounds) {
      return Response.json({
        available: false,
        reason: 'Unable to compute AI pricing - insufficient property data or comparable sales',
      });
    }

    return Response.json({
      available: true,
      arvCents: bounds.arvCents,
      confidence: bounds.confidence,
      minOfferCents: bounds.minOfferCents,
      maxOfferCents: bounds.maxOfferCents,
      targetOfferCents: bounds.targetOfferCents,
      assignmentFeeCents: bounds.assignmentFeeCents,
      methodology: bounds.methodology,
    });
  } catch (error: any) {
    console.error('[AI-PRICING] Error:', error);
    return Response.json({
      available: false,
      reason: error.message || 'Failed to compute AI pricing',
    });
  }
}

/**
 * POST /api/negotiation/ai-pricing
 *
 * Calculate AI pricing for a property (without requiring a lead).
 * Used for preview/estimation before lead creation.
 */
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  let body: {
    zip: string;
    sqft: number;
    bedrooms: number;
    bathrooms: number;
    condition?: 'light' | 'moderate' | 'heavy';
    motivationScore?: number;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { zip, sqft, bedrooms, bathrooms, condition = 'moderate', motivationScore = 0.5 } = body;

  if (!zip || !sqft || bedrooms === undefined || bathrooms === undefined) {
    return Response.json({ error: 'zip, sqft, bedrooms, and bathrooms required' }, { status: 400 });
  }

  try {
    const estimate = await getPriceEstimate(
      { zip, sqft, bedrooms, bathrooms, condition },
      motivationScore
    );

    return Response.json({
      available: estimate.comparablesUsed > 0,
      estimatedARV: estimate.estimatedARV,
      confidence: estimate.confidence,
      comparablesUsed: estimate.comparablesUsed,
      pricePerSqft: estimate.pricePerSqft,
      suggestedOfferRange: estimate.suggestedOfferRange,
      suggestedAssignmentFee: estimate.suggestedAssignmentFee,
      methodology: estimate.methodology,
    });
  } catch (error: any) {
    console.error('[AI-PRICING] Error:', error);
    return Response.json({
      available: false,
      reason: error.message || 'Failed to compute AI pricing',
    });
  }
}
