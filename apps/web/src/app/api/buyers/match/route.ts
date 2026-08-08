/**
 * POST /api/buyers/match
 *
 * Match and assign a buyer to a seller deal.
 * This is triggered when a seller contract is signed.
 *
 * Matching criteria:
 * 1. Buyer covers the property's zip code
 * 2. Price falls within buyer's range
 * 3. Property type matches buyer preferences
 * 4. Buyer is verified and has proven close history
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';

interface BuyerMatch {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  matchScore: number;
  reasons: string[];
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { leadId, contractId, autoAssign } = body;

  if (!leadId && !contractId) {
    return Response.json({ error: 'leadId or contractId required' }, { status: 400 });
  }

  try {
    let lead;
    if (leadId) {
      [lead] = await sql`
        SELECT * FROM leads
        WHERE id = ${leadId} AND organization_id = ${organization.id}
      `;
    } else {
      const [contract] = await sql`
        SELECT c.*, l.* FROM contracts c
        JOIN leads l ON l.id = c.seller_lead_id
        WHERE c.id = ${contractId} AND c.organization_id = ${organization.id}
      `;
      lead = contract;
    }

    if (!lead) {
      return Response.json({ error: 'Lead/Contract not found' }, { status: 404 });
    }

    const metadata = lead.metadata || {};
    const zip = metadata.zip || metadata.property_zip || '';
    const price = lead.agreed_price || metadata.estimated_value || metadata.asking_price || 100000;
    const propertyType = metadata.property_type || 'SFR';

    const buyers = await sql`
      SELECT b.*,
        COALESCE(b.actual_close_count, 0) as closes,
        COALESCE(b.quality_score, 50) as score
      FROM buyers b
      WHERE b.organization_id = ${organization.id}
        AND (b.zip_codes IS NULL OR cardinality(b.zip_codes) = 0 OR ${zip} = ANY(b.zip_codes))
        AND (b.price_min_cents IS NULL OR b.price_min_cents <= ${Math.round(price * 100)})
        AND (b.price_max_cents IS NULL OR b.price_max_cents >= ${Math.round(price * 100)})
      ORDER BY
        b.verified DESC,
        COALESCE(b.actual_close_count, 0) DESC,
        COALESCE(b.quality_score, 0) DESC
      LIMIT 20
    `;

    const matches: BuyerMatch[] = (buyers as any[]).map(b => {
      const reasons: string[] = [];
      let score = 50;

      if (b.verified) {
        score += 20;
        reasons.push('Verified buyer');
      }

      if (b.closes > 0) {
        score += Math.min(30, b.closes * 5);
        reasons.push(`${b.closes} past closes`);
      }

      if (b.cash_buyer) {
        score += 10;
        reasons.push('Cash buyer');
      }

      if (b.zip_codes?.includes(zip)) {
        score += 10;
        reasons.push(`Covers zip ${zip}`);
      }

      if (b.property_types?.includes(propertyType)) {
        score += 5;
        reasons.push(`Wants ${propertyType}`);
      }

      return {
        id: b.id,
        name: b.name,
        email: b.email,
        phone: b.phone,
        matchScore: Math.min(100, score),
        reasons,
      };
    }).sort((a, b) => b.matchScore - a.matchScore);

    if (autoAssign && matches.length > 0) {
      const bestMatch = matches[0];

      if (contractId) {
        await sql`
          UPDATE contracts
          SET buyer_id = ${bestMatch.id}, assigned_at = now(), status = 'BUYER_ASSIGNED'
          WHERE id = ${contractId}
        `;
      }

      await sql`
        INSERT INTO buyer_assignments (id, organization_id, lead_id, buyer_id, contract_id, match_score, status)
        VALUES (${crypto.randomUUID()}, ${organization.id}, ${leadId || lead.id}, ${bestMatch.id}, ${contractId || null}, ${bestMatch.matchScore}, 'PENDING_BUYER_ACCEPT')
      `;

      await logEvent('buyer_auto_assigned', 'lead', String(leadId || lead.id), {
        buyerId: bestMatch.id,
        buyerName: bestMatch.name,
        matchScore: bestMatch.matchScore,
      }, organization.id);

      return Response.json({
        ok: true,
        assigned: true,
        buyer: bestMatch,
        matches,
      });
    }

    return Response.json({
      ok: true,
      assigned: false,
      matches,
      topMatch: matches[0] || null,
    });
  } catch (error: any) {
    console.error('POST /api/buyers/match error', error);
    return Response.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
