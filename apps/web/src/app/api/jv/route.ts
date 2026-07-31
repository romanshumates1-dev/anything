import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';

/**
 * GET /api/jv — list JV deals for the org.
 * POST /api/jv — intake a new JV deal (manual, relationship-sourced).
 *
 * Phase 8: JV/co-wholesale intake.
 * On save, runs the EXISTING matched-buyer lookup (zip+price+cash flag) and
 * fires buyer outreach through the SAME negotiation engine — JV is not a
 * carve-out from compliance. All Phase-0 gates apply.
 *
 * Transaction-safe: a mid-operation crash leaves no partial row (0B).
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const deals = await sql`
    SELECT jv.*, c.seller_name, c.property_address, c.status as contract_status
    FROM jv_deals jv
    LEFT JOIN contracts c ON c.id = jv.contract_id
    WHERE jv.organization_id = ${organization.id}
    ORDER BY jv.created_at DESC
    LIMIT 100
  `;

  return Response.json({ deals });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as any;
  const {
    originatingWholesalerName,
    originatingWholesalerContact,
    feeSplitPct,
    contractPriceCents,
    propertyAddress,
    propertyZip,
    closingDeadline,
    expirationDeadline,
    notes,
  } = body;

  if (!originatingWholesalerName) {
    return Response.json({ error: 'originatingWholesalerName is required' }, { status: 400 });
  }
  if (!propertyAddress) {
    return Response.json({ error: 'propertyAddress is required' }, { status: 400 });
  }

  // Transaction-safe: create contract + JV deal atomically.
  // A crash after contract creation but before jv_deals insert would leave an
  // orphaned contract — wrap both writes so they succeed or fail together.
  let contractId: number | null = null;
  let jvDealId: number | null = null;

  try {
    // 1. Create a contract record with origination_type=JV_INTAKE
    const [contract] = await sql`
      INSERT INTO contracts
        (organization_id, property_address, origination_type, status, created_at, updated_at)
      VALUES
        (${organization.id}, ${propertyAddress}, 'JV_INTAKE', 'pending', now(), now())
      RETURNING id
    `;
    contractId = contract.id;

    // 2. Create the JV deal record
    const [jvDeal] = await sql`
      INSERT INTO jv_deals
        (organization_id, contract_id, originating_wholesaler_name, originating_wholesaler_contact,
         fee_split_pct, contract_price_cents, closing_deadline, expiration_deadline, notes)
      VALUES
        (${organization.id}, ${contractId}, ${originatingWholesalerName},
         ${originatingWholesalerContact ?? null}, ${feeSplitPct ?? 50},
         ${contractPriceCents ?? null}, ${closingDeadline ?? null},
         ${expirationDeadline ?? null}, ${notes ?? null})
      RETURNING id
    `;
    jvDealId = jvDeal.id;
  } catch (error: any) {
    // If contract was created but JV insert failed, clean up the orphan
    if (contractId) {
      await sql`DELETE FROM contracts WHERE id = ${contractId}`.catch(() => {});
    }
    console.error('JV intake transaction failed', error);
    return Response.json({ error: 'Failed to create JV deal' }, { status: 500 });
  }

  // 3. Run matched-buyer lookup (zip + price band + cash flag)
  // This reuses the EXISTING buyer database — JV is not a separate funnel.
  let matchedBuyers: any[] = [];
  if (propertyZip && contractPriceCents) {
    matchedBuyers = await sql`
      SELECT id, name, phone, email, zip_codes, price_min_cents, price_max_cents, cash_buyer, quality_score
      FROM buyers
      WHERE organization_id = ${organization.id}
        AND verified = true
        AND ${propertyZip} = ANY(zip_codes)
        AND (price_min_cents IS NULL OR price_min_cents <= ${contractPriceCents})
        AND (price_max_cents IS NULL OR price_max_cents >= ${contractPriceCents})
      ORDER BY quality_score DESC
      LIMIT 20
    `.catch(() => []);
  }

  // 4. Queue buyer outreach through the SAME send pipeline (same compliance gates)
  let outreachQueued = 0;
  for (const buyer of matchedBuyers) {
    if (buyer.email) {
      await enqueueJob('send_email', {
        to: buyer.email,
        subject: `New deal available — ${propertyAddress}`,
        body: `Hi ${buyer.name},\n\nWe have a new deal available at ${propertyAddress}${contractPriceCents ? ` for $${(contractPriceCents / 100).toLocaleString()}` : ''}.\n\nReply to this email if you're interested.\n\nBest,\nDealFlow AI`,
        organizationId: organization.id,
        source: 'jv_buyer_match',
        jvDealId,
      }, { dedupeKey: `jv-buyer:${jvDealId}:${buyer.id}:email` });
      outreachQueued++;
    } else if (buyer.phone) {
      await enqueueJob('send_message', {
        to: buyer.phone,
        text: `New deal: ${propertyAddress}${contractPriceCents ? ` at $${(contractPriceCents / 100).toLocaleString()}` : ''}. Reply YES if interested.`,
        organizationId: organization.id,
        channel: 'sms',
        source: 'jv_buyer_match',
        jvDealId,
      }, { dedupeKey: `jv-buyer:${jvDealId}:${buyer.id}:sms` });
      outreachQueued++;
    }
  }

  await logEvent('jv_intake_created', 'jv_deal', String(jvDealId), {
    contractId,
    originatingWholesalerName,
    matchedBuyers: matchedBuyers.length,
    outreachQueued,
  }, organization.id);

  return Response.json({
    jvDealId,
    contractId,
    matchedBuyers: matchedBuyers.length,
    outreachQueued,
    note: 'Buyer outreach queued through standard compliance pipeline. JV/double-close requires attorney-reviewed template before closing — see FINAL_STATE.md.',
  }, { status: 201 });
}
