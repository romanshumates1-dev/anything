/**
 * Admin-initiated manual "mark as paid" (Phase P2).
 *
 * For payments handled outside of Stripe (e.g., at closing via wire transfer).
 *
 * POST /api/payments/mark-paid
 * Body: { paymentId: string, reason: string }
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { adminAudit, clientIp } from '@/app/api/utils/adminAudit';
import { logEvent } from '@/app/api/utils/logger';

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json().catch(() => ({}));
    const { paymentId, reason } = body ?? {};

    if (!paymentId) {
      return Response.json({ error: 'Missing paymentId' }, { status: 400 });
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return Response.json({ error: 'reason is required for audit log' }, { status: 400 });
    }

    const [payment] = await sql`
      SELECT id, contract_id, status
      FROM payments_ledger WHERE id = ${paymentId} LIMIT 1
    `;
    if (!payment) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }
    if (payment.status === 'paid') {
      return Response.json({ error: 'Payment is already marked as paid' }, { status: 409 });
    }

    const [updated] = await sql`
      UPDATE payments_ledger
      SET status = 'paid', paid_at = now(), reason = ${reason}
      WHERE id = ${paymentId} AND status != 'paid'
      RETURNING id, contract_id, amount_cents
    `;
    if (!updated) {
      return Response.json({ error: 'Failed to update payment status' }, { status: 500 });
    }

    await logEvent('payment_marked_paid', 'contract', updated.contract_id, {
      paymentId,
      reason,
      markedBy: admin.userId,
    });

    await adminAudit({
      actorId: admin.userId,
      action: 'payment_marked_paid',
      targetType: 'payment',
      targetId: paymentId,
      metadata: { reason },
      ip: clientIp(request),
    });

    return Response.json({ ok: true, status: 'paid' });
  } catch (error: any) {
    console.error('POST /api/payments/mark-paid error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
