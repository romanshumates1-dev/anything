/**
 * Critical Alerts API
 * POST /api/alerts/critical
 * Sends immediate notifications for critical events (email + SMS).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import {
  sendAlert,
  alertAssignmentFeePaid,
  alertPaymentFailed,
  AlertEvent,
  ALERT_EVENTS,
} from '../notification-engine';

interface CriticalAlertBody {
  type: keyof typeof ALERT_EVENTS;
  title: string;
  message: string;
  context?: Record<string, any>;
}

const CRITICAL_TYPES = new Set([
  ALERT_EVENTS.ASSIGNMENT_FEE_PAID,
  ALERT_EVENTS.PAYMENT_FAILED,
  ALERT_EVENTS.CONTRACT_ERROR,
  ALERT_EVENTS.ESIGN_DOWN,
]);

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: CriticalAlertBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, title, message, context } = body;

  if (!type || !title || !message) {
    return Response.json(
      { error: 'type, title, and message are required' },
      { status: 400 }
    );
  }

  // Validate this is a critical event type
  if (!CRITICAL_TYPES.has(type as any)) {
    return Response.json(
      {
        error: `Event type '${type}' is not a critical alert. Use /api/alerts/digest for non-critical.`,
        criticalTypes: Array.from(CRITICAL_TYPES),
      },
      { status: 400 }
    );
  }

  try {
    const event: AlertEvent = {
      type,
      severity: 'CRITICAL',
      title,
      message,
      context: {
        ...context,
        organizationId: organization.id,
      },
      timestamp: new Date().toISOString(),
    };

    const result = await sendAlert(event);

    console.log(`[CRITICAL-ALERT] ${type}: ${title} | Sent: ${result.sent} | Channels: ${result.channels.join(', ')}`);

    return Response.json({
      sent: result.sent,
      channels: result.channels,
      type,
      timestamp: event.timestamp,
      errors: result.errors,
    });
  } catch (error: any) {
    console.error('[CRITICAL-ALERT] Error:', error);
    return Response.json(
      { error: 'Failed to send alert', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Convenience endpoint for assignment fee paid alerts.
 * POST /api/alerts/critical/assignment-fee-paid
 */
export async function assignmentFeePaid(
  dealId: string,
  amount: number,
  buyerName: string,
  propertyAddress: string
) {
  return alertAssignmentFeePaid(dealId, amount, buyerName, propertyAddress);
}

/**
 * Convenience endpoint for payment failed alerts.
 * POST /api/alerts/critical/payment-failed
 */
export async function paymentFailed(
  dealId: string,
  buyerName: string,
  amount: number,
  reason: string
) {
  return alertPaymentFailed(dealId, buyerName, amount, reason);
}
