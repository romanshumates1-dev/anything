/**
 * Integrations API - manage third-party service connections.
 *
 * Supported providers: twilio, sendgrid, ses, resend, stripe
 * Credentials are encrypted at rest using AES-256-GCM.
 *
 * GET /api/integrations - list all integrations for organization
 * POST /api/integrations - connect new integration
 * DELETE /api/integrations - disconnect integration
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { encryptSensitive } from '@/app/api/utils/encryption';

const VALID_PROVIDERS = ['twilio', 'sendgrid', 'ses', 'resend', 'stripe'] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

interface IntegrationCredentials {
  // Twilio
  accountSid?: string;
  authToken?: string;
  messagingServiceSid?: string;
  // SendGrid / Resend
  apiKey?: string;
  // SES
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  // Stripe
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
}

function isValidProvider(provider: string): provider is Provider {
  return VALID_PROVIDERS.includes(provider as Provider);
}

function validateCredentials(provider: Provider, credentials: IntegrationCredentials): string | null {
  switch (provider) {
    case 'twilio':
      if (!credentials.accountSid || !credentials.authToken) {
        return 'Twilio requires accountSid and authToken';
      }
      break;
    case 'sendgrid':
    case 'resend':
      if (!credentials.apiKey) {
        return `${provider} requires apiKey`;
      }
      break;
    case 'ses':
      if (!credentials.accessKeyId || !credentials.secretAccessKey) {
        return 'SES requires accessKeyId and secretAccessKey';
      }
      break;
    case 'stripe':
      if (!credentials.secretKey) {
        return 'Stripe requires secretKey';
      }
      break;
  }
  return null;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const orgId = session.user.id;

    const integrations = await sql`
      SELECT
        id,
        provider,
        status,
        last_checked,
        error_message,
        config,
        created_at,
        updated_at
      FROM integrations
      WHERE organization_id = ${orgId}
      ORDER BY created_at DESC
    `;

    // Mask sensitive data in config for display
    const safeIntegrations = integrations.map((i: any) => ({
      id: i.id,
      provider: i.provider,
      status: i.status,
      lastChecked: i.last_checked,
      errorMessage: i.error_message,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      // Only show masked hints, never actual credentials
      config: i.config ? {
        hasApiKey: !!i.config.apiKey_encrypted,
        hasAccountSid: !!i.config.accountSid_encrypted,
        hasSecretKey: !!i.config.secretKey_encrypted,
        region: i.config.region,
        messagingServiceSid: i.config.messagingServiceSid,
      } : null,
    }));

    return Response.json({ integrations: safeIntegrations });
  } catch (error) {
    console.error('GET /api/integrations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { provider, credentials } = body as { provider: string; credentials: IntegrationCredentials };

    // Validate provider
    if (!provider || !isValidProvider(provider)) {
      return Response.json(
        { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate credentials
    if (!credentials || typeof credentials !== 'object') {
      return Response.json({ error: 'Credentials are required' }, { status: 400 });
    }

    const validationError = validateCredentials(provider, credentials);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const orgId = session.user.id;

    // Check if integration already exists
    const [existing] = await sql`
      SELECT id FROM integrations
      WHERE organization_id = ${orgId} AND provider = ${provider}
      LIMIT 1
    `;

    // Encrypt sensitive credentials
    const encryptedConfig: Record<string, string> = {};

    if (credentials.accountSid) {
      encryptedConfig.accountSid_encrypted = encryptSensitive(credentials.accountSid);
    }
    if (credentials.authToken) {
      encryptedConfig.authToken_encrypted = encryptSensitive(credentials.authToken);
    }
    if (credentials.apiKey) {
      encryptedConfig.apiKey_encrypted = encryptSensitive(credentials.apiKey);
    }
    if (credentials.accessKeyId) {
      encryptedConfig.accessKeyId_encrypted = encryptSensitive(credentials.accessKeyId);
    }
    if (credentials.secretAccessKey) {
      encryptedConfig.secretAccessKey_encrypted = encryptSensitive(credentials.secretAccessKey);
    }
    if (credentials.secretKey) {
      encryptedConfig.secretKey_encrypted = encryptSensitive(credentials.secretKey);
    }
    if (credentials.publishableKey) {
      encryptedConfig.publishableKey = credentials.publishableKey; // Publishable key is not secret
    }
    if (credentials.webhookSecret) {
      encryptedConfig.webhookSecret_encrypted = encryptSensitive(credentials.webhookSecret);
    }
    // Non-sensitive config
    if (credentials.region) {
      encryptedConfig.region = credentials.region;
    }
    if (credentials.messagingServiceSid) {
      encryptedConfig.messagingServiceSid = credentials.messagingServiceSid;
    }

    const configJson = JSON.stringify(encryptedConfig);

    if (existing) {
      // Update existing integration
      await sql`
        UPDATE integrations
        SET config = ${configJson}::jsonb,
            status = 'pending',
            error_message = NULL,
            updated_at = now()
        WHERE organization_id = ${orgId} AND provider = ${provider}
      `;

      await logEvent('integration_updated', 'integration', existing.id, { provider }, orgId);

      return Response.json({ success: true, updated: true, provider });
    }

    // Create new integration
    const id = `int_${crypto.randomUUID().replace(/-/g, '')}`;

    await sql`
      INSERT INTO integrations (
        id, organization_id, provider, config, status, created_at, updated_at
      ) VALUES (
        ${id}, ${orgId}, ${provider}, ${configJson}::jsonb, 'pending', now(), now()
      )
    `;

    await logEvent('integration_created', 'integration', id, { provider }, orgId);

    return Response.json({ success: true, created: true, id, provider }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/integrations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider');
    const id = searchParams.get('id');

    if (!provider && !id) {
      return Response.json({ error: 'Provider or ID is required' }, { status: 400 });
    }

    const orgId = session.user.id;

    let deleted;
    if (id) {
      [deleted] = await sql`
        DELETE FROM integrations
        WHERE id = ${id} AND organization_id = ${orgId}
        RETURNING id, provider
      `;
    } else {
      [deleted] = await sql`
        DELETE FROM integrations
        WHERE provider = ${provider} AND organization_id = ${orgId}
        RETURNING id, provider
      `;
    }

    if (!deleted) {
      return Response.json({ error: 'Integration not found' }, { status: 404 });
    }

    await logEvent('integration_deleted', 'integration', deleted.id, { provider: deleted.provider }, orgId);

    return Response.json({ success: true, deleted: true, provider: deleted.provider });
  } catch (error) {
    console.error('DELETE /api/integrations error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
