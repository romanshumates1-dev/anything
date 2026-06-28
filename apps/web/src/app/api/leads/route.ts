import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../utils/logger';

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
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
      INSERT INTO leads (name, type, email, phone, metadata, source)
      VALUES (${name}, ${type}, ${email || null}, ${phone || null}, ${JSON.stringify(metadata || {})}, ${source || 'direct'})
      RETURNING *
    `;

    await logEvent('lead_created', 'lead', lead.id.toString(), { type }, session.user.id);

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
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    let query = `SELECT * FROM leads WHERE 1=1`;
    const params: any[] = [];

    if (type) {
      params.push(type);
      query += ` AND type = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT 100`;

    const leads = await sql(query, params);
    return Response.json(leads);
  } catch (error: any) {
    console.error('GET /api/leads error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
