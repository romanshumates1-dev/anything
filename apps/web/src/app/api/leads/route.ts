import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../utils/logger';
import { getOrganization } from '@/lib/organization-context';
import { recordStageTransition } from '@/app/api/services/stageTransitionRecorder';

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get organization context for multi-tenant isolation
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, email, phone, metadata, source } = body;

    // Production Validation
    if (!name || !type) {
      return Response.json({ error: 'Name and Type are required' }, { status: 400 });
    }

    if (!['seller', 'buyer'].includes(type)) {
      return Response.json({ error: 'Invalid lead type' }, { status: 400 });
    }

    const [lead] = await sql`
      INSERT INTO leads (name, type, email, phone, metadata, source, organization_id)
      VALUES (${name}, ${type}, ${email || null}, ${phone || null}, ${JSON.stringify(metadata || {})}, ${source || 'direct'}, ${organization.id})
      RETURNING *
    `;

    await logEvent('lead_created', 'lead', lead.id.toString(), { type, organization_id: organization.id }, session.user.id);

    // Funnel analytics (P4): every new lead enters the funnel at NEW.
    // Best-effort — recordStageTransition never throws, so this can never
    // fail the actual lead-creation response.
    await recordStageTransition({ leadId: lead.id, fromStage: null, toStage: 'NEW', channel: 'system' });

    return Response.json(lead);
  } catch (error: any) {
    console.error('POST /api/leads error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get organization context for multi-tenant isolation
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    // Validate type/status params to prevent SQL injection
    const validTypes = ['seller', 'buyer'];
    const validStatuses = ['new', 'contacted', 'qualified', 'negotiating', 'closed', 'lost'];

    const safeType = type && validTypes.includes(type) ? type : null;
    const safeStatus = status && validStatuses.includes(status) ? status : null;

    // Use parameterized queries with tagged template literals for SQL injection safety
    const leads = await sql`
      SELECT * FROM leads
      WHERE organization_id = ${organization.id}
        AND (${safeType}::text IS NULL OR type = ${safeType})
        AND (${safeStatus}::text IS NULL OR status = ${safeStatus})
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return Response.json(leads);
  } catch (error: any) {
    console.error('GET /api/leads error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}