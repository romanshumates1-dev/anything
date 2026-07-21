/**
 * Organizations API - manage multi-tenant organizations.
 * 
 * GET /api/organizations - list organizations user belongs to
 * POST /api/organizations - create a new organization
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization, getUserOrganizations } from '@/lib/organization-context';

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
    const { name, slug } = body;

    if (!name || typeof name !== 'string') {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!slug || typeof slug !== 'string' || !slug.match(/^[a-z0-9-]+$/)) {
      return Response.json({ error: 'Valid slug is required (lowercase, alphanumeric, hyphens)' }, { status: 400 });
    }

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

    // Create default subscription (trial)
    const subId = `sub_${crypto.randomUUID().replace(/-/g, '')}`;
    await sql`
      INSERT INTO organization_subscriptions (
        id, organization_id, plan_id, status, 
        trial_ends_at
      ) VALUES (
        ${subId}, ${orgId}, 'plan_starter', 'trial',
        ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()}
      )
    `;

    return Response.json({ 
      id: orgId, 
      name, 
      slug,
      role: 'OWNER',
      subscription: { status: 'trial' }
    }, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes('duplicate key')) {
      return Response.json({ error: 'Slug already exists' }, { status: 409 });
    }
    console.error('POST /api/organizations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}