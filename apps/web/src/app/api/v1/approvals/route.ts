import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { authenticateApiKey, checkScope } from '../auth/utils';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;
  if (!checkScope(authResult.scopes, 'read:approvals')) {
    return NextResponse.json({ error: 'Forbidden - missing scope read:approvals' }, { status: 403 });
  }

  try {
    const organizationId = authResult.organizationId!;
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
    const offset = Number(searchParams.get('offset')) || 0;
    const status = searchParams.get('status');

    let query = sql`
      SELECT id, type, negotiation_id, contract_id, context, status, requested_at, expires_at, answered_at
      FROM human_approvals
      WHERE organization_id = ${organizationId}
    `;
    if (status) {
      query = sql`WHERE organization_id = ${organizationId} AND status = ${status}`;
    }

    const approvals = await sql`
      SELECT id, type, negotiation_id, contract_id, context, status, requested_at, expires_at, answered_at
      FROM human_approvals
      WHERE organization_id = ${organizationId}
      ORDER BY requested_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return NextResponse.json({ data: approvals, limit, offset });
  } catch (error: any) {
    console.error('GET /api/v1/approvals error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;
  if (!checkScope(authResult.scopes, 'write:approvals')) {
    return NextResponse.json({ error: 'Forbidden - missing scope write:approvals' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { approvalId, action, range } = body as { approvalId: string; action: 'accept' | 'reject' | 'custom'; range?: number };

    if (!approvalId || !action) {
      return NextResponse.json({ error: 'approvalId and action required' }, { status: 400 });
    }

    const organizationId = authResult.organizationId!;
    const [approval] = await sql`
      SELECT * FROM human_approvals WHERE id = ${approvalId} AND organization_id = ${organizationId} LIMIT 1
    `;

    if (!approval) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (action === 'custom' && range) {
      const [updated] = await sql`
        UPDATE human_approvals SET status = 'ANSWERED', resolved_at = now(), context = jsonb_set(context, '{owner_range}', ${range}::text)
        WHERE id = ${approvalId} RETURNING *
      `;
      return NextResponse.json(updated);
    }

    const [updated] = await sql`
      UPDATE human_approvals SET status = 'ANSWERED', resolved_at = now()
      WHERE id = ${approvalId} RETURNING *
    `;

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('POST /api/v1/approvals error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}