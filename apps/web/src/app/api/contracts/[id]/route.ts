import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { onContractClosed } from '@/app/api/utils/earningsEscrow';

const VALID_STATUSES = ['DRAFT', 'PENDING_SIGNATURE', 'SIGNED', 'CLOSED', 'EXPIRED', 'CANCELLED'];

/**
 * GET /api/contracts/[id]
 * Get a single contract by ID.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const { id } = await params;
    const orgId = organization.id;

    const [contract] = await sql`
      SELECT
        c.id,
        c.direction,
        c.status,
        c.signed_at,
        c.created_at,
        c.inspection_days,
        c.assigned_at,
        c.esign_status,
        c.contract_price_cents,
        c.assignment_fee_cents,
        c.metadata,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'id', e.id,
            'event_type', e.event_type,
            'event_data', e.event_data,
            'created_at', e.created_at
          ) ORDER BY e.created_at ASC)
          FROM esign_events e
          WHERE e.contract_id = c.id),
          '[]'::json
        ) as esign_events,
        (SELECT json_build_object(
          'id', p.id,
          'amount_cents', p.amount_cents,
          'currency', p.currency,
          'status', p.status,
          'stripe_payment_intent_id', p.stripe_payment_intent_id,
          'paid_at', p.paid_at,
          'refunded_at', p.refunded_at,
          'reason', p.reason,
          'created_at', p.created_at
        )
        FROM payments_ledger p
        WHERE p.contract_id = c.id
        ORDER BY p.created_at DESC
        LIMIT 1) as payment
      FROM contracts c
      WHERE c.id = ${id}
        AND c.organization_id = ${orgId}
      LIMIT 1
    `;

    if (!contract) {
      return Response.json({ error: 'Contract not found' }, { status: 404 });
    }

    return Response.json(contract);
  } catch (error: any) {
    console.error('GET /api/contracts/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/contracts/[id]
 * Update contract status. When status changes to CLOSED, creates an earning
 * with escrow hold period.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status, assignmentFeeCents, metadata } = body;

    const userId = session.user.id;
    const orgId = organization.id;

    // Get current contract
    const [contract] = await sql`
      SELECT id, status, assignment_fee_cents, organization_id
      FROM contracts
      WHERE id = ${id}
        AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!contract) {
      return Response.json({ error: 'Contract not found' }, { status: 404 });
    }

    // Validate status if provided
    if (status && !VALID_STATUSES.includes(status)) {
      return Response.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (status) {
      updates.push('status');
      values.push(status);
    }

    if (assignmentFeeCents !== undefined) {
      updates.push('assignment_fee_cents');
      values.push(assignmentFeeCents);
    }

    if (metadata) {
      updates.push('metadata');
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      return Response.json({ error: 'No updates provided' }, { status: 400 });
    }

    // Perform update
    if (status) {
      await sql`
        UPDATE contracts
        SET status = ${status},
            assignment_fee_cents = COALESCE(${assignmentFeeCents ?? null}, assignment_fee_cents),
            metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata),
            updated_at = NOW()
        WHERE id = ${id}
      `;
    } else {
      await sql`
        UPDATE contracts
        SET assignment_fee_cents = COALESCE(${assignmentFeeCents ?? null}, assignment_fee_cents),
            metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata),
            updated_at = NOW()
        WHERE id = ${id}
      `;
    }

    // If status changed to CLOSED, create earning
    if (status === 'CLOSED' && contract.status !== 'CLOSED') {
      const feeCents = assignmentFeeCents || contract.assignment_fee_cents;

      if (feeCents && feeCents > 0) {
        try {
          await onContractClosed({
            contractId: id,
            organizationId: orgId,
            userId,
            assignmentFeeCents: feeCents,
          });

          // Log the earning creation
          await sql`
            INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
            VALUES (
              ${userId},
              'contract_closed_earning_created',
              'contract',
              ${id},
              ${JSON.stringify({
                assignment_fee_cents: feeCents,
                previous_status: contract.status,
              })}
            )
          `;
        } catch (error: any) {
          console.error(`Failed to create earning for contract ${id}:`, error);
          // Don't fail the request, just log the error
        }
      }
    }

    // Log the status change
    await sql`
      INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
      VALUES (
        ${userId},
        'contract_updated',
        'contract',
        ${id},
        ${JSON.stringify({
          previous_status: contract.status,
          new_status: status || contract.status,
          updates,
        })}
      )
    `;

    return Response.json({
      success: true,
      contractId: id,
      previousStatus: contract.status,
      newStatus: status || contract.status,
    });
  } catch (error: any) {
    console.error('PATCH /api/contracts/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
