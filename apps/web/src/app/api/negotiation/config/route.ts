/**
 * GET/PATCH /api/negotiation/config
 *
 * Manage organization-level negotiation configuration.
 */
import { requireSession } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { validateNegotiationConfig, DEFAULT_NEGOTIATION_CONFIG } from '@/app/api/utils/negotiationEngine';

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  const [row] = await sql`
    SELECT * FROM pipeline_config WHERE organization_id = ${organization.id}
  `;

  return Response.json({
    autoNegotiation: row?.auto_negotiation ?? true,
    strategy: row?.negotiation_strategy ?? 'balanced',
    autoApproveUnderCents: row?.deal_auto_approve_max_cents ?? DEFAULT_NEGOTIATION_CONFIG.autoApproveUnderCents,
    escalateOverCents: row?.negotiation_escalate_over_cents ?? DEFAULT_NEGOTIATION_CONFIG.escalateOverCents,
    maxRounds: row?.negotiation_max_rounds ?? DEFAULT_NEGOTIATION_CONFIG.maxRounds,
    defaultFeeFloorCents: row?.negotiation_fee_floor_cents ?? DEFAULT_NEGOTIATION_CONFIG.feeFloorCents,
    useAIPricing: row?.use_ai_pricing ?? false,
  });
}

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  // Validate config if relevant fields are being updated
  if (body.autoApproveUnderCents || body.escalateOverCents || body.maxRounds || body.strategy) {
    const validationError = validateNegotiationConfig({
      autoApproveUnderCents: body.autoApproveUnderCents,
      escalateOverCents: body.escalateOverCents,
      maxRounds: body.maxRounds,
      strategy: body.strategy,
    });
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }
  }

  // Ensure row exists
  await sql`
    INSERT INTO pipeline_config (organization_id)
    VALUES (${organization.id})
    ON CONFLICT (organization_id) DO NOTHING
  `;

  // Build update
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.autoNegotiation !== undefined) {
    updates.push(`auto_negotiation = $${values.length + 1}`);
    values.push(body.autoNegotiation);
  }
  if (body.strategy !== undefined) {
    updates.push(`negotiation_strategy = $${values.length + 1}`);
    values.push(body.strategy);
  }
  if (body.autoApproveUnderCents !== undefined) {
    updates.push(`deal_auto_approve_max_cents = $${values.length + 1}`);
    values.push(body.autoApproveUnderCents);
  }
  if (body.escalateOverCents !== undefined) {
    updates.push(`negotiation_escalate_over_cents = $${values.length + 1}`);
    values.push(body.escalateOverCents);
  }
  if (body.maxRounds !== undefined) {
    updates.push(`negotiation_max_rounds = $${values.length + 1}`);
    values.push(body.maxRounds);
  }
  if (body.defaultFeeFloorCents !== undefined) {
    updates.push(`negotiation_fee_floor_cents = $${values.length + 1}`);
    values.push(body.defaultFeeFloorCents);
  }
  if (body.useAIPricing !== undefined) {
    updates.push(`use_ai_pricing = $${values.length + 1}`);
    values.push(body.useAIPricing);
  }

  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    await sql`
      UPDATE pipeline_config
      SET ${sql.unsafe(updates.join(', '))}
      WHERE organization_id = ${organization.id}
    `;
  }

  // Return updated config
  const [row] = await sql`
    SELECT * FROM pipeline_config WHERE organization_id = ${organization.id}
  `;

  return Response.json({
    autoNegotiation: row?.auto_negotiation ?? true,
    strategy: row?.negotiation_strategy ?? 'balanced',
    autoApproveUnderCents: row?.deal_auto_approve_max_cents ?? DEFAULT_NEGOTIATION_CONFIG.autoApproveUnderCents,
    escalateOverCents: row?.negotiation_escalate_over_cents ?? DEFAULT_NEGOTIATION_CONFIG.escalateOverCents,
    maxRounds: row?.negotiation_max_rounds ?? DEFAULT_NEGOTIATION_CONFIG.maxRounds,
    defaultFeeFloorCents: row?.negotiation_fee_floor_cents ?? DEFAULT_NEGOTIATION_CONFIG.feeFloorCents,
    useAIPricing: row?.use_ai_pricing ?? false,
  });
}
