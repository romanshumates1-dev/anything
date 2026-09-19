/**
 * Organizations API - manage multi-tenant organizations.
 *
 * GET /api/organizations - list organizations user belongs to
 * POST /api/organizations - create a new organization
 *
 * When creating a new organization, pass plan: 'free' to start on free tier
 * with sample data seeded automatically.
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization, getUserOrganizations } from '@/lib/organization-context';
import { seedFreeTierData } from '@/app/api/services/freeTierSeeder';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organizations = await getUserOrganizations(session.user.id);
    return Response.json(organizations);
  } catch (error) {
    console.error('GET /api/organizations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, slug, plan } = body;

    if (!name || typeof name !== 'string') {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!slug || typeof slug !== 'string' || !slug.match(/^[a-z0-9-]+$/)) {
      return Response.json({ error: 'Valid slug is required (lowercase, alphanumeric, hyphens)' }, { status: 400 });
    }

    // Determine which plan to use
    const isFreeTier = plan === 'free';
    const planId = isFreeTier ? 'plan_free' : 'plan_starter';
    const subscriptionStatus = isFreeTier ? 'active' : 'trial';

    // Create organization
    const orgId = `org_${crypto.randomUUID().replace(/-/g, '')}`;
    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, ${name}, ${slug})
    `;

    // Add creator as OWNER
    const memberId = `om_${crypto.randomUUID().replace(/-/g, '')}`;
    await sql`
      INSERT INTO organization_members (id, user_id, organization_id, role)
      VALUES (${memberId}, ${session.user.id}, ${orgId}, 'OWNER')
    `;

    // Create subscription
    const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
    if (isFreeTier) {
      // Free tier: active status, no trial end date
      await sql`
        INSERT INTO organization_subscriptions (
          id, organization_id, plan_id, status
        ) VALUES (
          ${subId}, ${orgId}, ${planId}, ${subscriptionStatus}
        )
      `;

      // Seed sample data for free tier accounts
      try {
        await seedFreeTierData(orgId, session.user.id);
      } catch (seedError) {
        // Log but don't fail the org creation
        console.warn('[Organizations] Failed to seed free tier data:', seedError);
      }
    } else {
      // Starter trial: 14-day trial period
      await sql`
        INSERT INTO organization_subscriptions (
          id, organization_id, plan_id, status, trial_ends_at
        ) VALUES (
          ${subId}, ${orgId}, ${planId}, ${subscriptionStatus},
          ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()}
        )
      `;
    }

    return Response.json({
      id: orgId,
      name,
      slug,
      role: 'OWNER',
      subscription: {
        status: subscriptionStatus,
        tier: isFreeTier ? 'free' : 'starter',
        isFreeTier,
      },
    }, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes('duplicate key')) {
      return Response.json({ error: 'Slug already exists' }, { status: 409 });
    }
    console.error('POST /api/organizations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}