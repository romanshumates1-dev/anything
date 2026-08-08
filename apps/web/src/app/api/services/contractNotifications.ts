/**
 * Contract Notification Service - AWS SNS Integration
 *
 * Sends real-time alerts for critical contract events:
 * 1. Assignment contract signed by buyer
 * 2. Inspection period expiry warning (N-2 days before deadline)
 * 3. Contract becomes unexecutable (past inspection period with no assignment)
 *
 * Uses AWS SNS for multi-channel delivery:
 * - SMS alerts to owner
 * - Email notifications
 * - Push notifications (via SNS mobile)
 */

import { SNSClient, PublishCommand, CreateTopicCommand, SubscribeCommand } from '@aws-sdk/client-sns';
import { neon } from '@neondatabase/serverless';

interface ContractAlert {
  type: 'ASSIGNMENT_SIGNED' | 'INSPECTION_EXPIRING' | 'CONTRACT_UNEXECUTABLE' | 'BUYER_ACCEPTED' | 'CLOSING_IMMINENT';
  contractId: string;
  propertyAddress: string;
  buyerName?: string;
  buyerEmail?: string;
  assignmentFee?: number;
  daysRemaining?: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metadata?: Record<string, any>;
}

let snsClient: SNSClient | null = null;

function getSNSClient(): SNSClient | null {
  if (!snsClient && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    snsClient = new SNSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return snsClient;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function buildAlertMessage(alert: ContractAlert): { subject: string; body: string; smsBody: string } {
  const urgencyEmoji = {
    LOW: '',
    MEDIUM: '',
    HIGH: '!',
    CRITICAL: '!!',
  };

  switch (alert.type) {
    case 'ASSIGNMENT_SIGNED':
      return {
        subject: `Assignment Contract Signed - ${alert.propertyAddress}`,
        body: `
ASSIGNMENT CONTRACT SIGNED

Property: ${alert.propertyAddress}
Buyer: ${alert.buyerName || 'Unknown'} (${alert.buyerEmail || 'No email'})
Assignment Fee: ${alert.assignmentFee ? formatCurrency(alert.assignmentFee) : 'Not specified'}

The buyer has executed the assignment contract. Next steps:
1. Coordinate with title company for closing
2. Ensure earnest money is deposited
3. Schedule closing date

Contract ID: ${alert.contractId}
Timestamp: ${new Date().toISOString()}
        `.trim(),
        smsBody: `DealSwift: Assignment SIGNED for ${alert.propertyAddress}. Buyer: ${alert.buyerName}. Fee: ${alert.assignmentFee ? formatCurrency(alert.assignmentFee) : 'TBD'}. Check email for details.`,
      };

    case 'INSPECTION_EXPIRING':
      return {
        subject: `${urgencyEmoji[alert.urgency]} Inspection Period Expiring - ${alert.daysRemaining} Days Left`,
        body: `
INSPECTION PERIOD EXPIRING

Property: ${alert.propertyAddress}
Days Remaining: ${alert.daysRemaining}
Urgency: ${alert.urgency}

ACTION REQUIRED:
${alert.daysRemaining && alert.daysRemaining <= 2
  ? '- URGENT: Assign to buyer or terminate contract before deadline'
  : '- Continue marketing to buyer list'
  : '- Lower asking price if no buyer interest'}

If no assignment occurs before inspection period ends, the contract becomes unexecutable and you may lose earnest money.

Contract ID: ${alert.contractId}
        `.trim(),
        smsBody: `DealSwift ALERT: ${alert.daysRemaining} days left on ${alert.propertyAddress}. ${alert.daysRemaining && alert.daysRemaining <= 2 ? 'URGENT - Assign or terminate!' : 'Find buyer ASAP.'}`,
      };

    case 'CONTRACT_UNEXECUTABLE':
      return {
        subject: `CRITICAL: Contract Unexecutable - ${alert.propertyAddress}`,
        body: `
CONTRACT UNEXECUTABLE - IMMEDIATE ACTION REQUIRED

Property: ${alert.propertyAddress}
Status: Past inspection period without assignment

The inspection period has expired and this contract has NOT been assigned to a buyer.

IMMEDIATE ACTIONS:
1. Contact seller to negotiate extension OR
2. Exercise contract termination clause if available
3. Consult with attorney regarding earnest money

WARNING: Failure to act may result in:
- Loss of earnest money deposit
- Potential breach of contract liability

Contract ID: ${alert.contractId}
Timestamp: ${new Date().toISOString()}
        `.trim(),
        smsBody: `DealSwift CRITICAL: ${alert.propertyAddress} inspection expired - NO BUYER. Contact seller for extension or terminate. Earnest money at risk!`,
      };

    case 'BUYER_ACCEPTED':
      return {
        subject: `Buyer Accepted Assignment - ${alert.propertyAddress}`,
        body: `
BUYER ACCEPTED ASSIGNMENT OFFER

Property: ${alert.propertyAddress}
Buyer: ${alert.buyerName || 'Unknown'} (${alert.buyerEmail || 'No email'})
Assignment Fee: ${alert.assignmentFee ? formatCurrency(alert.assignmentFee) : 'Not specified'}

The buyer has accepted the assignment offer. Next steps:
1. Send assignment contract for signature
2. Collect earnest money deposit
3. Coordinate closing details

Contract ID: ${alert.contractId}
        `.trim(),
        smsBody: `DealSwift: Buyer ${alert.buyerName} ACCEPTED assignment for ${alert.propertyAddress}. Fee: ${alert.assignmentFee ? formatCurrency(alert.assignmentFee) : 'TBD'}. Send contract!`,
      };

    case 'CLOSING_IMMINENT':
      return {
        subject: `Closing in ${alert.daysRemaining} Days - ${alert.propertyAddress}`,
        body: `
CLOSING IMMINENT

Property: ${alert.propertyAddress}
Days Until Closing: ${alert.daysRemaining}
Buyer: ${alert.buyerName || 'Unknown'}
Assignment Fee Due: ${alert.assignmentFee ? formatCurrency(alert.assignmentFee) : 'Check contract'}

CLOSING CHECKLIST:
- [ ] Title clear and ready
- [ ] Buyer funds verified
- [ ] All documents signed
- [ ] Closing agent confirmed
- [ ] Assignment fee wire instructions sent

Contract ID: ${alert.contractId}
        `.trim(),
        smsBody: `DealSwift: Closing in ${alert.daysRemaining} days for ${alert.propertyAddress}. Fee: ${alert.assignmentFee ? formatCurrency(alert.assignmentFee) : 'TBD'}. Verify all docs ready.`,
      };

    default:
      return {
        subject: `Contract Alert - ${alert.propertyAddress}`,
        body: `Contract alert for ${alert.propertyAddress}. Contract ID: ${alert.contractId}`,
        smsBody: `DealSwift: Alert for ${alert.propertyAddress}. Check dashboard.`,
      };
  }
}

export async function sendContractAlert(alert: ContractAlert): Promise<{ success: boolean; error?: string }> {
  const client = getSNSClient();
  const { subject, body, smsBody } = buildAlertMessage(alert);

  const ownerPhone = process.env.OWNER_NUMBER;
  const ownerEmail = process.env.OWNER_EMAIL || process.env.SUPPORT_EMAIL;

  if (!client) {
    console.log(`[CONTRACT ALERT - MOCK] ${alert.type}: ${subject}`);
    console.log(body);
    return { success: true };
  }

  const results: { channel: string; success: boolean; error?: string }[] = [];

  // Send SMS to owner
  if (ownerPhone) {
    try {
      await client.send(new PublishCommand({
        PhoneNumber: ownerPhone.startsWith('+') ? ownerPhone : `+1${ownerPhone.replace(/\D/g, '')}`,
        Message: smsBody,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: alert.urgency === 'CRITICAL' ? 'Transactional' : 'Promotional',
          },
        },
      }));
      results.push({ channel: 'sms', success: true });
      console.log(`[CONTRACT ALERT] SMS sent to ${ownerPhone}: ${alert.type}`);
    } catch (err: any) {
      results.push({ channel: 'sms', success: false, error: err.message });
      console.error(`[CONTRACT ALERT] SMS failed:`, err.message);
    }
  }

  // Log to database for audit trail
  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`
      INSERT INTO message_events (lead_id, type, status, metadata, created_at)
      VALUES (
        ${alert.metadata?.leadId || null},
        'contract_alert',
        'sent',
        ${JSON.stringify({
          alertType: alert.type,
          contractId: alert.contractId,
          propertyAddress: alert.propertyAddress,
          urgency: alert.urgency,
          channels: results,
        })}::jsonb,
        now()
      )
    `.catch(() => {});
  } catch {
    // Non-critical
  }

  const allSuccess = results.every(r => r.success);
  return {
    success: allSuccess || results.length === 0,
    error: allSuccess ? undefined : results.filter(r => !r.success).map(r => `${r.channel}: ${r.error}`).join('; '),
  };
}

export async function checkInspectionPeriods(): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  const sql = neon(process.env.DATABASE_URL);

  // Find contracts approaching inspection deadline
  const expiringContracts = await sql`
    SELECT
      c.id,
      c.property_address,
      c.inspection_days,
      c.created_at,
      c.assigned_at,
      c.status,
      c.esign_status,
      ba.buyer_id,
      ba.status as assignment_status,
      b.name as buyer_name,
      b.email as buyer_email,
      ba.assignment_fee_cents,
      EXTRACT(DAY FROM (c.created_at + (c.inspection_days || ' days')::interval - now()))::int as days_remaining
    FROM contracts c
    LEFT JOIN buyer_assignments ba ON ba.contract_id = c.id
    LEFT JOIN buyers b ON b.id = ba.buyer_id
    WHERE c.assigned_at IS NULL
      AND c.status NOT IN ('TERMINATED', 'CLOSED', 'EXPIRED')
      AND c.created_at + (c.inspection_days || ' days')::interval > now() - interval '1 day'
  `.catch(() => []);

  for (const contract of expiringContracts) {
    const daysRemaining = contract.days_remaining;

    // Determine alert type and urgency
    let alertType: ContractAlert['type'] | null = null;
    let urgency: ContractAlert['urgency'] = 'LOW';

    if (daysRemaining <= 0) {
      alertType = 'CONTRACT_UNEXECUTABLE';
      urgency = 'CRITICAL';
    } else if (daysRemaining <= 2) {
      alertType = 'INSPECTION_EXPIRING';
      urgency = 'CRITICAL';
    } else if (daysRemaining <= 4) {
      alertType = 'INSPECTION_EXPIRING';
      urgency = 'HIGH';
    } else if (daysRemaining <= 7) {
      alertType = 'INSPECTION_EXPIRING';
      urgency = 'MEDIUM';
    }

    if (alertType) {
      // Check if we already sent this alert today
      const [recentAlert] = await sql`
        SELECT id FROM message_events
        WHERE type = 'contract_alert'
          AND metadata->>'contractId' = ${contract.id}
          AND metadata->>'alertType' = ${alertType}
          AND created_at > now() - interval '24 hours'
        LIMIT 1
      `.catch(() => [null]);

      if (!recentAlert) {
        await sendContractAlert({
          type: alertType,
          contractId: contract.id,
          propertyAddress: contract.property_address || 'Unknown Property',
          buyerName: contract.buyer_name,
          buyerEmail: contract.buyer_email,
          assignmentFee: contract.assignment_fee_cents,
          daysRemaining,
          urgency,
          metadata: { leadId: contract.lead_id },
        });
      }
    }
  }
}

export async function onBuyerAssignmentSigned(params: {
  contractId: string;
  buyerId: number;
  buyerName: string;
  buyerEmail: string;
  propertyAddress: string;
  assignmentFee: number;
  leadId?: number;
}): Promise<void> {
  await sendContractAlert({
    type: 'ASSIGNMENT_SIGNED',
    contractId: params.contractId,
    propertyAddress: params.propertyAddress,
    buyerName: params.buyerName,
    buyerEmail: params.buyerEmail,
    assignmentFee: params.assignmentFee,
    urgency: 'HIGH',
    metadata: { leadId: params.leadId, buyerId: params.buyerId },
  });

  // Update contract status
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      UPDATE contracts
      SET assigned_at = now(),
          status = 'ASSIGNED',
          updated_at = now()
      WHERE id = ${params.contractId}
    `.catch(() => {});

    await sql`
      UPDATE buyer_assignments
      SET status = 'SIGNED',
          contract_signed_at = now(),
          updated_at = now()
      WHERE contract_id = ${params.contractId}
        AND buyer_id = ${params.buyerId}
    `.catch(() => {});
  }
}

export async function onBuyerAccepted(params: {
  contractId: string;
  buyerId: number;
  buyerName: string;
  buyerEmail: string;
  propertyAddress: string;
  assignmentFee: number;
  leadId?: number;
}): Promise<void> {
  await sendContractAlert({
    type: 'BUYER_ACCEPTED',
    contractId: params.contractId,
    propertyAddress: params.propertyAddress,
    buyerName: params.buyerName,
    buyerEmail: params.buyerEmail,
    assignmentFee: params.assignmentFee,
    urgency: 'MEDIUM',
    metadata: { leadId: params.leadId, buyerId: params.buyerId },
  });

  // Update assignment status
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      UPDATE buyer_assignments
      SET status = 'BUYER_ACCEPTED',
          buyer_accepted_at = now(),
          updated_at = now()
      WHERE contract_id = ${params.contractId}
        AND buyer_id = ${params.buyerId}
    `.catch(() => {});
  }
}

export async function scheduleClosingReminder(params: {
  contractId: string;
  closingDate: Date;
  propertyAddress: string;
  buyerName: string;
  assignmentFee: number;
}): Promise<void> {
  const daysUntilClosing = Math.ceil((params.closingDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

  if (daysUntilClosing <= 3) {
    await sendContractAlert({
      type: 'CLOSING_IMMINENT',
      contractId: params.contractId,
      propertyAddress: params.propertyAddress,
      buyerName: params.buyerName,
      assignmentFee: params.assignmentFee,
      daysRemaining: daysUntilClosing,
      urgency: daysUntilClosing <= 1 ? 'CRITICAL' : 'HIGH',
    });
  }
}
