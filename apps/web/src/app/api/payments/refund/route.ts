/**
 * Phase P2 — Owner-initiated refund endpoint.
 *
 * POST /api/payments/refund
 * Body: { paymentId: string, reason?: string }
 *
 * Only marks the ledger as refunded (append-only). The actual Stripe refund
 * is OWNER-GATED (requires live Stripe keys).
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { paymentId, reason } = body;

    if (!paymentId) {
      return Response.json({ error: 'Missing paymentId' }, { status: 400 });
    }

    const org = (session.user as any).organizationId || 'default';

    // Find the payment and verify org ownership via contract
    const rows = await sql`
      SELECT pl.id, pl.contract_id, pl.status, pl.stripe_payment_intent_id
      FROM payments_ledger pl
      JOIN contracts c ON c.id = pl.contract_id
      WHERE pl.id = ${paymentId} AND c.organization_id = ${org}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }

    const payment = rows[0];

    if (payment.status !== 'paid') {
      return Response.json({ error: `Cannot refund payment with status: ${payment.status}` }, { status: 409 });
    }

    // Mark as refunded in ledger
    await sql`
      UPDATE payments_ledger
      SET status = 'refunded', refunded_at = NOW(), reason = ${reason || 'owner_refund'}
      WHERE id = ${paymentId} AND status = 'paid'
    `;

    await logEvent('payment_refunded', 'contract', payment.contract_id, {
      paymentId,
      reason: reason || 'owner_refund',
      stripePaymentIntentId: payment.stripe_payment_intent_id,
    });

    return Response.json({ ok: true, status: 'refunded' });
  } catch (error: any) {
    console.error('POST /api/payments/refund error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}