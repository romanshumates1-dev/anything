/**
 * Test email sending endpoint.
 *
 * Sends a test email using the provided configuration to verify it works.
 * Does not save the configuration - just tests it.
 */
import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
// Rate limiting is done via audit_logs for test-specific daily limits
import sql from '@/app/api/utils/sql';

interface TestEmailRequest {
  to: string;
  config: {
    provider: 'platform' | 'ses' | 'smtp' | 'sendgrid' | 'resend';
    fromAddress: string;
    fromName?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsRegion?: string;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    smtpEncryption?: 'tls' | 'ssl' | 'none';
    apiKey?: string;
  };
}

async function sendTestWithSES(config: TestEmailRequest['config'], to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');

    const client = new SESClient({
      region: config.awsRegion || 'us-east-1',
      credentials: {
        accessKeyId: config.awsAccessKeyId!,
        secretAccessKey: config.awsSecretAccessKey!,
      },
    });

    const fromField = config.fromName
      ? `${config.fromName} <${config.fromAddress}>`
      : config.fromAddress;

    const command = new SendEmailCommand({
      Source: fromField,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: 'DealFlow AI - Test Email' },
        Body: {
          Text: { Data: 'This is a test email from DealFlow AI. If you received this, your email configuration is working correctly!' },
          Html: {
            Data: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #3B82F6;">DealFlow AI - Test Email</h2>
                <p style="color: #334155; font-size: 16px;">
                  This is a test email from DealFlow AI.
                </p>
                <p style="color: #64748B; font-size: 14px;">
                  If you received this message, your email configuration is working correctly!
                </p>
                <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
                <p style="color: #94A3B8; font-size: 12px;">
                  Sent via Amazon SES from DealFlow AI
                </p>
              </div>
            `,
          },
        },
      },
    });

    const response = await client.send(command);
    return { success: true, messageId: response.MessageId };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function sendTestWithSMTP(config: TestEmailRequest['config'], to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const nodemailer = await import('nodemailer');

    const transporter = nodemailer.default.createTransport({
      host: config.smtpHost,
      port: parseInt(config.smtpPort || '587'),
      secure: config.smtpEncryption === 'ssl' || config.smtpPort === '465',
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
      ...(config.smtpEncryption === 'tls' ? { requireTLS: true } : {}),
    });

    const fromField = config.fromName
      ? `${config.fromName} <${config.fromAddress}>`
      : config.fromAddress;

    const info = await transporter.sendMail({
      from: fromField,
      to,
      subject: 'DealFlow AI - Test Email',
      text: 'This is a test email from DealFlow AI. If you received this, your email configuration is working correctly!',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #3B82F6;">DealFlow AI - Test Email</h2>
          <p style="color: #334155; font-size: 16px;">
            This is a test email from DealFlow AI.
          </p>
          <p style="color: #64748B; font-size: 14px;">
            If you received this message, your email configuration is working correctly!
          </p>
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
          <p style="color: #94A3B8; font-size: 12px;">
            Sent via SMTP from DealFlow AI
          </p>
        </div>
      `,
    });

    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function sendTestWithSendGrid(config: TestEmailRequest['config'], to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const fromField = config.fromName
      ? { email: config.fromAddress, name: config.fromName }
      : { email: config.fromAddress };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: fromField,
        subject: 'DealFlow AI - Test Email',
        content: [
          {
            type: 'text/plain',
            value: 'This is a test email from DealFlow AI. If you received this, your email configuration is working correctly!',
          },
          {
            type: 'text/html',
            value: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #3B82F6;">DealFlow AI - Test Email</h2>
                <p style="color: #334155; font-size: 16px;">
                  This is a test email from DealFlow AI.
                </p>
                <p style="color: #64748B; font-size: 14px;">
                  If you received this message, your email configuration is working correctly!
                </p>
                <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
                <p style="color: #94A3B8; font-size: 12px;">
                  Sent via SendGrid from DealFlow AI
                </p>
              </div>
            `,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `SendGrid error: ${response.status} - ${error}` };
    }

    const messageId = response.headers.get('x-message-id') || `sg_${Date.now()}`;
    return { success: true, messageId };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function sendTestWithResend(config: TestEmailRequest['config'], to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const fromField = config.fromName
      ? `${config.fromName} <${config.fromAddress}>`
      : config.fromAddress;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromField,
        to,
        subject: 'DealFlow AI - Test Email',
        text: 'This is a test email from DealFlow AI. If you received this, your email configuration is working correctly!',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #3B82F6;">DealFlow AI - Test Email</h2>
            <p style="color: #334155; font-size: 16px;">
              This is a test email from DealFlow AI.
            </p>
            <p style="color: #64748B; font-size: 14px;">
              If you received this message, your email configuration is working correctly!
            </p>
            <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
            <p style="color: #94A3B8; font-size: 12px;">
              Sent via Resend from DealFlow AI
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Resend error: ${response.status} - ${error}` };
    }

    const data = await response.json();
    return { success: true, messageId: data.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function sendTestWithPlatform(config: TestEmailRequest['config'], to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Platform email uses the environment-configured provider
  // For now, simulate success in development or use existing driver
  try {
    const { send } = await import('@/app/api/services/emailDriver');

    const fromField = config.fromName
      ? `${config.fromName} <${config.fromAddress}>`
      : config.fromAddress;

    // Use a dummy contactId for test emails
    const result = await send({
      to,
      from: fromField,
      subject: 'DealFlow AI - Test Email',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #3B82F6;">DealFlow AI - Test Email</h2>
          <p style="color: #334155; font-size: 16px;">
            This is a test email from DealFlow AI.
          </p>
          <p style="color: #64748B; font-size: 14px;">
            If you received this message, your email configuration is working correctly!
          </p>
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 20px 0;" />
          <p style="color: #94A3B8; font-size: 12px;">
            Sent via Platform Email from DealFlow AI
          </p>
        </div>
      `,
      contactId: 'test-email',
    });

    if (result.status === 'sent') {
      return { success: true, messageId: result.providerMessageId };
    }
    return { success: false, error: result.errorMessage || 'Failed to send' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

const TEST_EMAIL_LIMIT_PER_DAY = 10;

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'Organization not found' }, { status: 403 });
  }

  // Rate limit: 10 test emails per user per day
  const [todayCount] = await sql`
    SELECT COUNT(*) as count FROM audit_logs
    WHERE user_id = ${session.userId}
      AND action = 'outreach_email_test'
      AND created_at > NOW() - INTERVAL '24 hours'
  `;
  if (Number(todayCount?.count || 0) >= TEST_EMAIL_LIMIT_PER_DAY) {
    return Response.json(
      { error: `Test email limit reached (${TEST_EMAIL_LIMIT_PER_DAY}/day). Try again tomorrow.` },
      { status: 429 }
    );
  }

  try {
    const body = await request.json() as TestEmailRequest;

    if (!body.to || !body.config) {
      return Response.json({ error: 'Missing required fields: to, config' }, { status: 400 });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.to)) {
      return Response.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const { config, to } = body;
    let result: { success: boolean; messageId?: string; error?: string };

    switch (config.provider) {
      case 'ses':
        if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
          return Response.json({ error: 'AWS credentials are required for SES' }, { status: 400 });
        }
        result = await sendTestWithSES(config, to);
        break;

      case 'smtp':
        if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
          return Response.json({ error: 'SMTP credentials are required' }, { status: 400 });
        }
        result = await sendTestWithSMTP(config, to);
        break;

      case 'sendgrid':
        if (!config.apiKey) {
          return Response.json({ error: 'SendGrid API key is required' }, { status: 400 });
        }
        result = await sendTestWithSendGrid(config, to);
        break;

      case 'resend':
        if (!config.apiKey) {
          return Response.json({ error: 'Resend API key is required' }, { status: 400 });
        }
        result = await sendTestWithResend(config, to);
        break;

      case 'platform':
      default:
        result = await sendTestWithPlatform(config, to);
        break;
    }

    // Log the test
    await logEvent(
      'outreach_email_test',
      'user',
      session.userId,
      {
        provider: config.provider,
        to: to.replace(/(.{2}).*@/, '$1***@'),
        success: result.success,
        error: result.error,
      },
      session.userId
    );

    if (!result.success) {
      return Response.json({ error: result.error || 'Failed to send test email' }, { status: 400 });
    }

    return Response.json({
      success: true,
      messageId: result.messageId,
      message: 'Test email sent successfully',
    });
  } catch (error: any) {
    console.error('[EmailTest] Error:', error);
    return Response.json({ error: error.message || 'Failed to send test email' }, { status: 500 });
  }
}
