/**
 * POST /api/outreach/verify/email/dns
 *
 * Start email verification process:
 * 1. Validate credentials
 * 2. Generate DNS records (SPF, DKIM, DMARC)
 * 3. Return records for user to add to their domain
 */

import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import {
  startEmailVerification,
  EmailCredentials,
  EmailProvider,
} from '@/app/api/utils/outreachVerification';
import { logEvent } from '@/app/api/utils/logger';

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { provider, credentials, domain, fromAddress, fromName } = body;

    // Validate required fields
    if (!provider) {
      return Response.json({ error: 'Provider is required' }, { status: 400 });
    }

    if (!fromAddress) {
      return Response.json({ error: 'From email address is required' }, { status: 400 });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
      return Response.json({ error: 'Invalid email address format' }, { status: 400 });
    }

    // Extract domain from fromAddress if not provided
    const emailDomain = domain || fromAddress.split('@')[1];

    // Validate provider-specific credentials
    if (provider === 'aws_ses') {
      if (!credentials?.awsAccessKeyId || !credentials?.awsSecretAccessKey) {
        return Response.json(
          { error: 'AWS Access Key ID and Secret Access Key are required' },
          { status: 400 }
        );
      }
    }

    if (provider === 'smtp') {
      if (!credentials?.smtpHost || !credentials?.smtpUser || !credentials?.smtpPass) {
        return Response.json(
          { error: 'SMTP host, username, and password are required' },
          { status: 400 }
        );
      }
    }

    if (provider === 'sendgrid' || provider === 'resend') {
      if (!credentials?.apiKey) {
        return Response.json({ error: 'API key is required' }, { status: 400 });
      }
    }

    // Validate credentials by attempting a connection test
    if (provider !== 'platform') {
      const testResult = await testEmailCredentials(provider, credentials, fromAddress);
      if (!testResult.success) {
        return Response.json(
          {
            error: 'credentials_invalid',
            message: testResult.error || 'Failed to validate email credentials',
          },
          { status: 400 }
        );
      }
    }

    // Start verification process
    const result = await startEmailVerification(
      organization.id,
      provider as EmailProvider,
      credentials || {},
      emailDomain,
      fromAddress,
      fromName,
      session.userId
    );

    await logEvent(
      'email_verification_started',
      'outreach_verification',
      organization.id,
      { provider, domain: emailDomain, status: result.status },
      session.userId
    );

    return Response.json(result);
  } catch (error: any) {
    console.error('[Email DNS Start] Error:', error);
    return Response.json(
      { error: 'Failed to start email verification', message: error.message },
      { status: 500 }
    );
  }
}

// Test email credentials before starting verification
async function testEmailCredentials(
  provider: EmailProvider,
  credentials: EmailCredentials,
  fromAddress: string
): Promise<{ success: boolean; error?: string }> {
  if (provider === 'platform') {
    return { success: true };
  }

  if (provider === 'aws_ses') {
    try {
      const { SESClient, GetIdentityVerificationAttributesCommand } = await import('@aws-sdk/client-ses');

      const sesClient = new SESClient({
        region: credentials.awsRegion || 'us-east-1',
        credentials: {
          accessKeyId: credentials.awsAccessKeyId!,
          secretAccessKey: credentials.awsSecretAccessKey!,
        },
      });

      // Test by checking if the from address is verified in SES
      const domain = fromAddress.split('@')[1];
      await sesClient.send(
        new GetIdentityVerificationAttributesCommand({
          Identities: [domain, fromAddress],
        })
      );

      return { success: true };
    } catch (error: any) {
      console.error('[Email Test] AWS SES error:', error);
      return {
        success: false,
        error: error.message?.includes('credentials')
          ? 'Invalid AWS credentials'
          : 'Failed to connect to AWS SES',
      };
    }
  }

  if (provider === 'smtp') {
    try {
      const nodemailer = await import('nodemailer');

      const transporter = nodemailer.createTransport({
        host: credentials.smtpHost,
        port: credentials.smtpPort ? parseInt(credentials.smtpPort.toString(), 10) : 587,
        secure: credentials.smtpEncryption === 'ssl',
        auth: {
          user: credentials.smtpUser,
          pass: credentials.smtpPass,
        },
      });

      // Verify connection
      await transporter.verify();
      return { success: true };
    } catch (error: any) {
      console.error('[Email Test] SMTP error:', error);
      return {
        success: false,
        error: error.message?.includes('auth')
          ? 'Invalid SMTP credentials'
          : 'Failed to connect to SMTP server',
      };
    }
  }

  if (provider === 'sendgrid') {
    try {
      // Test SendGrid API key
      const res = await fetch('https://api.sendgrid.com/v3/scopes', {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
        },
      });

      if (!res.ok) {
        return { success: false, error: 'Invalid SendGrid API key' };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: 'Failed to validate SendGrid credentials' };
    }
  }

  if (provider === 'resend') {
    try {
      // Test Resend API key
      const res = await fetch('https://api.resend.com/domains', {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
        },
      });

      if (!res.ok) {
        return { success: false, error: 'Invalid Resend API key' };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: 'Failed to validate Resend credentials' };
    }
  }

  return { success: true };
}
