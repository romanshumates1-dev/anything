/**
 * Billing entitlements — the ONE place paid access is granted.
 *
 * Both callers are server-side and both must already have established that a
 * payment really happened:
 *
 *   /api/payments/webhook     after signature verification (the production path)
 *   /api/billing/subscribe    dev/test fallback ONLY, NODE_ENV !== 'production'
 *
 * Sources of truth (see the notes at the top of migration 087):
 *   organization_subscriptions   authoritative subscription state
 *   credit_balances              authoritative credit ledger, via addCredits()
 *   billing_events               authoritative billing audit history
 *
 * The `organizations` columns written here are compatibility mirrors kept so the
 * existing readers (billing page, refund path) keep working. Nothing may gate on
 * them.
 */
import sql from './sql';
import { addCredits } from './credits';
import { logEvent } from './logger';

export interface PlanRow {
  id: string;
  name: string;
  tier: string;
  priceCents: number;
  aiCredits: number;
  leads: number;
  sms: number;
  campaigns: number;
  users: number;
  features: unknown;
}

/**
 * Resolve a plan by `tier` ('pro') or by primary key ('plan_pro') and unpack the
 * `limits` JSONB into the flat shape the rest of the app expects.
 *
 * Single definition of the plan shape — /api/billing/subscribe delegates here.
 */
export async function getPlanRow(planId: string): Promise<PlanRow | null> {
  const [row] = await sql`
    SELECT id, name, tier, price_cents, limits
    FROM subscription_plans
    WHERE id = ${planId} OR tier = ${planId}
    ORDER BY (tier = ${planId}) DESC
    LIMIT 1
  `;
  if (!row) return null;

  const plan = row as {
    id: string;
    name: string;
    tier: string;
    price_cents: number | null;
    limits: Record<string, unknown> | null;
  };
  const limits = plan.limits ?? {};

  return {
    id: plan.id,
    name: plan.name,
    tier: plan.tier,
    priceCents: plan.price_cents ?? 0,
    aiCredits: Number(limits.monthly_ai_credits ?? 0),
    leads: Number(limits.monthly_lead_allowance ?? -1),
    sms: Number(limits.monthly_sms_allowance ?? 0),
    campaigns: Number(limits.campaigns ?? 1),
    users: Number(limits.seats ?? 1),
    features: limits.features ?? [],
  };
}

export interface ActivatePlanParams {
  organizationId: string;
  /** `subscription_plans.tier` ('pro') or primary key ('plan_pro'). */
  planId: string;
  /**
   * Stable reference for THIS payment — the Stripe Checkout Session id. Used as
   * the idempotency anchor for the subscription row and the credit grant, so a
   * replayed or retried webhook cannot provision twice.
   */
  processorReference: string;
  /** Stripe customer to persist, when Stripe supplied one. */
  stripeCustomerId?: string | null;
  /** Amount actually paid, in cents. Stored (in dollars) for refund eligibility. */
  amountCents: number;
  /** Stripe event id, recorded for audit only. */
  eventId?: string;
  status?: 'active' | 'trial' | 'past_due';
  trialDays?: number;
}

export interface ActivatePlanResult {
  organizationId: string;
  planTier: string;
  planRowId: string;
  creditsGranted: number;
  alreadyProcessed: boolean;
}

/**
 * Activate a plan for an organization. Idempotent per `processorReference`.
 *
 * Writes the authoritative subscription row first, then the compatibility
 * mirrors, then the credit grant (itself idempotent through addCredits), and
 * finally the audit record.
 */
export async function activatePlan(
  params: ActivatePlanParams
): Promise<ActivatePlanResult> {
  const plan = await getPlanRow(params.planId);
  if (!plan) {
    throw new Error(`[billing] Cannot activate unknown plan "${params.planId}"`);
  }

  const status = params.status ?? 'active';
  const trialEndsAt = params.trialDays
    ? new Date(Date.now() + params.trialDays * 86_400_000).toISOString()
    : null;

  // ── Authoritative: organization_subscriptions ────────────────────────────
  // The processor reference is the idempotency anchor: a replayed webhook must
  // find the row it already wrote rather than mint a second subscription.
  const [existing] = await sql`
    SELECT id
    FROM organization_subscriptions
    WHERE organization_id = ${params.organizationId}
      AND payment_processor_subscription_id = ${params.processorReference}
    LIMIT 1
  `;

  if (existing) {
    await sql`
      UPDATE organization_subscriptions
      SET plan_id = ${plan.id},
          status = ${status},
          current_period_start = NOW(),
          current_period_end = NOW() + INTERVAL '30 days',
          updated_at = NOW()
      WHERE id = ${(existing as { id: string }).id}
    `;
  } else {
    await sql`
      INSERT INTO organization_subscriptions (
        id, organization_id, plan_id, status,
        started_at, current_period_start, current_period_end,
        payment_processor_subscription_id, trial_ends_at, created_at, updated_at
      ) VALUES (
        ${`sub_${crypto.randomUUID().replace(/-/g, '')}`},
        ${params.organizationId},
        ${plan.id},
        ${status},
        NOW(), NOW(), NOW() + INTERVAL '30 days',
        ${params.processorReference},
        ${trialEndsAt},
        NOW(), NOW()
      )
    `;
  }

  // ── Compatibility mirrors on organizations ───────────────────────────────
  await sql`
    UPDATE organizations
    SET subscription_tier = ${plan.tier},
        subscription_price = ${Math.round(params.amountCents / 100)},
        leads_limit = ${plan.leads},
        sms_limit = ${plan.sms},
        campaigns_limit = ${plan.campaigns},
        users_limit = ${plan.users},
        features = ARRAY(
          SELECT jsonb_array_elements_text(${JSON.stringify(plan.features)}::jsonb)
        ),
        trial_ends_at = COALESCE(${trialEndsAt}::timestamptz, trial_ends_at),
        stripe_customer_id = COALESCE(${params.stripeCustomerId ?? null}, stripe_customer_id),
        updated_at = NOW()
    WHERE id = ${params.organizationId}
  `;

  // ── Credits: authoritative ledger, idempotent per payment ────────────────
  let creditsGranted = 0;
  if (plan.aiCredits > 0) {
    const grant = await addCredits(
      params.organizationId,
      plan.aiCredits,
      'PURCHASE',
      `${plan.name} plan credits`,
      {
        planId: plan.id,
        planTier: plan.tier,
        processorReference: params.processorReference,
        eventId: params.eventId ?? null,
      },
      // Stable key: a replayed webhook re-reads the same ledger row instead of
      // granting a second time.
      `plan-credits:${params.processorReference}`
    );
    if (!grant.isDuplicate) creditsGranted = plan.aiCredits;
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  await sql`
    INSERT INTO billing_events (id, organization_id, event_type, amount, metadata, created_at)
    VALUES (
      ${crypto.randomUUID()},
      ${params.organizationId},
      'subscription_activated',
      ${params.amountCents / 100},
      ${JSON.stringify({
        plan_id: plan.id,
        plan_tier: plan.tier,
        processor_reference: params.processorReference,
        event_id: params.eventId ?? null,
        credits_granted: creditsGranted,
        stripe_customer_id: params.stripeCustomerId ?? null,
        already_processed: Boolean(existing),
      })}::jsonb,
      NOW()
    )
  `;

  await logEvent('subscription_activated', 'billing', params.organizationId, {
    plan: plan.tier,
    planRowId: plan.id,
    amountCents: params.amountCents,
    creditsGranted,
    processorReference: params.processorReference,
  });

  return {
    organizationId: params.organizationId,
    planTier: plan.tier,
    planRowId: plan.id,
    creditsGranted,
    alreadyProcessed: Boolean(existing),
  };
}

export interface GrantCreditPackParams {
  organizationId: string;
  credits: number;
  amountCents: number;
  packId: string;
  /**
   * Stable per-payment key — use the Stripe event id. addCredits enforces it via
   * a unique index, which is what makes a retried webhook safe.
   */
  idempotencyKey: string;
  eventId?: string;
  metadata?: Record<string, unknown>;
  /**
   * Stripe customer id from the verified session. Persisted (only when the
   * organization has none) so repeat purchases reuse one customer.
   */
  stripeCustomerId?: string | null;
}

export interface GrantCreditPackResult {
  creditsGranted: number;
  balance: number;
  alreadyProcessed: boolean;
}

/**
 * Grant purchased credits. Idempotent per `idempotencyKey`.
 *
 * On a replay it reports `alreadyProcessed` and writes NOTHING else — no mirror
 * bump and no audit row — so neither the balance nor the billing history can be
 * inflated by a duplicate delivery.
 */
export async function grantCreditPack(
  params: GrantCreditPackParams
): Promise<GrantCreditPackResult> {
  const grant = await addCredits(
    params.organizationId,
    params.credits,
    'PURCHASE',
    `Credit pack purchase: ${params.credits.toLocaleString()} credits`,
    {
      packId: params.packId,
      eventId: params.eventId ?? null,
      ...(params.metadata ?? {}),
    },
    params.idempotencyKey
  );

  // Persist the customer even on a replay, and only when we do not already have
  // one — this is what guarantees a single Stripe customer per organization.
  if (params.stripeCustomerId) {
    await sql`
      UPDATE organizations
      SET stripe_customer_id = ${params.stripeCustomerId}, updated_at = NOW()
      WHERE id = ${params.organizationId}
        AND stripe_customer_id IS NULL
    `;
  }

  const alreadyProcessed = grant.isDuplicate === true;
  if (alreadyProcessed) {
    await logEvent('credit_purchase_replayed', 'billing', params.organizationId, {
      packId: params.packId,
      idempotencyKey: params.idempotencyKey,
    });
    return { creditsGranted: 0, balance: grant.balance, alreadyProcessed: true };
  }

  // Compatibility mirror. Only reached on a genuine first grant, which the
  // ledger's idempotency key guarantees.
  await sql`
    UPDATE organizations
    SET ai_credits = COALESCE(ai_credits, 0) + ${params.credits},
        updated_at = NOW()
    WHERE id = ${params.organizationId}
  `;

  await sql`
    INSERT INTO billing_events (id, organization_id, event_type, amount, metadata, created_at)
    VALUES (
      ${crypto.randomUUID()},
      ${params.organizationId},
      'credit_purchase',
      ${params.amountCents / 100},
      ${JSON.stringify({
        pack_id: params.packId,
        credits: params.credits,
        idempotency_key: params.idempotencyKey,
        event_id: params.eventId ?? null,
      })}::jsonb,
      NOW()
    )
  `;

  await logEvent('credits_purchased', 'billing', params.organizationId, {
    credits: params.credits,
    packId: params.packId,
    idempotencyKey: params.idempotencyKey,
  });

  return {
    creditsGranted: params.credits,
    balance: grant.balance,
    alreadyProcessed: false,
  };
}

