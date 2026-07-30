import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { getSubscription } from '@/app/api/utils/entitlement';
import { getStripe, isStripeConfigured } from '@/app/api/utils/stripe';

/**
 * Open the Stripe Billing Portal for the signed-in user (manage/cancel/update
 * card). Requires an existing Stripe customer — created at first checkout.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 });
  }
  if (!isStripeConfigured()) {
    return Response.json(
      { error: { code: 'BILLING_UNCONFIGURED', message: 'Billing is not configured on this environment.' } },
      { status: 503 }
    );
  }

  try {
    const sub = await getSubscription(session.user.id);
    if (!sub?.stripe_customer_id) {
      return Response.json(
        { error: { code: 'NO_CUSTOMER', message: 'No billing account yet — start a plan first.' } },
        { status: 409 }
      );
    }
    const origin = new URL(request.url).origin;
    const portal = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${origin}/settings`,
    });
    return Response.json({ url: portal.url });
  } catch (err) {
    console.error('POST /api/billing/portal error', err);
    return Response.json({ error: { code: 'PORTAL_FAILED', message: 'Could not open billing portal' } }, { status: 500 });
  }
}
