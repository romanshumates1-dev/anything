import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

/**
 * POST /api/earnings/[id]/refund
 * Mark an earning as refunded (deal fell through during inspection period).
 * Only PENDING earnings can be refunded.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const { id: earningId } = await params;
    const body = await request.json();
    const { reason } = body;

    if (!reason) {
      return Response.json({ error: 'Refund reason is required' }, { status: 400 });
    }

    const userId = session.user.id;
    const orgId = organization.id;

    // Get the earning
    const [earning] = await sql`
      SELECT id, status, amount_cents, contract_id
      FROM earnings
      WHERE id = ${earningId}
        AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!earning) {
      return Response.json({ error: 'Earning not found' }, { status: 404 });
    }

    // Only PENDING earnings can be refunded
    // (AVAILABLE means inspection period passed, WITHDRAWN means already paid out)
    if (earning.status !== 'PENDING') {
      return Response.json(
        {
          error: `Cannot refund earning with status ${earning.status}. Only PENDING earnings can be refunded.`,
        },
        { status: 400 }
      );
    }

    // Check user permission (must be ADMIN or the earning owner)
    const userRole = (session.user as { role?: string }).role;
    const [earningOwner] = await sql`
      SELECT user_id FROM earnings WHERE id = ${earningId}
    `;

    if (userRole !== 'ADMIN' && earningOwner?.user_id !== userId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Mark as refunded
    await sql`
      UPDATE earnings
      SET status = 'REFUNDED',
          refunded_at = NOW(),
          refund_reason = ${reason},
          updated_at = NOW()
      WHERE id = ${earningId}
    `;

    // Log the refund in audit_logs
    await sql`
      INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
      VALUES (
        ${userId},
        'earning_refunded',
        'earning',
        ${earningId},
        ${JSON.stringify({
          amount_cents: earning.amount_cents,
          contract_id: earning.contract_id,
          reason,
        })}
      )
    `;

    return Response.json({
      success: true,
      earningId,
      previousStatus: earning.status,
      newStatus: 'REFUNDED',
      refundedAt: new Date().toISOString(),
      reason,
    });
  } catch (error: any) {
    console.error('POST /api/earnings/[id]/refund error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
