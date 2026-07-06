import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';
import { authenticateApiKey, checkScope } from '../auth/utils';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;

  try {
    const organizationId = authResult.organizationId!;
    const webhooks = await sql`
      SELECT id, url, events, active, last_delivery_at, created_at
      FROM webhooks
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ data: webhooks });
  } catch (error: any) {
    console.error('GET /api/v1/webhooks error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;

  try {
    const body = await request.json();
    const { url, events = [] } = body as { url: string; events: string[] };

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    const organizationId = authResult.organizationId!;
    const secret = crypto.randomBytes(16).toString('hex');

    const [webhook] = await sql`
      INSERT INTO webhooks (id, organization_id, url, secret, events)
      VALUES (gen_random_uuid()::text, ${organizationId}, ${url}, ${secret}, ${events})
      RETURNING id, url, events, active, last_delivery_at, created_at
    `;

    return NextResponse.json({ ...webhook, secret }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/v1/webhooks error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}