import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import crypto from 'crypto';

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateKey(prefix: 'df_live_' | 'df_test_'): string {
  const raw = prefix + crypto.randomBytes(24).toString('base64url');
  return raw;
}

function maskKey(key: string): { prefix: string; last4: string } {
  const parts = key.split('_');
  const prefix = parts.slice(0, 2).join('_') + '_';
  const last4 = key.slice(-4);
  return { prefix, last4 };
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const orgId = session.user.id;
    const keys = await sql`
      SELECT id, name, prefix, scopes, rate_limit_per_min, last_used_at, usage_count, revoked, created_at
      FROM api_keys
      WHERE organization_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return Response.json(keys);
  } catch (error: any) {
    console.error('GET /api/settings/api-keys error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s: any) => typeof s === 'string') : [];
    const prefix = body.test ? 'df_test_' : 'df_live_';

    if (!name) return Response.json({ error: 'Name is required' }, { status: 400 });

    const orgId = session.user.id;
    const rawKey = generateKey(prefix);
    const keyHash = hashKey(rawKey);
    const { prefix: maskedPrefix, last4 } = maskKey(rawKey);

    const [key] = await sql`
      INSERT INTO api_keys (id, organization_id, name, key_hash, prefix, scopes, rate_limit_per_min, created_by)
      VALUES (gen_random_uuid()::text, ${orgId}, ${name}, ${keyHash}, ${maskedPrefix}, ${scopes}, 120, ${session.user.id})
      RETURNING id, name, prefix, scopes, rate_limit_per_min, last_used_at, usage_count, revoked, created_at
    `;

    await logEvent('api_key_created', 'api_key', key.id, { name, prefix: maskedPrefix, scopes }, orgId);

    return Response.json({ ...key, key: rawKey });
  } catch (error: any) {
    console.error('POST /api/settings/api-keys error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}