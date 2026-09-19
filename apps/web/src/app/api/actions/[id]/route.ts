/**
 * Single Action API
 *
 * GET /api/actions/[id] - Get action details
 * POST /api/actions/[id] - Execute action (complete, skip, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import {
  completeAction,
  skipAction,
} from '@/app/api/utils/pipelineOrchestrator';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [action] = await sql`
      SELECT * FROM action_queue
      WHERE id = ${id}
        AND organization_id = ${organization.id}
    `;

    if (!action) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    // Get related entity data if available
    let entityData = null;
    if (action.entity_type && action.entity_id) {
      entityData = await getEntityData(action.entity_type, action.entity_id);
    }

    return NextResponse.json({
      ...action,
      entityData,
    });
  } catch (error: unknown) {
    console.error('[actions] GET [id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch action' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { action, notes } = body as { action: string; notes?: string };

    if (!action) {
      return NextResponse.json(
        { error: 'action is required' },
        { status: 400 }
      );
    }

    // Verify ownership
    const [actionItem] = await sql`
      SELECT * FROM action_queue
      WHERE id = ${id}
        AND organization_id = ${organization.id}
        AND status = 'PENDING'
    `;

    if (!actionItem) {
      return NextResponse.json(
        { error: 'Action not found or already completed' },
        { status: 404 }
      );
    }

    // Handle special actions
    if (action === 'skip') {
      await skipAction(id, session.user.id, notes || 'Skipped by user');
      return NextResponse.json({ success: true, status: 'SKIPPED' });
    }

    // Execute the action based on type and action
    const result = await executeAction(
      actionItem,
      action,
      session.user.id,
      organization.id,
      notes
    );

    // Complete the action
    await completeAction(id, session.user.id, action, notes);

    return NextResponse.json({
      success: true,
      status: 'COMPLETED',
      result,
    });
  } catch (error: unknown) {
    console.error('[actions] POST [id] error:', error);
    return NextResponse.json(
      { error: 'Failed to execute action' },
      { status: 500 }
    );
  }
}

async function getEntityData(
  entityType: string,
  entityId: string
): Promise<Record<string, unknown> | null> {
  try {
    switch (entityType) {
      case 'lead': {
        const [lead] = await sql`
          SELECT id, name, email, phone, status, metadata, created_at
          FROM leads WHERE id = ${entityId}
        `;
        return lead || null;
      }

      case 'conversation': {
        const [conv] = await sql`
          SELECT ac.*, l.name as lead_name, l.phone as lead_phone
          FROM ai_conversations ac
          JOIN leads l ON l.id = ac.lead_id
          WHERE ac.id = ${entityId}
        `;
        return conv || null;
      }

      case 'negotiation': {
        const [session] = await sql`
          SELECT ns.*, l.name as lead_name
          FROM negotiation_sessions ns
          JOIN leads l ON l.id = ns.lead_id
          WHERE ns.id = ${entityId}
        `;
        return session || null;
      }

      case 'contract': {
        const [contract] = await sql`
          SELECT c.*, l.name as lead_name
          FROM contracts c
          LEFT JOIN leads l ON l.id = c.seller_lead_id
          WHERE c.id = ${entityId}
        `;
        return contract || null;
      }

      case 'campaign': {
        const [campaign] = await sql`
          SELECT * FROM outreach_campaigns WHERE id = ${entityId}
        `;
        return campaign || null;
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function executeAction(
  actionItem: Record<string, unknown>,
  action: string,
  userId: string,
  organizationId: string,
  notes?: string
): Promise<Record<string, unknown>> {
  const entityType = actionItem.entity_type as string;
  const entityId = actionItem.entity_id as string;
  const actionType = actionItem.type as string;

  switch (actionType) {
    case 'REVIEW_DEAL': {
      if (action === 'approve') {
        // Approve the deal, generate contract
        const [session] = await sql`
          SELECT * FROM negotiation_sessions WHERE id = ${entityId}
        `;
        if (session) {
          await enqueueJob('generate_contract_auto', {
            organizationId,
            negotiationSessionId: entityId,
            leadId: session.lead_id,
            priceCents: session.accepted_price_cents,
          });
        }
        return { dealApproved: true };
      } else if (action === 'reject') {
        await sql`
          UPDATE negotiation_sessions
          SET status = 'REJECTED', updated_at = NOW()
          WHERE id = ${entityId}
        `;
        return { dealRejected: true };
      } else if (action === 'renegotiate') {
        await sql`
          UPDATE negotiation_sessions
          SET status = 'ACTIVE', awaiting_response = false, updated_at = NOW()
          WHERE id = ${entityId}
        `;
        return { renegotiating: true };
      }
      break;
    }

    case 'APPROVE_CONTRACT': {
      if (action === 'approve_send') {
        // Send the contract
        const [contract] = await sql`
          SELECT c.*, l.email
          FROM contracts c
          LEFT JOIN leads l ON l.id = c.seller_lead_id
          WHERE c.id = ${entityId}
        `;
        if (contract) {
          await enqueueJob('send_contract', {
            organizationId,
            contractId: entityId,
            leadId: contract.seller_lead_id,
            email: contract.email,
          });

          await sql`
            UPDATE contracts
            SET status = 'PENDING_SIGNATURE', updated_at = NOW()
            WHERE id = ${entityId}
          `;
        }
        return { contractSent: true };
      } else if (action === 'reject') {
        await sql`
          UPDATE contracts
          SET status = 'REJECTED', updated_at = NOW()
          WHERE id = ${entityId}
        `;
        return { contractRejected: true };
      }
      break;
    }

    case 'CONFIRM_CLOSING': {
      if (action === 'confirm_closed') {
        // Confirm the deal closed
        await sql`
          UPDATE contracts
          SET status = 'CLOSED', closing_confirmed_at = NOW(), updated_at = NOW()
          WHERE id = ${entityId}
        `;

        // Update lead status
        const [contract] = await sql`
          SELECT seller_lead_id FROM contracts WHERE id = ${entityId}
        `;
        if (contract?.seller_lead_id) {
          await sql`
            UPDATE leads SET status = 'CLOSED', updated_at = NOW()
            WHERE id = ${contract.seller_lead_id}
          `;
        }

        await logEvent('deal_closed', 'contract', entityId, {
          confirmedBy: userId,
        }, organizationId);

        return { closed: true };
      } else if (action === 'mark_cancelled') {
        await sql`
          UPDATE contracts
          SET status = 'CANCELLED', updated_at = NOW()
          WHERE id = ${entityId}
        `;
        return { cancelled: true };
      } else if (action === 'extend') {
        // Just acknowledge - user needs to update closing date separately
        return { extensionRequested: true, notes };
      }
      break;
    }

    case 'REVIEW_RESPONSE': {
      if (action === 'approve_ai') {
        // Let AI continue the conversation
        await sql`
          UPDATE ai_conversations
          SET requires_human = false, status = 'active', updated_at = NOW()
          WHERE id = ${entityId}
        `;
        return { aiContinuing: true };
      } else if (action === 'respond_manual') {
        // Mark for manual response - user will respond in inbox
        await sql`
          UPDATE ai_conversations
          SET status = 'manual_response', updated_at = NOW()
          WHERE id = ${entityId}
        `;
        return { manualResponse: true };
      } else if (action === 'escalate') {
        await sql`
          UPDATE ai_conversations
          SET status = 'escalated', updated_at = NOW()
          WHERE id = ${entityId}
        `;
        return { escalated: true };
      }
      break;
    }

    case 'ESCALATION':
    case 'EXCEPTION': {
      // Generic handling - just log the resolution
      await logEvent('action_resolved', 'action_queue', actionItem.id as string, {
        action,
        notes,
        resolvedBy: userId,
      }, organizationId);
      return { resolved: true };
    }
  }

  return { acknowledged: true };
}
