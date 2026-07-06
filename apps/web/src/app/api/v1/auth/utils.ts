import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function authenticateApiKey(request: NextRequest): Promise<{
  valid: boolean;
  organizationId?: string;
  scopes?: string[];
  response?: NextResponse;
}> {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { valid: false, response: NextResponse.json({ error: 'Missing API key' }, { status: 401 }) };
    }

    const key = authHeader.slice(7).trim();
    if (!key) {
      return { valid: false, response: NextResponse.json({ error: 'Invalid API key' }, { status: 401 }) };
    }

    const keyHash = hashKey(key);
    const prefix = key.split('_').slice(0, 2).join('_') + '_';

    const [record] = await sql`
      SELECT id, organization_id, scopes, revoked, rate_limit_per_min, usage_count
      FROM api_keys
      WHERE key_hash = ${keyHash} AND prefix = ${prefix}
      LIMIT 1
    `;

    if (!record || record.revoked) {
      return { valid: false, response: NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 }) };
    }

    // Update last used
    await sql`UPDATE api_keys SET last_used_at = now(), usage_count = usage_count + 1 WHERE id = ${record.id}`;

    return { valid: true, organizationId: record.organization_id, scopes: record.scopes };
  } catch (error: any) {
    console.error('API auth error', error);
    return { valid: false, response: NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }) };
  }
}

export function checkScope(scopes: string[] | undefined, required: string): boolean {
  if (!scopes || scopes.length === 0) return false;
  return scopes.includes(required);
}