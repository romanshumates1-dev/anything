/**
 * Outreach Verification System
 *
 * Manages verification status for user-provided SMS/Email credentials.
 * Platform providers skip verification; BYOP requires ownership proof.
 *
 * Flow:
 *   SMS: Enter credentials -> Send OTP to their number -> User enters code -> ACTIVE
 *   Email: Enter credentials -> Generate DNS records -> Verify propagation -> ACTIVE
 */

import sql from '@/app/api/utils/sql';
import { encryptSensitive, decryptSensitive, isEncrypted } from '@/app/api/utils/encryption';
import { randomBytes } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type OutreachChannel = 'sms' | 'email';

export type SmsProvider = 'platform' | 'twilio' | 'aws_sns';
export type EmailProvider = 'platform' | 'aws_ses' | 'smtp' | 'sendgrid' | 'resend';

export type VerificationStatus =
  | 'PENDING'
  | 'VERIFYING'
  | 'DNS_PENDING'
  | 'VERIFIED'
  | 'ACTIVE'
  | 'FAILED'
  | 'SUSPENDED'
  | 'EXPIRED';

export interface SmsCredentials {
  // Twilio
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  twilioMessagingServiceSid?: string;
  // AWS SNS
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
}

export interface EmailCredentials {
  // AWS SES
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  // SMTP
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpEncryption?: 'tls' | 'ssl' | 'none';
  // API-based (SendGrid, Resend)
  apiKey?: string;
  // Common
  fromAddress?: string;
  fromName?: string;
}

export interface SmsMetadata {
  phoneNumber: string;
  tcpaAgreed: boolean;
  tcpaAgreedAt?: string;
  messagingServiceSid?: string;
  a2pRegistered?: boolean;
}

export interface EmailMetadata {
  domain: string;
  fromAddress: string;
  fromName?: string;
  spfVerified?: boolean;
  dkimVerified?: boolean;
  dmarcVerified?: boolean;
  dnsRecords?: DnsRecord[];
  lastDnsCheck?: string;
}

export interface DnsRecord {
  type: 'TXT' | 'CNAME' | 'MX';
  name: string;
  value: string;
  verified: boolean;
}

export interface OutreachVerification {
  id: string;
  organizationId: string;
  channel: OutreachChannel;
  provider: SmsProvider | EmailProvider;
  status: VerificationStatus;
  verificationCode?: string;
  verificationCodeExpiresAt?: Date;
  verificationAttempts: number;
  verifiedAt?: Date;
  metadata: SmsMetadata | EmailMetadata;
  complianceAgreed: boolean;
  complianceAgreedAt?: Date;
  complianceAgreedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  lastVerifiedAt?: Date;
  suspendedAt?: Date;
  suspendedReason?: string;
}

export interface VerificationResult {
  success: boolean;
  status: VerificationStatus;
  message: string;
  nextStep?: string;
  dnsRecords?: DnsRecord[];
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get verification status for an organization's outreach channel
 */
export async function getVerificationStatus(
  organizationId: string,
  channel: OutreachChannel
): Promise<OutreachVerification | null> {
  const [row] = await sql`
    SELECT
      id,
      organization_id as "organizationId",
      channel,
      provider,
      status,
      verification_code as "verificationCode",
      verification_code_expires_at as "verificationCodeExpiresAt",
      verification_attempts as "verificationAttempts",
      verified_at as "verifiedAt",
      metadata,
      compliance_agreed as "complianceAgreed",
      compliance_agreed_at as "complianceAgreedAt",
      compliance_agreed_by as "complianceAgreedBy",
      created_at as "createdAt",
      updated_at as "updatedAt",
      last_verified_at as "lastVerifiedAt",
      suspended_at as "suspendedAt",
      suspended_reason as "suspendedReason"
    FROM outreach_verifications
    WHERE organization_id = ${organizationId}::uuid AND channel = ${channel}
  `;

  if (!row) return null;

  return {
    ...row,
    verificationCodeExpiresAt: row.verificationCodeExpiresAt
      ? new Date(row.verificationCodeExpiresAt)
      : undefined,
    verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : undefined,
    complianceAgreedAt: row.complianceAgreedAt ? new Date(row.complianceAgreedAt) : undefined,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    lastVerifiedAt: row.lastVerifiedAt ? new Date(row.lastVerifiedAt) : undefined,
    suspendedAt: row.suspendedAt ? new Date(row.suspendedAt) : undefined,
  } as OutreachVerification;
}

/**
 * Get verification status for all channels
 */
export async function getAllVerificationStatuses(
  organizationId: string
): Promise<{ sms: OutreachVerification | null; email: OutreachVerification | null }> {
  const [sms, email] = await Promise.all([
    getVerificationStatus(organizationId, 'sms'),
    getVerificationStatus(organizationId, 'email'),
  ]);

  return { sms, email };
}

/**
 * Check if outreach is active for a channel
 */
export async function isOutreachActive(
  organizationId: string,
  channel: OutreachChannel
): Promise<boolean> {
  const verification = await getVerificationStatus(organizationId, channel);

  // No verification record - check app_settings for platform provider
  if (!verification) {
    const [settings] = await sql`
      SELECT value FROM app_settings WHERE key = 'outreach_config'
    `;

    if (!settings?.value) return false;

    const config = settings.value as Record<string, any>;
    const channelConfig = config[channel];

    // Platform provider is always active (no verification needed)
    if (channelConfig?.provider === 'platform' && channelConfig?.configured) {
      return true;
    }

    return false;
  }

  // Platform provider is always active
  if (verification.provider === 'platform') {
    return true;
  }

  // BYOP requires ACTIVE status
  return verification.status === 'ACTIVE';
}

/**
 * Generate a 6-digit verification code
 */
export function generateVerificationCode(): string {
  const bytes = randomBytes(3);
  const num = parseInt(bytes.toString('hex'), 16);
  return String(num % 1000000).padStart(6, '0');
}

/**
 * Store encrypted credentials
 */
export async function storeCredentials(
  verificationId: string,
  credentials: SmsCredentials | EmailCredentials
): Promise<void> {
  const encrypted = encryptSensitive(JSON.stringify(credentials));

  await sql`
    UPDATE outreach_verifications
    SET credentials_encrypted = ${encrypted}
    WHERE id = ${verificationId}::uuid
  `;
}

/**
 * Retrieve decrypted credentials
 */
export async function getCredentials(
  verificationId: string
): Promise<SmsCredentials | EmailCredentials | null> {
  const [row] = await sql`
    SELECT credentials_encrypted FROM outreach_verifications
    WHERE id = ${verificationId}::uuid
  `;

  if (!row?.credentials_encrypted) return null;

  try {
    const decrypted = isEncrypted(row.credentials_encrypted)
      ? decryptSensitive(row.credentials_encrypted)
      : row.credentials_encrypted;
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/**
 * Log a verification event
 */
export async function logVerificationEvent(
  verificationId: string,
  event: string,
  oldStatus: string | null,
  newStatus: string | null,
  metadata: Record<string, any> = {},
  performedBy?: string
): Promise<void> {
  await sql`
    INSERT INTO outreach_verification_logs
    (verification_id, event, old_status, new_status, metadata, performed_by)
    VALUES (
      ${verificationId}::uuid,
      ${event},
      ${oldStatus},
      ${newStatus},
      ${JSON.stringify(metadata)},
      ${performedBy || null}
    )
  `;
}

// ============================================================================
// SMS Verification
// ============================================================================

/**
 * Start SMS verification process
 */
export async function startSmsVerification(
  organizationId: string,
  provider: SmsProvider,
  credentials: SmsCredentials,
  phoneNumber: string,
  userId: string
): Promise<VerificationResult> {
  // Platform provider doesn't need verification
  if (provider === 'platform') {
    // Upsert with ACTIVE status
    const [row] = await sql`
      INSERT INTO outreach_verifications
      (organization_id, channel, provider, status, metadata, compliance_agreed)
      VALUES (
        ${organizationId}::uuid,
        'sms',
        ${provider},
        'ACTIVE',
        ${JSON.stringify({ phoneNumber: 'platform', tcpaAgreed: false })}::jsonb,
        false
      )
      ON CONFLICT (organization_id, channel) DO UPDATE SET
        provider = EXCLUDED.provider,
        status = 'ACTIVE',
        updated_at = NOW()
      RETURNING id
    `;

    await logVerificationEvent(row.id, 'platform_activated', null, 'ACTIVE', {}, userId);

    return {
      success: true,
      status: 'ACTIVE',
      message: 'Platform SMS is ready to use. Complete TCPA compliance to send messages.',
      nextStep: 'compliance',
    };
  }

  // Generate verification code
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Upsert verification record
  const [row] = await sql`
    INSERT INTO outreach_verifications
    (organization_id, channel, provider, status, verification_code, verification_code_expires_at, metadata)
    VALUES (
      ${organizationId}::uuid,
      'sms',
      ${provider},
      'VERIFYING',
      ${code},
      ${expiresAt},
      ${JSON.stringify({ phoneNumber, tcpaAgreed: false })}::jsonb
    )
    ON CONFLICT (organization_id, channel) DO UPDATE SET
      provider = EXCLUDED.provider,
      status = 'VERIFYING',
      verification_code = EXCLUDED.verification_code,
      verification_code_expires_at = EXCLUDED.verification_code_expires_at,
      verification_attempts = 0,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING id
  `;

  // Store encrypted credentials
  await storeCredentials(row.id, credentials);

  await logVerificationEvent(row.id, 'code_sent', null, 'VERIFYING', { phoneNumber }, userId);

  // Return the code - the API route will send it via SMS
  return {
    success: true,
    status: 'VERIFYING',
    message: `Verification code sent to ${phoneNumber}. Enter the 6-digit code to verify ownership.`,
    nextStep: 'enter_code',
  };
}

/**
 * Verify SMS code
 */
export async function verifySmsCode(
  organizationId: string,
  code: string,
  userId: string
): Promise<VerificationResult> {
  const verification = await getVerificationStatus(organizationId, 'sms');

  if (!verification) {
    return {
      success: false,
      status: 'FAILED',
      message: 'No verification in progress. Please start the verification process first.',
    };
  }

  if (verification.status !== 'VERIFYING') {
    return {
      success: false,
      status: verification.status,
      message: `Cannot verify code. Current status: ${verification.status}`,
    };
  }

  // Check expiration
  if (verification.verificationCodeExpiresAt && new Date() > verification.verificationCodeExpiresAt) {
    await sql`
      UPDATE outreach_verifications
      SET status = 'EXPIRED', verification_code = NULL
      WHERE id = ${verification.id}::uuid
    `;
    await logVerificationEvent(verification.id, 'code_expired', 'VERIFYING', 'EXPIRED', {}, userId);

    return {
      success: false,
      status: 'EXPIRED',
      message: 'Verification code has expired. Please request a new code.',
    };
  }

  // Check attempts
  if (verification.verificationAttempts >= 5) {
    await sql`
      UPDATE outreach_verifications
      SET status = 'FAILED', verification_code = NULL
      WHERE id = ${verification.id}::uuid
    `;
    await logVerificationEvent(verification.id, 'max_attempts', 'VERIFYING', 'FAILED', {}, userId);

    return {
      success: false,
      status: 'FAILED',
      message: 'Too many failed attempts. Please start the verification process again.',
    };
  }

  // Verify code
  if (code !== verification.verificationCode) {
    await sql`
      UPDATE outreach_verifications
      SET verification_attempts = verification_attempts + 1
      WHERE id = ${verification.id}::uuid
    `;
    await logVerificationEvent(
      verification.id,
      'code_failed',
      'VERIFYING',
      'VERIFYING',
      { attempt: verification.verificationAttempts + 1 },
      userId
    );

    return {
      success: false,
      status: 'VERIFYING',
      message: `Invalid code. ${4 - verification.verificationAttempts} attempts remaining.`,
    };
  }

  // Code is correct - update to VERIFIED
  await sql`
    UPDATE outreach_verifications
    SET
      status = 'VERIFIED',
      verification_code = NULL,
      verification_code_expires_at = NULL,
      verified_at = NOW(),
      last_verified_at = NOW()
    WHERE id = ${verification.id}::uuid
  `;

  await logVerificationEvent(verification.id, 'code_verified', 'VERIFYING', 'VERIFIED', {}, userId);

  return {
    success: true,
    status: 'VERIFIED',
    message: 'Phone number verified! Complete TCPA compliance to activate SMS sending.',
    nextStep: 'compliance',
  };
}

/**
 * Complete SMS compliance (TCPA acknowledgment)
 */
export async function completeSmsCompliance(
  organizationId: string,
  userId: string
): Promise<VerificationResult> {
  const verification = await getVerificationStatus(organizationId, 'sms');

  if (!verification) {
    return {
      success: false,
      status: 'FAILED',
      message: 'No verification found. Please start the verification process.',
    };
  }

  // Platform or verified status can proceed to compliance
  if (verification.status !== 'VERIFIED' && verification.provider !== 'platform') {
    return {
      success: false,
      status: verification.status,
      message: 'Please verify phone number ownership before completing compliance.',
    };
  }

  // Update to ACTIVE with compliance
  const metadata = verification.metadata as SmsMetadata;
  metadata.tcpaAgreed = true;
  metadata.tcpaAgreedAt = new Date().toISOString();

  await sql`
    UPDATE outreach_verifications
    SET
      status = 'ACTIVE',
      compliance_agreed = true,
      compliance_agreed_at = NOW(),
      compliance_agreed_by = ${userId},
      metadata = ${JSON.stringify(metadata)}::jsonb
    WHERE id = ${verification.id}::uuid
  `;

  await logVerificationEvent(verification.id, 'compliance_agreed', verification.status, 'ACTIVE', {}, userId);

  return {
    success: true,
    status: 'ACTIVE',
    message: 'SMS outreach is now active. You can start sending campaigns!',
  };
}

// ============================================================================
// Email Verification
// ============================================================================

/**
 * Generate DNS records for email verification
 */
export function generateDnsRecords(domain: string, selector: string = 'dealflow'): DnsRecord[] {
  // Generate a unique DKIM selector and public key placeholder
  // In production, this would be generated by the email provider
  const dkimSelector = `${selector}._domainkey`;

  return [
    {
      type: 'TXT',
      name: domain,
      value: 'v=spf1 include:_spf.dealflow.ai ~all',
      verified: false,
    },
    {
      type: 'TXT',
      name: `${dkimSelector}.${domain}`,
      value: `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC...`, // Placeholder
      verified: false,
    },
    {
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@dealflow.ai',
      verified: false,
    },
  ];
}

/**
 * Start email verification process
 */
export async function startEmailVerification(
  organizationId: string,
  provider: EmailProvider,
  credentials: EmailCredentials,
  domain: string,
  fromAddress: string,
  fromName: string | undefined,
  userId: string
): Promise<VerificationResult> {
  // Platform provider doesn't need DNS verification
  if (provider === 'platform') {
    const [row] = await sql`
      INSERT INTO outreach_verifications
      (organization_id, channel, provider, status, metadata)
      VALUES (
        ${organizationId}::uuid,
        'email',
        ${provider},
        'ACTIVE',
        ${JSON.stringify({ domain: 'platform', fromAddress, fromName })}::jsonb
      )
      ON CONFLICT (organization_id, channel) DO UPDATE SET
        provider = EXCLUDED.provider,
        status = 'ACTIVE',
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id
    `;

    await logVerificationEvent(row.id, 'platform_activated', null, 'ACTIVE', {}, userId);

    return {
      success: true,
      status: 'ACTIVE',
      message: 'Platform email is ready to use.',
    };
  }

  // Generate DNS records for BYOP
  const dnsRecords = generateDnsRecords(domain);

  const metadata: EmailMetadata = {
    domain,
    fromAddress,
    fromName,
    spfVerified: false,
    dkimVerified: false,
    dmarcVerified: false,
    dnsRecords,
  };

  // Upsert verification record
  const [row] = await sql`
    INSERT INTO outreach_verifications
    (organization_id, channel, provider, status, metadata)
    VALUES (
      ${organizationId}::uuid,
      'email',
      ${provider},
      'DNS_PENDING',
      ${JSON.stringify(metadata)}::jsonb
    )
    ON CONFLICT (organization_id, channel) DO UPDATE SET
      provider = EXCLUDED.provider,
      status = 'DNS_PENDING',
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING id
  `;

  // Store encrypted credentials
  await storeCredentials(row.id, credentials);

  await logVerificationEvent(row.id, 'dns_records_generated', null, 'DNS_PENDING', { domain }, userId);

  return {
    success: true,
    status: 'DNS_PENDING',
    message: 'Add the following DNS records to your domain to verify ownership.',
    nextStep: 'add_dns',
    dnsRecords,
  };
}

/**
 * Check DNS records for email verification
 */
export async function checkEmailDns(
  organizationId: string,
  userId: string
): Promise<VerificationResult> {
  const verification = await getVerificationStatus(organizationId, 'email');

  if (!verification) {
    return {
      success: false,
      status: 'FAILED',
      message: 'No verification found. Please start the verification process.',
    };
  }

  if (verification.status !== 'DNS_PENDING') {
    return {
      success: false,
      status: verification.status,
      message: `Cannot check DNS. Current status: ${verification.status}`,
    };
  }

  const metadata = verification.metadata as EmailMetadata;
  const domain = metadata.domain;

  // In production, we'd actually check DNS records here
  // For now, simulate the check
  let spfVerified = false;
  let dkimVerified = false;
  let dmarcVerified = false;

  try {
    // Import dns module dynamically (Node.js built-in)
    const dns = await import('dns').then(m => m.promises);

    // Check SPF
    try {
      const txtRecords = await dns.resolveTxt(domain);
      spfVerified = txtRecords.some(records =>
        records.some(r => r.includes('v=spf1') && r.includes('dealflow'))
      );
    } catch { /* SPF not found */ }

    // Check DKIM
    try {
      const dkimRecords = await dns.resolveTxt(`dealflow._domainkey.${domain}`);
      dkimVerified = dkimRecords.some(records =>
        records.some(r => r.includes('v=DKIM1'))
      );
    } catch { /* DKIM not found */ }

    // Check DMARC
    try {
      const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
      dmarcVerified = dmarcRecords.some(records =>
        records.some(r => r.includes('v=DMARC1'))
      );
    } catch { /* DMARC not found */ }
  } catch (error) {
    console.error('[DNS Check] Error:', error);
  }

  // Update metadata with results
  metadata.spfVerified = spfVerified;
  metadata.dkimVerified = dkimVerified;
  metadata.dmarcVerified = dmarcVerified;
  metadata.lastDnsCheck = new Date().toISOString();

  if (metadata.dnsRecords) {
    metadata.dnsRecords[0].verified = spfVerified;
    metadata.dnsRecords[1].verified = dkimVerified;
    metadata.dnsRecords[2].verified = dmarcVerified;
  }

  // All records verified?
  const allVerified = spfVerified && dkimVerified && dmarcVerified;
  const newStatus = allVerified ? 'ACTIVE' : 'DNS_PENDING';

  await sql`
    UPDATE outreach_verifications
    SET
      status = ${newStatus},
      metadata = ${JSON.stringify(metadata)}::jsonb,
      verified_at = ${allVerified ? sql`NOW()` : sql`verified_at`},
      last_verified_at = ${allVerified ? sql`NOW()` : sql`last_verified_at`}
    WHERE id = ${verification.id}::uuid
  `;

  await logVerificationEvent(
    verification.id,
    'dns_check',
    'DNS_PENDING',
    newStatus,
    { spfVerified, dkimVerified, dmarcVerified },
    userId
  );

  if (allVerified) {
    return {
      success: true,
      status: 'ACTIVE',
      message: 'All DNS records verified! Email outreach is now active.',
      dnsRecords: metadata.dnsRecords,
    };
  }

  const missing: string[] = [];
  if (!spfVerified) missing.push('SPF');
  if (!dkimVerified) missing.push('DKIM');
  if (!dmarcVerified) missing.push('DMARC');

  return {
    success: false,
    status: 'DNS_PENDING',
    message: `Missing DNS records: ${missing.join(', ')}. DNS changes can take up to 48 hours to propagate.`,
    nextStep: 'check_dns',
    dnsRecords: metadata.dnsRecords,
  };
}

// ============================================================================
// Admin Functions
// ============================================================================

/**
 * Suspend an organization's outreach (admin only)
 */
export async function suspendOutreach(
  organizationId: string,
  channel: OutreachChannel,
  reason: string,
  adminUserId: string
): Promise<void> {
  const [row] = await sql`
    UPDATE outreach_verifications
    SET
      status = 'SUSPENDED',
      suspended_at = NOW(),
      suspended_reason = ${reason}
    WHERE organization_id = ${organizationId}::uuid AND channel = ${channel}
    RETURNING id, status
  `;

  if (row) {
    await logVerificationEvent(row.id, 'suspended', row.status, 'SUSPENDED', { reason }, adminUserId);
  }
}

/**
 * Reactivate a suspended outreach
 */
export async function reactivateOutreach(
  organizationId: string,
  channel: OutreachChannel,
  adminUserId: string
): Promise<void> {
  const [row] = await sql`
    UPDATE outreach_verifications
    SET
      status = 'ACTIVE',
      suspended_at = NULL,
      suspended_reason = NULL
    WHERE organization_id = ${organizationId}::uuid
      AND channel = ${channel}
      AND status = 'SUSPENDED'
    RETURNING id
  `;

  if (row) {
    await logVerificationEvent(row.id, 'reactivated', 'SUSPENDED', 'ACTIVE', {}, adminUserId);
  }
}

/**
 * Resend verification code (for SMS)
 */
export async function resendVerificationCode(
  organizationId: string,
  userId: string
): Promise<{ code: string; phoneNumber: string } | null> {
  const verification = await getVerificationStatus(organizationId, 'sms');

  if (!verification || verification.provider === 'platform') {
    return null;
  }

  // Generate new code
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await sql`
    UPDATE outreach_verifications
    SET
      verification_code = ${code},
      verification_code_expires_at = ${expiresAt},
      verification_attempts = 0,
      status = 'VERIFYING'
    WHERE id = ${verification.id}::uuid
  `;

  await logVerificationEvent(verification.id, 'code_resent', verification.status, 'VERIFYING', {}, userId);

  const metadata = verification.metadata as SmsMetadata;
  return { code, phoneNumber: metadata.phoneNumber };
}
