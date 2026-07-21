/**
 * Admin Subscription Management API
 *
 * GET /api/admin/subscriptions - list all subscriptions with organization info
 * PATCH /api/admin/subscriptions/:id - update subscription status/plan
 * POST /api/admin/subscriptions/cancel - cancel subscription for an organization
 *
 * ADMIN-only via requireAdmin middleware.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const subscriptions = await sql`
      SELECT
        os.id,
        os.status,
        os.trial_ends_at,
        os.current_period_start,
        os.current_period_end,
        os.cancel_at_period_end,
        os.stripe_subscription_id,
        o.id as organization_id,
        o.name as organization_name,
        o.slug as organization_slug,
        p.name as plan_name,
        p.tier,
        p.price_cents
      FROM organization_subscriptions os
      JOIN organizations o ON o.id = os.organization_id
      JOIN subscription_plans p ON p.id = os.plan_id
      ORDER BY os.created_at DESC
      LIMIT 500
    `;

    return Response.json(subscriptions);
  } catch (error) {
    console.error('GET /api/admin/subscriptions error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const subId = searchParams.get('id');

  if (!subId) {
    return Response.json({ error: 'Subscription ID required' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { planId, status } = body;

    if (planId !== undefined) {
      // Verify plan exists
      const [plan] = await sql`
        SELECT id FROM subscription_plans WHERE id = ${planId} LIMIT 1
      `;
      if (!plan) {
        return Response.json({ error: 'Invalid plan ID' }, { status: 400 });
      }
      await sql`
        UPDATE organization_subscriptions SET plan_id = ${planId} WHERE id = ${subId}
      `;
    }

    if (status !== undefined) {
      await sql`
        UPDATE organization_subscriptions SET status = ${status} WHERE id = ${subId}
      `;
    }

    if (planId === undefined && status === undefined) {
      return Response.json({ error: 'No valid update fields provided' }, { status: 400 });
    }

    await logEvent('admin_subscription_updated', 'subscription', subId, {
      updatedBy: admin.userId,
      updates: Object.keys(body),
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('PATCH /api/admin/subscriptions error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}