/**
 * Notification Engine
 * Routes alerts by severity to appropriate channels (email, SMS, digest).
 */

import { sendEmailAuto } from '@/app/api/utils/emailProviders';

// ── types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type AlertChannel = 'email' | 'sms' | 'digest';

export interface AlertEvent {
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, any>;
  timestamp?: string;
}

export interface AlertRecipient {
  email: string;
  phone?: string;
  name?: string;
}

export interface AlertResult {
  sent: boolean;
  channels: AlertChannel[];
  errors?: string[];
}

// ── known event types ────────────────────────────────────────────────────────

export const ALERT_EVENTS = {
  // Critical - immediate email + SMS
  ASSIGNMENT_FEE_PAID: 'ASSIGNMENT_FEE_PAID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  CONTRACT_ERROR: 'CONTRACT_ERROR',
  ESIGN_DOWN: 'ESIGN_DOWN',

  // High - email within 5 min
  SELLER_SIGNED: 'SELLER_SIGNED',
  BUYER_SIGNED: 'BUYER_SIGNED',
  NEGOTIATION_ERROR: 'NEGOTIATION_ERROR',
  COMPLIANCE_BLOCK: 'COMPLIANCE_BLOCK',
  FEE_FLOOR_BREACH_ATTEMPT: 'FEE_FLOOR_BREACH_ATTEMPT',

  // Medium - daily digest
  BUYERS_MATCHED: 'BUYERS_MATCHED',
  API_TIMEOUT: 'API_TIMEOUT',
  EMAIL_BOUNCE: 'EMAIL_BOUNCE',
  CAMPAIGN_QUALITY_WARNING: 'CAMPAIGN_QUALITY_WARNING',

  // Low - weekly report
  RETRY_SUCCESS: 'RETRY_SUCCESS',
  MINOR_WARNING: 'MINOR_WARNING',
} as const;

// ── severity routing ─────────────────────────────────────────────────────────

const SEVERITY_CHANNELS: Record<AlertSeverity, AlertChannel[]> = {
  CRITICAL: ['email', 'sms'],
  HIGH: ['email'],
  MEDIUM: ['digest'],
  LOW: ['digest'],
};

// ── default admin recipient ──────────────────────────────────────────────────

const DEFAULT_ADMIN: AlertRecipient = {
  email: 'roman.shumate@dealswiftautomation.com',
  phone: '+1XXXXXXXXXX', // Replace with actual
  name: 'Admin',
};

// ── rate limiting ────────────────────────────────────────────────────────────

const recentAlerts = new Map<string, number>();
const RATE_LIMIT_MS = 60_000; // 1 minute between duplicate alerts

function isRateLimited(alertKey: string): boolean {
  const lastSent = recentAlerts.get(alertKey);
  if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
    return true;
  }
  recentAlerts.set(alertKey, Date.now());
  return false;
}

// ── email templates ──────────────────────────────────────────────────────────

function buildAlertEmail(event: AlertEvent): { subject: string; html: string } {
  const severityColors: Record<AlertSeverity, string> = {
    CRITICAL: '#dc2626',
    HIGH: '#ea580c',
    MEDIUM: '#ca8a04',
    LOW: '#6b7280',
  };

  const severityEmoji: Record<AlertSeverity, string> = {
    CRITICAL: '🚨',
    HIGH: '⚠️',
    MEDIUM: '📋',
    LOW: 'ℹ️',
  };

  const color = severityColors[event.severity];
  const emoji = severityEmoji[event.severity];
  const timestamp = event.timestamp || new Date().toISOString();

  const contextHtml = event.context
    ? Object.entries(event.context)
        .map(([k, v]) => `<tr><td style="padding:4px 8px;color:#666;">${k}</td><td style="padding:4px 8px;">${JSON.stringify(v)}</td></tr>`)
        .join('')
    : '';

  return {
    subject: `${emoji} [${event.severity}] ${event.title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${color}; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">${emoji} ${event.title}</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
            Severity: ${event.severity} | ${new Date(timestamp).toLocaleString()}
          </p>
        </div>

        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="font-size: 16px; color: #334155; margin: 0 0 16px 0;">
            ${event.message}
          </p>

          ${contextHtml ? `
            <div style="margin-top: 20px;">
              <h3 style="font-size: 14px; color: #64748b; margin: 0 0 8px 0;">Details</h3>
              <table style="border-collapse: collapse; width: 100%; background: white; border-radius: 4px;">
                ${contextHtml}
              </table>
            </div>
          ` : ''}

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
            <p style="font-size: 12px; color: #94a3b8; margin: 0;">
              Event Type: ${event.type} | Alert ID: ${Date.now().toString(36)}
            </p>
          </div>
        </div>
      </div>
    `,
  };
}

// ── SMS stub ─────────────────────────────────────────────────────────────────

async function sendSMS(phone: string, message: string): Promise<boolean> {
  // TODO: Integrate with Twilio/AWS SNS
  console.log(`[SMS] To: ${phone} | Message: ${message}`);
  return true;
}

// ── main send function ───────────────────────────────────────────────────────

export async function sendAlert(
  event: AlertEvent,
  recipient: AlertRecipient = DEFAULT_ADMIN
): Promise<AlertResult> {
  const alertKey = `${event.type}:${recipient.email}`;

  // Rate limit check (skip for CRITICAL)
  if (event.severity !== 'CRITICAL' && isRateLimited(alertKey)) {
    return { sent: false, channels: [], errors: ['Rate limited'] };
  }

  const channels = SEVERITY_CHANNELS[event.severity];
  const sentChannels: AlertChannel[] = [];
  const errors: string[] = [];

  // Email
  if (channels.includes('email')) {
    try {
      const { subject, html } = buildAlertEmail(event);
      const orgId = event.context?.organizationId || 'system';
      await sendEmailAuto(orgId, {
        to: recipient.email,
        subject,
        text: `${event.title}\n\n${event.message}`,
        html,
      });
      sentChannels.push('email');
    } catch (err: any) {
      errors.push(`Email failed: ${err.message}`);
    }
  }

  // SMS (CRITICAL only)
  if (channels.includes('sms') && recipient.phone) {
    try {
      const smsMessage = `${event.title}: ${event.message.slice(0, 140)}`;
      await sendSMS(recipient.phone, smsMessage);
      sentChannels.push('sms');
    } catch (err: any) {
      errors.push(`SMS failed: ${err.message}`);
    }
  }

  // Digest (queue for later - stub)
  if (channels.includes('digest')) {
    // TODO: Queue to digest aggregator
    sentChannels.push('digest');
  }

  return {
    sent: sentChannels.length > 0,
    channels: sentChannels,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ── convenience functions ────────────────────────────────────────────────────

export async function alertAssignmentFeePaid(
  dealId: string,
  amount: number,
  buyerName: string,
  propertyAddress: string
): Promise<AlertResult> {
  return sendAlert({
    type: ALERT_EVENTS.ASSIGNMENT_FEE_PAID,
    severity: 'CRITICAL',
    title: 'Assignment Fee PAID',
    message: `${buyerName} paid $${amount.toLocaleString()} assignment fee for ${propertyAddress}`,
    context: {
      dealId,
      amount,
      buyerName,
      propertyAddress,
      paidAt: new Date().toISOString(),
    },
  });
}

export async function alertSellerSigned(
  dealId: string,
  sellerName: string,
  propertyAddress: string,
  purchasePrice: number
): Promise<AlertResult> {
  return sendAlert({
    type: ALERT_EVENTS.SELLER_SIGNED,
    severity: 'HIGH',
    title: 'Seller Contract Signed',
    message: `${sellerName} signed the purchase agreement for ${propertyAddress} at $${purchasePrice.toLocaleString()}`,
    context: {
      dealId,
      sellerName,
      propertyAddress,
      purchasePrice,
      signedAt: new Date().toISOString(),
    },
  });
}

export async function alertBuyerSigned(
  dealId: string,
  buyerName: string,
  propertyAddress: string,
  assignmentFee: number
): Promise<AlertResult> {
  return sendAlert({
    type: ALERT_EVENTS.BUYER_SIGNED,
    severity: 'HIGH',
    title: 'Buyer Assignment Signed',
    message: `${buyerName} signed the assignment contract for ${propertyAddress}. Fee: $${assignmentFee.toLocaleString()}`,
    context: {
      dealId,
      buyerName,
      propertyAddress,
      assignmentFee,
      signedAt: new Date().toISOString(),
    },
  });
}

export async function alertBuyersMatched(
  dealId: string,
  propertyAddress: string,
  matchCount: number,
  topBuyers: string[]
): Promise<AlertResult> {
  return sendAlert({
    type: ALERT_EVENTS.BUYERS_MATCHED,
    severity: 'MEDIUM',
    title: 'Buyers Matched',
    message: `${matchCount} buyers matched for ${propertyAddress}. Top: ${topBuyers.slice(0, 3).join(', ')}`,
    context: {
      dealId,
      propertyAddress,
      matchCount,
      topBuyers,
    },
  });
}

export async function alertPaymentFailed(
  dealId: string,
  buyerName: string,
  amount: number,
  reason: string
): Promise<AlertResult> {
  return sendAlert({
    type: ALERT_EVENTS.PAYMENT_FAILED,
    severity: 'CRITICAL',
    title: 'Payment Failed',
    message: `Payment of $${amount.toLocaleString()} from ${buyerName} failed: ${reason}`,
    context: {
      dealId,
      buyerName,
      amount,
      reason,
      failedAt: new Date().toISOString(),
    },
  });
}

export async function alertFeeFloorBreach(
  dealId: string,
  attemptedFee: number,
  minimumFee: number
): Promise<AlertResult> {
  return sendAlert({
    type: ALERT_EVENTS.FEE_FLOOR_BREACH_ATTEMPT,
    severity: 'HIGH',
    title: 'Fee Floor Breach Attempted',
    message: `Attempted to set assignment fee at $${attemptedFee.toLocaleString()}, below minimum $${minimumFee.toLocaleString()}. Deal walked away.`,
    context: {
      dealId,
      attemptedFee,
      minimumFee,
      feeFloor: 5000,
    },
  });
}

export async function alertComplianceBlock(
  campaignId: string,
  reason: string,
  blockedCount: number
): Promise<AlertResult> {
  return sendAlert({
    type: ALERT_EVENTS.COMPLIANCE_BLOCK,
    severity: 'HIGH',
    title: 'Compliance Block',
    message: `${blockedCount} messages blocked: ${reason}`,
    context: {
      campaignId,
      reason,
      blockedCount,
    },
  });
}
