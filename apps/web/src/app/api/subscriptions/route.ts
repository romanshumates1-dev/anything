/**
 * Subscriptions API - manage organization subscription plans.
 * 
 * GET /api/subscriptions - get current organization's subscription
 * POST /api/subscriptions - upgrade/change subscription plan
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    const [subscription] = await sql`
      SELECT os.id, os.status, os.current_period_start, os.current_period_end,
             os.cancel_at_period_end, os.trial_ends_at,
             p.id as plan_id, p.name as plan_name, p.tier, p.price_cents, p.limits
      FROM organization_subscriptions os
      JOIN subscription_plans p ON p.id = os.plan_id
      WHERE os.organization_id = ${org.id}
      ORDER BY os.created_at DESC
      LIMIT 1
    `;

    if (!subscription) {
      return Response.json({ error: 'No subscription found' }, { status: 404 });
    }

    return Response.json(subscription);
  } catch (error) {
    console.error('GET /api/subscriptions error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    const body = await request.json();
    const { planId, action } = body; // action: 'upgrade', 'downgrade', 'cancel'

    // Verify plan exists
    const [plan] = await sql`
      SELECT id, name, tier, price_cents, limits FROM subscription_plans WHERE id = ${planId}
    `;

    if (!plan) {
      return Response.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // Get current subscription
    const [currentSub] = await sql`
      SELECT id, plan_id, status FROM organization_subscriptions
      WHERE organization_id = ${org.id} AND status IN ('trial', 'active')
      ORDER BY created_at DESC LIMIT 1
    `;

    if (action === 'cancel') {
      // Cancel at period end
      await sql`
        UPDATE organization_subscriptions
        SET cancel_at_period_end = true, status = 'canceled'
        WHERE id = ${currentSub.id}
      `;
      return Response.json({ success: true, canceled: true });
    }

    // Create new subscription (upgrade/downgrade)
    const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // If downgrading, check for grace period (proration logic would go here)
    // For now, immediate change with credit balance tracked

    await sql`
      INSERT INTO organization_subscriptions (
        id, organization_id, plan_id, status,
        current_period_start, current_period_end
      ) VALUES (
        ${subId}, ${org.id}, ${planId}, 'active',
        ${now.toISOString()}, ${periodEnd.toISOString()}
      )
    `;

    // Cancel old subscription if exists
    if (currentSub) {
      await sql`
        UPDATE organization_subscriptions
        SET status = 'expired'
        WHERE id = ${currentSub.id}
      `;
    }

    return Response.json({ 
      success: true, 
      subscription: { id: subId, plan: plan }
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/subscriptions error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}