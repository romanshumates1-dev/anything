/**
 * Closing Portal API
 *
 * Web-based closing management:
 * - Document uploads
 * - Wire/check preference
 * - Notary scheduling
 * - Progress tracking
 *
 * No phone calls required - fully autonomous.
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

interface ClosingStatus {
  leadId: string;
  propertyAddress: string;
  purchasePrice: number;
  closingDate: string;
  status: 'pending_docs' | 'docs_received' | 'title_clear' | 'scheduled' | 'closing_day' | 'completed';
  progress: number;
  steps: {
    id: string;
    name: string;
    status: 'pending' | 'in_progress' | 'completed';
    completedAt?: string;
  }[];
  pendingActions: {
    action: string;
    description: string;
    url: string;
    required: boolean;
  }[];
  disbursement?: {
    method: 'wire' | 'check';
    amount: number;
    status: 'pending' | 'sent' | 'received';
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const leadId = url.searchParams.get('lead') || url.searchParams.get('leadId');

  if (!leadId) {
    return Response.json({ error: 'leadId required' }, { status: 400 });
  }

  try {
    // Get lead and closing info
    const [lead] = await sql`
      SELECT
        l.id,
        l.name as owner_name,
        l.address as property_address,
        l.status,
        l.metadata,
        v.offer_cents
      FROM leads l
      LEFT JOIN property_valuations v ON v.lead_id = l.id
      WHERE l.id = ${leadId}
      ORDER BY v.created_at DESC NULLS LAST
      LIMIT 1
    `.catch(() => [null]);

    // Check for closing record
    const [closing] = await sql`
      SELECT * FROM closings WHERE lead_id = ${leadId}
    `.catch(() => [null]);

    const metadata = lead?.metadata || {};
    const purchasePrice = lead?.offer_cents ? lead.offer_cents / 100 : metadata.acceptedAmount || 150000;

    // Determine status and steps
    const steps: { id: string; name: string; status: 'pending' | 'in_progress' | 'completed' }[] = [
      { id: 'contract', name: 'Contract Signed', status: closing?.contract_signed ? 'completed' : 'pending' },
      { id: 'docs', name: 'Documents Uploaded', status: closing?.docs_received ? 'completed' : 'pending' },
      { id: 'title', name: 'Title Search Complete', status: closing?.title_clear ? 'completed' : 'pending' },
      { id: 'notary', name: 'Notary Scheduled', status: closing?.notary_scheduled ? 'completed' : 'pending' },
      { id: 'closing', name: 'Closing Complete', status: closing?.completed_at ? 'completed' : 'pending' },
    ];

    const completedSteps = steps.filter(s => s.status === 'completed').length;
    const progress = Math.round((completedSteps / steps.length) * 100);

    // Determine current status
    let status: ClosingStatus['status'] = 'pending_docs';
    if (closing?.completed_at) status = 'completed';
    else if (closing?.notary_scheduled) status = 'closing_day';
    else if (closing?.title_clear) status = 'scheduled';
    else if (closing?.docs_received) status = 'title_clear';
    else if (closing?.contract_signed) status = 'docs_received';

    // Pending actions
    const pendingActions: ClosingStatus['pendingActions'] = [];

    if (!closing?.docs_received) {
      pendingActions.push({
        action: 'upload_docs',
        description: 'Upload required documents (ID, utility bill)',
        url: `/api/portal/closing/upload?lead=${leadId}`,
        required: true,
      });
    }

    if (!closing?.disbursement_method) {
      pendingActions.push({
        action: 'set_payment',
        description: 'Select payment method (wire or check)',
        url: `/api/portal/closing/payment?lead=${leadId}`,
        required: true,
      });
    }

    if (!closing?.notary_scheduled && closing?.title_clear) {
      pendingActions.push({
        action: 'schedule_notary',
        description: 'Schedule mobile notary appointment',
        url: `/api/portal/closing/notary?lead=${leadId}`,
        required: true,
      });
    }

    const closingStatus: ClosingStatus = {
      leadId,
      propertyAddress: lead?.property_address || 'Address on file',
      purchasePrice,
      closingDate: closing?.closing_date || metadata.preferredClosingDate || 'TBD',
      status,
      progress,
      steps,
      pendingActions,
      disbursement: closing?.disbursement_method ? {
        method: closing.disbursement_method,
        amount: purchasePrice,
        status: closing.disbursement_sent ? 'sent' : 'pending',
      } : undefined,
    };

    await logEvent('closing_portal_viewed', 'lead', leadId, { status, progress });

    return Response.json({
      closing: closingStatus,
      contacts: {
        titleCompany: {
          name: 'Premier Title Services',
          email: 'closings@premiertitle.example.com',
        },
        escrowOfficer: {
          name: 'Closing Team',
          email: 'escrow@dealswift.example.com',
        },
      },
      documents: {
        required: [
          { name: 'Government-issued ID', description: 'Driver license or passport' },
          { name: 'Proof of residence', description: 'Utility bill or bank statement' },
        ],
        optional: [
          { name: 'Mortgage payoff statement', description: 'If there is an existing mortgage' },
          { name: 'HOA clearance letter', description: 'If property is in an HOA' },
        ],
      },
    });
  } catch (err: any) {
    console.error('[CLOSING-PORTAL] Error:', err);
    return Response.json({ error: 'Failed to load closing status' }, { status: 500 });
  }
}

interface ClosingUpdate {
  leadId: string;
  action: 'upload_docs' | 'set_payment' | 'schedule_notary';
  data: {
    // For upload_docs
    documentType?: string;
    documentUrl?: string;
    // For set_payment
    paymentMethod?: 'wire' | 'check';
    bankName?: string;
    accountLast4?: string;
    routingLast4?: string;
    // For schedule_notary
    preferredDate?: string;
    preferredTime?: string;
    address?: string;
  };
}

export async function POST(req: NextRequest) {
  let body: ClosingUpdate;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { leadId, action, data } = body;

  if (!leadId || !action) {
    return Response.json({ error: 'leadId and action required' }, { status: 400 });
  }

  try {
    // Ensure closing record exists
    await sql`
      INSERT INTO closings (lead_id, status, created_at)
      VALUES (${leadId}, 'pending', NOW())
      ON CONFLICT (lead_id) DO NOTHING
    `.catch(() => {});

    switch (action) {
      case 'upload_docs': {
        if (!data.documentType || !data.documentUrl) {
          return Response.json({ error: 'documentType and documentUrl required' }, { status: 400 });
        }

        await sql`
          UPDATE closings
          SET docs_received = true,
              docs_received_at = NOW(),
              documents = COALESCE(documents, '[]'::jsonb) || ${JSON.stringify([{
                type: data.documentType,
                url: data.documentUrl,
                uploadedAt: new Date().toISOString(),
              }])}::jsonb,
              updated_at = NOW()
          WHERE lead_id = ${leadId}
        `;

        await logEvent('closing_docs_uploaded', 'lead', leadId, { documentType: data.documentType });

        return Response.json({
          success: true,
          message: 'Document uploaded successfully',
          nextStep: 'Title search will begin within 24 hours',
        });
      }

      case 'set_payment': {
        if (!data.paymentMethod) {
          return Response.json({ error: 'paymentMethod required' }, { status: 400 });
        }

        await sql`
          UPDATE closings
          SET disbursement_method = ${data.paymentMethod},
              disbursement_details = ${JSON.stringify({
                method: data.paymentMethod,
                bankName: data.bankName,
                accountLast4: data.accountLast4,
                routingLast4: data.routingLast4,
                setAt: new Date().toISOString(),
              })}::jsonb,
              updated_at = NOW()
          WHERE lead_id = ${leadId}
        `;

        await logEvent('closing_payment_set', 'lead', leadId, { method: data.paymentMethod });

        return Response.json({
          success: true,
          message: `Payment method set to ${data.paymentMethod}`,
          note: data.paymentMethod === 'wire'
            ? 'Funds will wire same-day after closing'
            : 'Check will be available at closing or mailed within 1-2 business days',
        });
      }

      case 'schedule_notary': {
        if (!data.preferredDate || !data.preferredTime) {
          return Response.json({ error: 'preferredDate and preferredTime required' }, { status: 400 });
        }

        await sql`
          UPDATE closings
          SET notary_scheduled = true,
              notary_date = ${data.preferredDate},
              notary_time = ${data.preferredTime},
              notary_address = ${data.address || null},
              updated_at = NOW()
          WHERE lead_id = ${leadId}
        `;

        await logEvent('closing_notary_scheduled', 'lead', leadId, {
          date: data.preferredDate,
          time: data.preferredTime,
        });

        return Response.json({
          success: true,
          message: 'Mobile notary scheduled',
          appointment: {
            date: data.preferredDate,
            time: data.preferredTime,
            location: data.address || 'Property address on file',
          },
          note: 'You will receive a confirmation email with notary details',
        });
      }

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[CLOSING-PORTAL] POST Error:', err);
    return Response.json({ error: 'Failed to process action' }, { status: 500 });
  }
}
