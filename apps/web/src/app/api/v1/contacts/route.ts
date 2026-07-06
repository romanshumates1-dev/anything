import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { authenticateApiKey, checkScope } from '../auth/utils';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;

  try {
    const organizationId = authResult.organizationId!;
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
    const offset = Number(searchParams.get('offset')) || 0;

    const contacts = await sql`
      SELECT id, name, phone, email, status, metadata, source, created_at, updated_at
      FROM leads
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return NextResponse.json({ data: contacts, limit, offset });
  } catch (error: any) {
    console.error('GET /api/v1/contacts error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;
  if (!checkScope(authResult.scopes, 'write:campaigns')) {
    return NextResponse.json({ error: 'Forbidden - missing scope write:campaigns' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, phone, email, type = 'seller', metadata = {} } = body as {
      name: string;
      phone: string;
      email?: string;
      type?: 'seller' | 'buyer';
      metadata?: Record<string, any>;
    };

    if (!name || !phone) return NextResponse.json({ error: 'name and phone required' }, { status: 400 });

    const organizationId = authResult.organizationId!;
    const [contact] = await sql`
      INSERT INTO leads (id, organization_id, name, phone, email, type, metadata)
      VALUES (gen_random_uuid()::text, ${organizationId}, ${name}, ${phone}, ${email || null}, ${type}, ${metadata})
      RETURNING *
    `;

    return NextResponse.json(contact, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/v1/contacts error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}