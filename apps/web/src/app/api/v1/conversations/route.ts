import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { authenticateApiKey, checkScope } from '../auth/utils';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;
  if (!checkScope(authResult.scopes, 'read:conversations')) {
    return NextResponse.json({ error: 'Forbidden - missing scope read:conversations' }, { status: 403 });
  }

  try {
    const organizationId = authResult.organizationId!;
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
    const offset = Number(searchParams.get('offset')) || 0;

    const conversations = await sql`
      SELECT 
        ac.id, ac.lead_id, ac.channel, ac.status, ac.confidence_score, ac.requires_human,
        ac.last_message_at, ac.created_at,
        l.name as lead_name, l.phone as lead_phone,
        (SELECT history->-1->>'text' FROM ai_conversations WHERE id = ac.id) as last_message
      FROM ai_conversations ac
      LEFT JOIN leads l ON l.id = ac.lead_id
      WHERE l.organization_id = ${organizationId}
      ORDER BY ac.last_message_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return NextResponse.json({ data: conversations, limit, offset });
  } catch (error: any) {
    console.error('GET /api/v1/conversations error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}