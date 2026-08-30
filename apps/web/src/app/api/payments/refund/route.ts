/**
 * Admin-initiated refund (Phase 4).
 *
 * POST /api/payments/refund
 * Body: { paymentId: string, reason: string, amountCents?: number }
 *
 * The prior version was a ledger-only status flip open to ANY authenticated
 * user, with an optional reason and NO Stripe call (BREAKAGE_TABLE #30). Now:
 *  - ADMIN-only (requireAdmin),
 *  - reason MANDATORY,
 *  - executes through the configured Stripe provider (mock in dev; live/test
 *    keys are owner-gated),
 *  - mirrors the returned refund id + status into payments_ledger,
 *  - writes an admin_audit_log row.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getStripeProvider } from '@/app/api/services/stripeProvider';
import { adminAudit, clientIp } from '@/app/api/utils/adminAudit';
import { logEvent } from '@/app/api/utils/logger';

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json().catch(() => ({}));
    const { paymentId, reason, amountCents } = body ?? {};

    if (!paymentId) {
      return Response.json({ error: 'Missing paymentId' }, { status: 400 });
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return Response.json({ error: 'reason is required' }, { status: 400 });
    }

    // Admins refund across all orgs; look the payment up directly.
    const [payment] = await sql`
      SELECT id, contract_id, status, stripe_payment_intent_id, amount_cents
      FROM payments_ledger WHERE id = ${paymentId} LIMIT 1
    `;
    if (!payment) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }
    if (payment.status !== 'paid') {
      return Response.json({ error: `Cannot refund payment with status: ${payment.status}` }, { status: 409 });
    }
    if (!payment.stripe_payment_intent_id) {
      return Response.json({ error: 'Payment has no payment intent to refund' }, { status: 409 });
    }

    // Execute through the configured provider (mock/live). Full refund unless a
    // partial amountCents is given.
    const provider = getStripeProvider();
    const refund = await provider.refund({
      paymentIntentId: payment.stripe_payment_intent_id,
      amountCents: Number.isFinite(amountCents) ? amountCents : undefined,
      reason,
    });

    // Mirror to the ledger (idempotent: only flip a still-'paid' row).
    const [updated] = await sql`
      UPDATE payments_ledger
      SET status = 'refunded', refunded_at = now(), reason = ${reason}, stripe_refund_id = ${refund.refundId}
      WHERE id = ${paymentId} AND status = 'paid'
      RETURNING id
    `;
    if (!updated) {
      return Response.json({ error: 'Payment was already refunded' }, { status: 409 });
    }

    await logEvent('payment_refunded', 'contract', payment.contract_id, {
      paymentId, reason, refundId: refund.refundId, provider: provider.type,
    }, undefined);

    await adminAudit({
      actorId: admin.userId,
      action: 'payment_refunded',
      targetType: 'payment',
      targetId: paymentId,
      metadata: { reason, refundId: refund.refundId, provider: provider.type, amountCents: amountCents ?? payment.amount_cents },
      ip: clientIp(request),
    });

    return Response.json({ ok: true, status: 'refunded', refundId: refund.refundId, provider: provider.type });
  } catch (error: any) {
    console.error('POST /api/payments/refund error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
