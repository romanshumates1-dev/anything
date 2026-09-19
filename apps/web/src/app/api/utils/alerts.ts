/**
 * alerts.ts — Alerting utilities for critical failures.
 *
 * Supports multiple channels (Slack, Email via SES, PagerDuty) and gracefully
 * degrades when webhooks are not configured. Includes rate limiting to prevent
 * alert spam.
 *
 * Environment variables:
 *   - SLACK_ALERT_WEBHOOK: Slack incoming webhook URL
 *   - PAGERDUTY_ROUTING_KEY: PagerDuty Events API v2 routing key
 *   - ALERT_EMAIL_RECIPIENTS: Comma-separated list of email addresses
 *   - ALERT_FROM_EMAIL: Sender address for alert emails
 */
import { send as sendEmail } from '@/app/api/services/emailDriver';
import { logger } from '@/app/api/utils/logger';

// -----------------------------------------------------------------------------
// Alert Types
// -----------------------------------------------------------------------------

export type AlertType =
  | 'PAYMENT_FAILED'
  | 'WITHDRAWAL_FAILED'
  | 'JOB_DEAD_LETTERED'
  | 'HIGH_ERROR_RATE'
  | 'SERVICE_DEGRADED';

export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info';

export interface AlertMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface Alert {
  type: AlertType;
  message: string;
  severity: AlertSeverity;
  metadata?: AlertMetadata;
  timestamp: Date;
}

// -----------------------------------------------------------------------------
// Rate Limiting
// -----------------------------------------------------------------------------

interface RateLimitEntry {
  lastSent: number;
  count: number;
  aggregatedMetadata: AlertMetadata[];
}

// In-memory rate limit tracking (5 minute window per alert type)
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const rateLimitMap = new Map<AlertType, RateLimitEntry>();

function shouldRateLimit(type: AlertType, metadata?: AlertMetadata): {
  limited: boolean;
  aggregatedCount?: number;
  aggregatedMetadata?: AlertMetadata[];
} {
  const now = Date.now();
  const entry = rateLimitMap.get(type);

  if (!entry) {
    // First alert of this type
    rateLimitMap.set(type, {
      lastSent: now,
      count: 1,
      aggregatedMetadata: metadata ? [metadata] : [],
    });
    return { limited: false };
  }

  const elapsed = now - entry.lastSent;

  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    // Window expired, send aggregated alert and reset
    const result = {
      limited: false,
      aggregatedCount: entry.count,
      aggregatedMetadata: entry.aggregatedMetadata,
    };
    rateLimitMap.set(type, {
      lastSent: now,
      count: 1,
      aggregatedMetadata: metadata ? [metadata] : [],
    });
    return result;
  }

  // Within window, aggregate
  entry.count++;
  if (metadata) {
    entry.aggregatedMetadata.push(metadata);
  }
  return { limited: true };
}

// -----------------------------------------------------------------------------
// Severity Mapping
// -----------------------------------------------------------------------------

const DEFAULT_SEVERITY: Record<AlertType, AlertSeverity> = {
  PAYMENT_FAILED: 'critical',
  WITHDRAWAL_FAILED: 'critical',
  JOB_DEAD_LETTERED: 'error',
  HIGH_ERROR_RATE: 'error',
  SERVICE_DEGRADED: 'warning',
};

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  critical: ':rotating_light:',
  error: ':x:',
  warning: ':warning:',
  info: ':information_source:',
};

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#dc2626', // red-600
  error: '#ea580c',    // orange-600
  warning: '#ca8a04',  // yellow-600
  info: '#2563eb',     // blue-600
};

const PAGERDUTY_SEVERITY: Record<AlertSeverity, string> = {
  critical: 'critical',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

// -----------------------------------------------------------------------------
// Channel Senders
// -----------------------------------------------------------------------------

async function sendToSlack(alert: Alert, aggregatedCount?: number): Promise<boolean> {
  const webhookUrl = process.env.SLACK_ALERT_WEBHOOK;
  if (!webhookUrl) {
    logger.info('[alerts] Slack webhook not configured, skipping', { type: alert.type });
    return false;
  }

  const emoji = SEVERITY_EMOJI[alert.severity];
  const color = SEVERITY_COLOR[alert.severity];

  // Build metadata fields for Slack
  const fields: Array<{ type: string; text: string }> = [];
  if (alert.metadata) {
    for (const [key, value] of Object.entries(alert.metadata)) {
      if (value !== undefined && value !== null) {
        fields.push({
          type: 'mrkdwn',
          text: `*${key}:* ${value}`,
        });
      }
    }
  }

  // Aggregation notice
  let aggregationText = '';
  if (aggregatedCount && aggregatedCount > 1) {
    aggregationText = `\n_+${aggregatedCount - 1} similar alerts aggregated in the last 5 minutes_`;
  }

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${emoji} ${alert.type}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${alert.message}${aggregationText}`,
      },
    },
  ];

  // Add metadata fields in a section
  if (fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: fields.slice(0, 10), // Slack limits to 10 fields
    } as any);
  }

  // Add timestamp context
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Severity: *${alert.severity}* | Time: ${alert.timestamp.toISOString()}`,
      },
    ],
  } as any);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          {
            color,
            blocks,
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error('[alerts] Slack webhook failed', {
        status: response.status,
        type: alert.type,
      });
      return false;
    }
    return true;
  } catch (error: any) {
    logger.error('[alerts] Slack webhook error', {
      error: error.message,
      type: alert.type,
    });
    return false;
  }
}

async function sendToEmail(alert: Alert, aggregatedCount?: number): Promise<boolean> {
  const recipients = process.env.ALERT_EMAIL_RECIPIENTS;
  const fromEmail = process.env.ALERT_FROM_EMAIL || process.env.EMAIL_FROM_ADDRESS;

  if (!recipients || !fromEmail) {
    logger.info('[alerts] Email alerting not configured, skipping', { type: alert.type });
    return false;
  }

  const recipientList = recipients.split(',').map((e) => e.trim()).filter(Boolean);
  if (recipientList.length === 0) return false;

  // Build HTML email
  const severityBadge = `
    <span style="
      background-color: ${SEVERITY_COLOR[alert.severity]};
      color: white;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: bold;
      text-transform: uppercase;
      font-size: 12px;
    ">${alert.severity}</span>
  `;

  let metadataHtml = '';
  if (alert.metadata) {
    const rows = Object.entries(alert.metadata)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${k}</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${v}</td></tr>`)
      .join('');
    if (rows) {
      metadataHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <thead>
            <tr style="background-color: #f3f4f6;">
              <th style="padding: 8px; text-align: left;">Field</th>
              <th style="padding: 8px; text-align: left;">Value</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }
  }

  let aggregationNote = '';
  if (aggregatedCount && aggregatedCount > 1) {
    aggregationNote = `
      <p style="color: #6b7280; font-style: italic; margin-top: 16px;">
        +${aggregatedCount - 1} similar alerts were aggregated in the last 5 minutes.
      </p>
    `;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; background-color: #f9fafb;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          ${severityBadge}
          <h1 style="margin: 0; font-size: 20px; color: #111827;">${alert.type}</h1>
        </div>
        <p style="color: #374151; font-size: 16px; line-height: 1.5;">${alert.message}</p>
        ${metadataHtml}
        ${aggregationNote}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          Alert generated at ${alert.timestamp.toISOString()}
        </p>
      </div>
    </body>
    </html>
  `;

  // Send to all recipients (best-effort)
  let anySuccess = false;
  for (const to of recipientList) {
    try {
      const result = await sendEmail({
        to,
        from: fromEmail,
        subject: `[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message.slice(0, 50)}`,
        html,
        contactId: 'system-alert', // Required by emailDriver
      });
      if (result.status === 'sent') {
        anySuccess = true;
      }
    } catch (error: any) {
      logger.error('[alerts] Email send failed', {
        error: error.message,
        to,
        type: alert.type,
      });
    }
  }

  return anySuccess;
}

async function sendToPagerDuty(alert: Alert): Promise<boolean> {
  const routingKey = process.env.PAGERDUTY_ROUTING_KEY;
  if (!routingKey) {
    logger.info('[alerts] PagerDuty not configured, skipping', { type: alert.type });
    return false;
  }

  // Only send critical/error to PagerDuty to avoid noise
  if (alert.severity !== 'critical' && alert.severity !== 'error') {
    return false;
  }

  const payload = {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: `dealflow-${alert.type}-${Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)}`,
    payload: {
      summary: `[${alert.type}] ${alert.message}`,
      severity: PAGERDUTY_SEVERITY[alert.severity],
      source: 'DealFlow AI',
      timestamp: alert.timestamp.toISOString(),
      custom_details: alert.metadata || {},
    },
  };

  try {
    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error('[alerts] PagerDuty API failed', {
        status: response.status,
        body,
        type: alert.type,
      });
      return false;
    }
    return true;
  } catch (error: any) {
    logger.error('[alerts] PagerDuty error', {
      error: error.message,
      type: alert.type,
    });
    return false;
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface SendAlertResult {
  sent: boolean;
  channels: {
    slack: boolean;
    email: boolean;
    pagerduty: boolean;
  };
  rateLimited: boolean;
  aggregatedCount?: number;
}

/**
 * Send an alert to all configured channels.
 *
 * Rate-limited: max 1 alert per type per 5 minutes. Similar alerts are
 * aggregated and the count is included in the next alert.
 */
export async function sendAlert(
  type: AlertType,
  message: string,
  metadata?: AlertMetadata
): Promise<SendAlertResult> {
  const severity = DEFAULT_SEVERITY[type];
  const timestamp = new Date();

  // Check rate limit
  const rateCheck = shouldRateLimit(type, metadata);
  if (rateCheck.limited) {
    logger.info('[alerts] Rate limited, aggregating', {
      type,
      currentCount: rateLimitMap.get(type)?.count,
    });
    return {
      sent: false,
      channels: { slack: false, email: false, pagerduty: false },
      rateLimited: true,
    };
  }

  const alert: Alert = {
    type,
    message,
    severity,
    metadata,
    timestamp,
  };

  // Log the alert
  logger.warn(`[ALERT] ${type}: ${message}`, { severity, metadata });

  // Send to all channels in parallel (best-effort)
  const [slack, email, pagerduty] = await Promise.all([
    sendToSlack(alert, rateCheck.aggregatedCount).catch(() => false),
    sendToEmail(alert, rateCheck.aggregatedCount).catch(() => false),
    sendToPagerDuty(alert).catch(() => false),
  ]);

  const sent = slack || email || pagerduty;
  if (!sent) {
    logger.warn('[alerts] No channels configured or all failed', { type });
  }

  return {
    sent,
    channels: { slack, email, pagerduty },
    rateLimited: false,
    aggregatedCount: rateCheck.aggregatedCount,
  };
}

/**
 * Send a payment failure alert.
 */
export async function sendPaymentAlert(
  paymentId: string,
  error: string | Error,
  additionalMetadata?: AlertMetadata
): Promise<SendAlertResult> {
  const errorMessage = error instanceof Error ? error.message : error;
  return sendAlert('PAYMENT_FAILED', `Payment processing failed: ${errorMessage}`, {
    paymentId,
    error: errorMessage,
    ...additionalMetadata,
  });
}

/**
 * Send a withdrawal failure alert.
 */
export async function sendWithdrawalAlert(
  withdrawalId: string,
  error: string | Error,
  additionalMetadata?: AlertMetadata
): Promise<SendAlertResult> {
  const errorMessage = error instanceof Error ? error.message : error;
  return sendAlert('WITHDRAWAL_FAILED', `Withdrawal processing failed: ${errorMessage}`, {
    withdrawalId,
    error: errorMessage,
    ...additionalMetadata,
  });
}

/**
 * Send a job failure alert (for dead-lettered jobs).
 */
export async function sendJobAlert(
  jobId: string | number,
  error: string | Error,
  additionalMetadata?: AlertMetadata
): Promise<SendAlertResult> {
  const errorMessage = error instanceof Error ? error.message : error;
  return sendAlert('JOB_DEAD_LETTERED', `Job dead-lettered after max retries: ${errorMessage}`, {
    jobId: String(jobId),
    error: errorMessage,
    ...additionalMetadata,
  });
}

/**
 * Send a high error rate alert.
 */
export async function sendHighErrorRateAlert(
  service: string,
  errorRate: number,
  threshold: number,
  additionalMetadata?: AlertMetadata
): Promise<SendAlertResult> {
  return sendAlert(
    'HIGH_ERROR_RATE',
    `Service "${service}" error rate (${(errorRate * 100).toFixed(1)}%) exceeds threshold (${(threshold * 100).toFixed(1)}%)`,
    {
      service,
      errorRate: `${(errorRate * 100).toFixed(1)}%`,
      threshold: `${(threshold * 100).toFixed(1)}%`,
      ...additionalMetadata,
    }
  );
}

/**
 * Send a service degradation alert.
 */
export async function sendServiceDegradedAlert(
  service: string,
  reason: string,
  additionalMetadata?: AlertMetadata
): Promise<SendAlertResult> {
  return sendAlert('SERVICE_DEGRADED', `Service "${service}" is degraded: ${reason}`, {
    service,
    reason,
    ...additionalMetadata,
  });
}

// -----------------------------------------------------------------------------
// Testing Utilities
// -----------------------------------------------------------------------------

/**
 * Clear rate limit state (for testing).
 */
export function _clearRateLimits(): void {
  rateLimitMap.clear();
}

/**
 * Get current rate limit state (for testing).
 */
export function _getRateLimitState(): Map<AlertType, RateLimitEntry> {
  return new Map(rateLimitMap);
}
