import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

/**
 * Single conversation thread for a lead, including the full message history.
 */
export async function GET(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { leadId } = await params;
    const id = Number(leadId);
    if (!Number.isInteger(id)) {
      return Response.json({ error: 'Invalid lead id' }, { status: 400 });
    }

    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    // Bug #35 (IDOR): previously had no org filter at all — any authenticated
    // user could read any other org's lead conversation by guessing a
    // sequential lead id.
    const [conv] = await sql`
      SELECT
        c.id,
        c.lead_id,
        c.channel,
        c.status,
        c.requires_human,
        c.history,
        c.last_message_at,
        l.name AS lead_name,
        l.phone AS lead_phone,
        l.type AS lead_type
      FROM ai_conversations c
      JOIN leads l ON l.id = c.lead_id
      WHERE c.lead_id = ${id} AND l.organization_id = ${organization.id}
      LIMIT 1
    `;

    if (!conv) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return Response.json(conv);
  } catch (error: any) {
    console.error('GET /api/conversations/[leadId] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
