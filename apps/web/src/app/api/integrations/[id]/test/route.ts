/**
 * Integration Connection Test API
 *
 * POST /api/integrations/[id]/test - test connection for an integration
 *
 * Tests the credentials by making a lightweight API call to the provider.
 * Updates the integration status based on the result.
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { safeDecrypt } from '@/app/api/utils/encryption';

interface IntegrationConfig {
  accountSid_encrypted?: string;
  authToken_encrypted?: string;
  apiKey_encrypted?: string;
  accessKeyId_encrypted?: string;
  secretAccessKey_encrypted?: string;
  secretKey_encrypted?: string;
  publishableKey?: string;
  webhookSecret_encrypted?: string;
  region?: string;
  messagingServiceSid?: string;
}

interface TestResult {
  success: boolean;
  message: string;
  details?: Record<string, any>;
}

async function testTwilioConnection(config: IntegrationConfig): Promise<TestResult> {
  const accountSid = safeDecrypt(config.accountSid_encrypted);
  const authToken = safeDecrypt(config.authToken_encrypted);

  if (!accountSid || !authToken) {
    return { success: false, message: 'Missing Twilio credentials' };
  }

  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: 'Twilio connection successful',
        details: {
          friendlyName: data.friendly_name,
          status: data.status,
          type: data.type,
        },
      };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      message: errorData.message || `Twilio API error: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to connect to Twilio',
    };
  }
}

async function testSendGridConnection(config: IntegrationConfig): Promise<TestResult> {
  const apiKey = safeDecrypt(config.apiKey_encrypted);

  if (!apiKey) {
    return { success: false, message: 'Missing SendGrid API key' };
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: 'SendGrid connection successful',
        details: {
          firstName: data.first_name,
          lastName: data.last_name,
          company: data.company,
        },
      };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      message: errorData.errors?.[0]?.message || `SendGrid API error: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to connect to SendGrid',
    };
  }
}

async function testResendConnection(config: IntegrationConfig): Promise<TestResult> {
  const apiKey = safeDecrypt(config.apiKey_encrypted);

  if (!apiKey) {
    return { success: false, message: 'Missing Resend API key' };
  }

  try {
    const response = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: 'Resend connection successful',
        details: {
          domainsCount: data.data?.length || 0,
        },
      };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      message: errorData.message || `Resend API error: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to connect to Resend',
    };
  }
}

async function testSESConnection(config: IntegrationConfig): Promise<TestResult> {
  const accessKeyId = safeDecrypt(config.accessKeyId_encrypted);
  const secretAccessKey = safeDecrypt(config.secretAccessKey_encrypted);
  const region = config.region || 'us-east-1';

  if (!accessKeyId || !secretAccessKey) {
    return { success: false, message: 'Missing AWS SES credentials' };
  }

  // SES requires AWS Signature v4 for proper authentication
  // This validates configuration - actual connection test happens on first send
  // In production, integrate with @aws-sdk/client-ses GetSendQuota
  return {
    success: true,
    message: 'SES configuration stored. Connection will be verified on first send.',
    details: {
      region,
      endpoint: `https://email.${region}.amazonaws.com`,
      note: 'Credentials will be validated when sending emails',
    },
  };
}

async function testStripeConnection(config: IntegrationConfig): Promise<TestResult> {
  const secretKey = safeDecrypt(config.secretKey_encrypted);

  if (!secretKey) {
    return { success: false, message: 'Missing Stripe secret key' };
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: 'Stripe connection successful',
        details: {
          livemode: data.livemode,
          availableBalance: data.available?.[0]?.amount || 0,
          currency: data.available?.[0]?.currency || 'usd',
        },
      };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      message: errorData.error?.message || `Stripe API error: ${response.status}`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to connect to Stripe',
    };
  }
}

export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await props.params;
    const orgId = session.user.id;

    // Fetch the integration
    const [integration] = await sql`
      SELECT id, provider, config, status
      FROM integrations
      WHERE id = ${id} AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!integration) {
      return Response.json({ error: 'Integration not found' }, { status: 404 });
    }

    const config = integration.config as IntegrationConfig;
    let result: TestResult;

    // Test based on provider
    switch (integration.provider) {
      case 'twilio':
        result = await testTwilioConnection(config);
        break;
      case 'sendgrid':
        result = await testSendGridConnection(config);
        break;
      case 'resend':
        result = await testResendConnection(config);
        break;
      case 'ses':
        result = await testSESConnection(config);
        break;
      case 'stripe':
        result = await testStripeConnection(config);
        break;
      default:
        result = { success: false, message: `Unknown provider: ${integration.provider}` };
    }

    // Update integration status
    const newStatus = result.success ? 'active' : 'error';
    const errorMessage = result.success ? null : result.message;

    await sql`
      UPDATE integrations
      SET status = ${newStatus},
          last_checked = now(),
          error_message = ${errorMessage},
          updated_at = now()
      WHERE id = ${id} AND organization_id = ${orgId}
    `;

    await logEvent(
      result.success ? 'integration_test_success' : 'integration_test_failed',
      'integration',
      id,
      { provider: integration.provider, message: result.message },
      orgId
    );

    return Response.json({
      success: result.success,
      provider: integration.provider,
      status: newStatus,
      message: result.message,
      details: result.details,
      testedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('POST /api/integrations/[id]/test error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
