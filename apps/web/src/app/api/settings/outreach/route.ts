/**
 * Outreach configuration API - GET/PUT email and SMS settings.
 *
 * Settings are stored in app_settings with key 'outreach_config'.
 * Sensitive credentials are encrypted before storage.
 */
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const SETTINGS_KEY = 'outreach_config';
const ENCRYPTION_KEY = process.env.OUTREACH_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET || 'dev-key-32-chars-exactly-here!!';

// Ensure key is 32 bytes for AES-256
function getEncryptionKey(): Buffer {
  const key = ENCRYPTION_KEY;
  if (key.length >= 32) {
    return Buffer.from(key.slice(0, 32));
  }
  return Buffer.from(key.padEnd(32, '0'));
}

function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text: string): string {
  try {
    const [ivHex, encrypted] = text.split(':');
    if (!ivHex || !encrypted) return text;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return text;
  }
}

// Sensitive fields that should be encrypted
const SENSITIVE_EMAIL_FIELDS = ['awsSecretAccessKey', 'smtpPass', 'apiKey'];
const SENSITIVE_SMS_FIELDS = ['awsSecretAccessKey', 'twilioAuthToken'];

interface OutreachConfig {
  email?: {
    provider: string;
    configured: boolean;
    verified: boolean;
    fromAddress?: string;
    fromName?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsRegion?: string;
    smtpHost?: string;
    smtpPort?: string;
    smtpUser?: string;
    smtpPass?: string;
    smtpEncryption?: string;
    apiKey?: string;
    lastTestedAt?: string;
  };
  sms?: {
    provider: string;
    configured: boolean;
    phoneNumber?: string;
    tcpaAgreed: boolean;
    tcpaAgreedAt?: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioPhoneNumber?: string;
    twilioMessagingServiceSid?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsRegion?: string;
  };
}

function encryptSensitiveFields(config: OutreachConfig): OutreachConfig {
  const encrypted = { ...config };

  if (encrypted.email) {
    encrypted.email = { ...encrypted.email };
    for (const field of SENSITIVE_EMAIL_FIELDS) {
      const value = (encrypted.email as Record<string, unknown>)[field];
      if (typeof value === 'string' && value && !value.includes(':')) {
        (encrypted.email as Record<string, unknown>)[field] = encrypt(value);
      }
    }
  }

  if (encrypted.sms) {
    encrypted.sms = { ...encrypted.sms };
    for (const field of SENSITIVE_SMS_FIELDS) {
      const value = (encrypted.sms as Record<string, unknown>)[field];
      if (typeof value === 'string' && value && !value.includes(':')) {
        (encrypted.sms as Record<string, unknown>)[field] = encrypt(value);
      }
    }
  }

  return encrypted;
}

function decryptSensitiveFields(config: OutreachConfig): OutreachConfig {
  const decrypted = { ...config };

  if (decrypted.email) {
    decrypted.email = { ...decrypted.email };
    for (const field of SENSITIVE_EMAIL_FIELDS) {
      const value = (decrypted.email as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.includes(':')) {
        (decrypted.email as Record<string, unknown>)[field] = decrypt(value);
      }
    }
  }

  if (decrypted.sms) {
    decrypted.sms = { ...decrypted.sms };
    for (const field of SENSITIVE_SMS_FIELDS) {
      const value = (decrypted.sms as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.includes(':')) {
        (decrypted.sms as Record<string, unknown>)[field] = decrypt(value);
      }
    }
  }

  return decrypted;
}

// Mask sensitive fields for API response (hide actual values)
function maskSensitiveFields(config: OutreachConfig): OutreachConfig {
  const masked = { ...config };

  if (masked.email) {
    masked.email = { ...masked.email };
    for (const field of SENSITIVE_EMAIL_FIELDS) {
      const value = (masked.email as Record<string, unknown>)[field];
      if (typeof value === 'string' && value) {
        (masked.email as Record<string, unknown>)[field] = '********';
      }
    }
  }

  if (masked.sms) {
    masked.sms = { ...masked.sms };
    for (const field of SENSITIVE_SMS_FIELDS) {
      const value = (masked.sms as Record<string, unknown>)[field];
      if (typeof value === 'string' && value) {
        (masked.sms as Record<string, unknown>)[field] = '********';
      }
    }
  }

  return masked;
}

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [row] = await sql`
      SELECT value FROM app_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
    `;

    if (!row?.value) {
      // Return defaults
      return Response.json({
        email: { provider: 'none', configured: false, verified: false },
        sms: { provider: 'none', configured: false, tcpaAgreed: false },
      });
    }

    const config = row.value as OutreachConfig;
    const decrypted = decryptSensitiveFields(config);
    const masked = maskSensitiveFields(decrypted);

    return Response.json(masked);
  } catch (error: any) {
    console.error('[OutreachConfig] GET error:', error);
    return Response.json({ error: 'Failed to load configuration' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Load existing config to merge
    const [existingRow] = await sql`
      SELECT value FROM app_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
    `;

    const existingConfig = existingRow?.value
      ? decryptSensitiveFields(existingRow.value as OutreachConfig)
      : { email: undefined, sms: undefined };

    // Merge new values with existing (preserving unmodified sensitive fields)
    const mergedConfig: OutreachConfig = { ...existingConfig };

    if (body.email) {
      mergedConfig.email = { ...existingConfig.email, ...body.email };
      // If a sensitive field is '********', keep the existing value
      for (const field of SENSITIVE_EMAIL_FIELDS) {
        if ((body.email as Record<string, unknown>)[field] === '********') {
          (mergedConfig.email as Record<string, unknown>)[field] =
            (existingConfig.email as Record<string, unknown> | undefined)?.[field];
        }
      }
    }

    if (body.sms) {
      mergedConfig.sms = { ...existingConfig.sms, ...body.sms };
      // If a sensitive field is '********', keep the existing value
      for (const field of SENSITIVE_SMS_FIELDS) {
        if ((body.sms as Record<string, unknown>)[field] === '********') {
          (mergedConfig.sms as Record<string, unknown>)[field] =
            (existingConfig.sms as Record<string, unknown> | undefined)?.[field];
        }
      }
    }

    // Encrypt before storing
    const encrypted = encryptSensitiveFields(mergedConfig);

    await sql`
      INSERT INTO app_settings (key, value, updated_by, updated_at)
      VALUES (${SETTINGS_KEY}, ${JSON.stringify(encrypted)}, ${session.userId}, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    `;

    // Log the change
    await logEvent(
      'outreach_config_updated',
      'app_setting',
      SETTINGS_KEY,
      {
        emailProvider: mergedConfig.email?.provider,
        smsProvider: mergedConfig.sms?.provider,
        emailConfigured: mergedConfig.email?.configured,
        smsConfigured: mergedConfig.sms?.configured,
      },
      session.userId
    );

    const masked = maskSensitiveFields(mergedConfig);
    return Response.json(masked);
  } catch (error: any) {
    console.error('[OutreachConfig] PUT error:', error);
    return Response.json({ error: 'Failed to save configuration' }, { status: 500 });
  }
}
