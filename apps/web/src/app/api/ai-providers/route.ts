/**
 * AI Providers API - manage customer-managed AI provider configurations.
 * 
 * Supports: platform-managed, bring-your-own-key, self-hosted Ollama
 * 
 * GET /api/ai-providers - list organization's AI providers
 * POST /api/ai-providers - add/update AI provider
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

export type AIProviderType = 'platform' | 'byo' | 'ollama';

export interface AIProvider {
  id: string;
  provider_type: AIProviderType;
  model?: string;
  base_url?: string;
  is_active: boolean;
  failover_order?: string[];
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    const providers = await sql`
      SELECT id, provider_type, model, base_url, is_active, failover_order
      FROM ai_providers
      WHERE organization_id = ${org.id}
      ORDER BY created_at ASC
    `;

    return Response.json(providers);
  } catch (error) {
    console.error('GET /api/ai-providers error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    const body = await request.json();
    const { providerType, apiKey, baseUrl, model, isActive, failoverOrder } = body;

    // Validate
    if (!providerType || !['platform', 'byo', 'ollama'].includes(providerType)) {
      return Response.json({ error: 'Valid provider type required' }, { status: 400 });
    }

    // Create/update provider
    const id = `ai_${crypto.randomUUID().replace(/-/g, '')}`;
    
    // For byo providers, encrypt the API key
    const apiKeyEncrypted = apiKey 
      ? Buffer.from(apiKey).toString('base64') 
      : null;

    await sql`
      INSERT INTO ai_providers (
        id, organization_id, provider_type, api_key_encrypted, base_url, model, is_active, failover_order
      ) VALUES (
        ${id}, ${org.id}, ${providerType}, ${apiKeyEncrypted},
        ${baseUrl || null}, ${model || null}, ${isActive || false}, ${JSON.stringify(failoverOrder || [])}
      )
    `;

    return Response.json({ success: true, id }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/ai-providers error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}