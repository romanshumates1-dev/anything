/**
 * Phase P2 — Payments API route.
 *
 * GET  /api/payments?contractId=xxx  — list payments for a contract
 * POST /api/payments                  — create a new payment (owner-initiated)
 * POST /api/payments/refund           — owner-initiated refund
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { getStripeProvider } from '@/app/api/services/stripeProvider';
import { requireValidCsrf } from '@/app/api/utils/csrfProtection';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const contractId = searchParams.get('contractId');

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }
    const org = organization.id;

    let rows;
    if (contractId) {
      // Bug #35: this branch previously filtered on contract_id alone, with
      // no organization check at all — any authenticated user from ANY org
      // could read another org's payment amounts/Stripe ids by passing a
      // different contractId. Joined to contracts for the same org filter
      // the unfiltered branch below already applies.
      rows = await sql`
        SELECT pl.id, pl.contract_id, pl.buyer_id, pl.amount_cents, pl.currency,
               pl.stripe_payment_intent_id, pl.status, pl.reason, pl.created_at, pl.paid_at, pl.refunded_at
        FROM payments_ledger pl
        JOIN contracts c ON c.id = pl.contract_id
        WHERE pl.contract_id = ${contractId} AND c.organization_id = ${org}
        ORDER BY pl.created_at DESC
      `;
    } else {
      rows = await sql`
        SELECT pl.id, pl.contract_id, pl.buyer_id, pl.amount_cents, pl.currency,
               pl.stripe_payment_intent_id, pl.status, pl.reason, pl.created_at, pl.paid_at, pl.refunded_at
        FROM payments_ledger pl
        JOIN contracts c ON c.id = pl.contract_id
        WHERE c.organization_id = ${org}
        ORDER BY pl.created_at DESC
        LIMIT 100
      `;
    }

    return Response.json(rows);
  } catch (error: any) {
    console.error('GET /api/payments error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const csrfError = requireValidCsrf(request);
  if (csrfError) return csrfError;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { contractId, amountCents, buyerId, reason } = body;

    if (!contractId || !amountCents) {
      return Response.json({ error: 'Missing required fields: contractId, amountCents' }, { status: 400 });
    }

    if (amountCents <= 0) {
      return Response.json({ error: 'amountCents must be positive' }, { status: 400 });
    }

    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }
    const org = organization.id;

    // Verify contract exists and belongs to this org
    const contractRows = await sql`
      SELECT id, fee_collection FROM contracts
      WHERE id = ${contractId} AND organization_id = ${org}
      LIMIT 1
    `;

    if (contractRows.length === 0) {
      return Response.json({ error: 'Contract not found' }, { status: 404 });
    }

    // Create the payment via Stripe provider
    const provider = getStripeProvider();
    const paymentResult = await provider.createPaymentLink({
      contractId,
      organizationId: org,
      amountCents,
      description: `Assignment Fee - Contract ${contractId}`,
    });

    // Record in ledger
    const ledgerId = `pay_${crypto.randomUUID()}`;
    await sql`
      INSERT INTO payments_ledger (id, contract_id, buyer_id, amount_cents, stripe_payment_intent_id, status, reason)
      VALUES (${ledgerId}, ${contractId}, ${buyerId || null}, ${amountCents}, ${paymentResult.paymentIntentId}, 'sent', ${reason || null})
    `;

    await logEvent('payment_created', 'contract', contractId, {
      ledgerId,
      amountCents,
      paymentIntentId: paymentResult.paymentIntentId,
      reason,
    });

    return Response.json({
      id: ledgerId,
      paymentLink: paymentResult.paymentLink,
      paymentIntentId: paymentResult.paymentIntentId,
      amountCents,
      status: 'sent',
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/payments error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}