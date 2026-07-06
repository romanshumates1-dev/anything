import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../utils/logger';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const orgId = session.user.id;
    const lists = await sql`
      SELECT id, name, source_type, consent_mode, total_rows, inserted_rows, duplicate_rows, failed_rows, created_by, created_at
      FROM contact_lists
      WHERE organization_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return Response.json(lists);
  } catch (error: any) {
    console.error('GET /api/contact-lists error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const sourceType = typeof body.source_type === 'string' ? body.source_type : 'csv';
    const consentMode = typeof body.consent_mode === 'string' ? body.consent_mode : 'unverified';

    if (!name) return Response.json({ error: 'Name is required' }, { status: 400 });

    const orgId = session.user.id;
    const [list] = await sql`
      INSERT INTO contact_lists (id, organization_id, name, source_type, consent_mode, created_by)
      VALUES (gen_random_uuid()::text, ${orgId}, ${name}, ${sourceType}, ${consentMode}, ${session.user.id})
      RETURNING *
    `;

    await logEvent('contact_list_created', 'contact_list', list.id, { name, source_type: sourceType, consent_mode: consentMode }, orgId);

    return Response.json(list);
  } catch (error: any) {
    console.error('POST /api/contact-lists error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}