import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';
import { hasRequiredRole, isEmailDomainAllowed } from '@/app/api/utils/access-control';

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
      SELECT k.id, k.organization_id, k.scopes, k.revoked, k.rate_limit_per_min, k.usage_count,
             u.email AS owner_email, u.role AS owner_role
      FROM api_keys k
      LEFT JOIN "user" u ON u.id = k.created_by
      WHERE k.key_hash = ${keyHash} AND k.prefix = ${prefix}
      LIMIT 1
    `;

    if (!record || record.revoked) {
      return { valid: false, response: NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 }) };
    }

    // Domain lock, layer 4: a key is only VALID while its owning user exists,
    // is on an allowed email domain, and meets MIN_ACCESS_ROLE. Enforced here
    // at the route level independently of the middleware check, so neither
    // layer alone is a single point of bypass.
    if (
      !record.owner_email ||
      !isEmailDomainAllowed(record.owner_email) ||
      !hasRequiredRole(record.owner_role)
    ) {
      return {
        valid: false,
        response: NextResponse.json({ error: 'API key owner is not authorized' }, { status: 403 }),
      };
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