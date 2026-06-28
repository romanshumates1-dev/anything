import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * Inbox list: one row per conversation with a last-message preview.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await sql`
      SELECT
        c.id,
        c.lead_id,
        c.channel,
        c.status,
        c.requires_human,
        c.last_message_at,
        l.name AS lead_name,
        l.phone AS lead_phone,
        (c.history -> -1 ->> 'content') AS last_message
      FROM ai_conversations c
      JOIN leads l ON l.id = c.lead_id
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT 100
    `;
    return Response.json(rows);
  } catch (error: any) {
    console.error('GET /api/conversations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
