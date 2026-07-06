import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const key = typeof body.key === 'string' ? body.key.trim() : '';
    if (!key) return NextResponse.json({ error: 'API key required' }, { status: 400 });

    const keyHash = hashKey(key);
    const prefix = key.split('_').slice(0, 2).join('_') + '_';

    const [record] = await sql`
      SELECT id, organization_id, name, scopes, rate_limit_per_min, revoked
      FROM api_keys
      WHERE key_hash = ${keyHash} AND prefix = ${prefix} AND revoked = false
      LIMIT 1
    `;

    if (!record) return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });

    // Update last used
    await sql`UPDATE api_keys SET last_used_at = now(), usage_count = usage_count + 1 WHERE id = ${record.id}`;

    return NextResponse.json({
      valid: true,
      organizationId: record.organization_id,
      scopes: record.scopes,
      rateLimitPerMin: record.rate_limit_per_min,
    });
  } catch (error: any) {
    console.error('POST /api/v1/auth error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}