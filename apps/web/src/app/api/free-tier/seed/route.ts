/**
 * Free Tier Seed API - Seeds sample data for free tier users.
 *
 * POST /api/free-tier/seed - Seeds sample leads, campaign, and analytics
 *
 * This endpoint is automatically called when a new free tier account is created,
 * but can also be called manually to reseed data.
 */
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { seedFreeTierData, needsSeeding } from '@/app/api/services/freeTierSeeder';
import { getSubscription } from '@/app/api/services/tierLimits';

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    // Check if user is on free tier
    const subscription = await getSubscription(org.id);
    if (!subscription.isFreeTier) {
      return Response.json({
        success: false,
        message: 'Sample data seeding is only available for free tier accounts',
      });
    }

    // Seed the data
    const result = await seedFreeTierData(org.id, session.user.id);

    return Response.json({
      success: result.success,
      leadsCreated: result.leadsCreated,
      campaignCreated: result.campaignCreated,
      analyticsSeeded: result.analyticsSeeded,
      error: result.error,
    });
  } catch (error: any) {
    console.error('POST /api/free-tier/seed error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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

    // Check if seeding is needed
    const needs = await needsSeeding(org.id);
    const subscription = await getSubscription(org.id);

    return Response.json({
      needsSeeding: needs,
      isFreeTier: subscription.isFreeTier,
      tier: subscription.tier,
    });
  } catch (error: any) {
    console.error('GET /api/free-tier/seed error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
