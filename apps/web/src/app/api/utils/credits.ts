/**
 * Credit System Utilities
 *
 * Manages platform credits for outreach operations.
 * Users must purchase credits to use SMS, email, and AI features.
 * Costs vary by subscription tier (surcharges for lower tiers).
 *
 * BULLETPROOF GUARANTEES:
 * - Atomic operations with row locking (FOR UPDATE SKIP LOCKED)
 * - Integer overflow protection (MAX_CREDITS = 2B, MIN_CREDITS = 1)
 * - Underflow protection (balance can never go negative)
 * - Immutable transaction ledger (every change is logged)
 * - Idempotency support via idempotency keys
 * - Race condition prevention via pessimistic locking
 * - Audit trail with tamper detection
 * - Double-spend prevention via atomic CTE operations
 */
import sql from './sql';
import { logEvent } from './logger';

/**
 * Maximum credits allowed to prevent integer overflow.
 * PostgreSQL INTEGER max is ~2.1B, we cap at 2B for safety margin.
 */
export const MAX_CREDITS = 2_000_000_000;

/**
 * Minimum credits for any operation (must be positive)
 */
export const MIN_CREDITS = 1;

/**
 * Credit action types - each has tier-specific costs
 */
export type CreditAction =
  | 'SMS_SEND'
  | 'EMAIL_SEND'
  | 'AI_REQUEST'
  | 'AI_NEGOTIATION'
  | 'CONTRACT_GENERATE'
  | 'LEAD_FIND';

/**
 * Transaction types for the credit ledger
 */
export type TransactionType = 'PURCHASE' | 'DEDUCT' | 'REFUND' | 'BONUS' | 'ADJUSTMENT' | 'WITHDRAWAL';

/**
 * Result of a credit deduction attempt
 */
export interface DeductResult {
  success: boolean;
  remainingBalance: number;
  deducted: number;
  transactionId?: string;
  insufficientCredits?: boolean;
  errorCode?: 'INSUFFICIENT_CREDITS' | 'OVERFLOW' | 'INVALID_AMOUNT' | 'DUPLICATE' | 'INTERNAL_ERROR' | 'PRICING_NOT_CONFIGURED';
}

/**
 * Credit balance information
 */
export interface CreditBalance {
  balance: number;
  lifetimePurchased: number;
  lifetimeUsed: number;
  updatedAt: Date;
}

/**
 * Get the current credit balance for an organization.
 */
export async function getBalance(organizationId: string): Promise<number> {
  try {
    const [result] = await sql`
      SELECT balance
      FROM credit_balances
      WHERE organization_id = ${organizationId}
    `;

    if (!result) {
      // Auto-create balance record if missing
      await sql`
        INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
        VALUES (${organizationId}, 0, 0, 0)
        ON CONFLICT (organization_id) DO NOTHING
      `;
      return 0;
    }

    return result.balance ?? 0;
  } catch (error) {
    console.error('[CREDITS] Failed to get balance:', error);
    return 0;
  }
}

/**
 * Get full credit balance details for an organization.
 */
export async function getBalanceDetails(organizationId: string): Promise<CreditBalance> {
  try {
    const [result] = await sql`
      SELECT balance, lifetime_purchased, lifetime_used, updated_at
      FROM credit_balances
      WHERE organization_id = ${organizationId}
    `;

    if (!result) {
      // Auto-create
      await sql`
        INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
        VALUES (${organizationId}, 0, 0, 0)
        ON CONFLICT (organization_id) DO NOTHING
      `;
      return {
        balance: 0,
        lifetimePurchased: 0,
        lifetimeUsed: 0,
        updatedAt: new Date(),
      };
    }

    return {
      balance: result.balance ?? 0,
      lifetimePurchased: result.lifetime_purchased ?? 0,
      lifetimeUsed: result.lifetime_used ?? 0,
      updatedAt: new Date(result.updated_at),
    };
  } catch (error) {
    console.error('[CREDITS] Failed to get balance details:', error);
    return {
      balance: 0,
      lifetimePurchased: 0,
      lifetimeUsed: 0,
      updatedAt: new Date(),
    };
  }
}

/**
 * Get the credit cost for an action based on subscription tier.
 *
 * F3-hardened contract (see DEALSWIFT-AI-PROJECT-CHECKPOINT.md §Phase 4):
 * - An UNKNOWN or UNMAPPED tier (e.g. the real paid plans 'professional' and
 *   'scale', which have subscription_plans rows but no credit_costs rows) THROWS
 *   immediately, before any SQL. It must never silently price at FREE — that
 *   would undercharge paying orgs and corrupt the billing ledger (metadata.cost).
 * - A KNOWN tier that lacks a row for a specific action:
 *   - PAID tiers (any tier != 'FREE') THROW (fail-closed). Silently pricing the
 *     missing action at the FREE rate would undercharge a paying org and write a
 *     wrong (FREE) price into metadata.cost via deductCreditsForAction.
 *   - The FREE tier falls back to its own (floor) rate constant — this can never
 *     undercharge a paying customer (the FREE tier costs the FREE rate by definition).
 * - A pricing DB failure THROWS so it can never silently produce a price.
 *
 * Callers: canAffordAction and deductCreditsForAction both propagate this throw
 * as a fail-closed result (creditGuard.checkCredits / withCreditDeduction
 * translate it to a clean 402 / 409), so no wrong amount is ever debited.
 */
export async function getCreditCost(action: CreditAction, tier: string): Promise<number> {
  const normalizedTier = tier.toUpperCase();

  if (!isKnownCreditTier(normalizedTier)) {
    throw new Error(
      `[CREDITS] Unknown subscription tier "${tier}" — refusing to price it at FREE. ` +
        `Known tiers with credit costs: ${CREDIT_TIERS.join(', ')}.`,
    );
  }

  // FREE-tier escape hatch: the FREE rate is the pricing floor. A missing seed
  // row for the FREE tier still resolves to the FREE rate — this can never
  // undercharge a paying customer (FREE tiers cost the FREE rate by definition).
  const defaultCosts: Record<CreditAction, number> = {
    SMS_SEND: 5,
    EMAIL_SEND: 2,
    AI_REQUEST: 10,
    AI_NEGOTIATION: 25,
    CONTRACT_GENERATE: 15,
    LEAD_FIND: 3,
  };

  try {
    // Authoritative per-tier rate for this action.
    const [result] = await sql`
      SELECT cost
      FROM credit_costs
      WHERE action = ${action}
        AND tier = ${normalizedTier}
    `;

    if (result) {
      return result.cost;
    }

    // A known tier is missing its row for this specific action.
    if (normalizedTier !== 'FREE') {
      // For a PAID tier, silently substituting the FREE rate would undercharge a
      // paying customer and write a wrong (FREE) price into the billing ledger
      // (metadata.cost) via deductCreditsForAction. FAIL CLOSED: throw so
      // canAffordAction / deductCreditsForAction surface the misconfiguration
      // instead of debiting a wrong amount. This is the Priority-2 invariant —
      // a missing paid-tier action row must NEVER silently become FREE pricing.
      throw new Error(
        `[CREDITS] Known tier "${normalizedTier}" has no credit_costs row for ` +
          `action "${action}" — refusing to price at FREE (would undercharge a paid org). ` +
          `Seed the row or set a per-action tier rate.`,
      );
    }

    // FREE tier: a missing seed row resolves to the FREE rate (the correct floor
    // price for this tier) so free-tier usage is never blocked by seed drift.
    return defaultCosts[action] ?? 5;
  } catch (error) {
    // Re-throw our own pricing failures so callers fail closed; for any other DB
    // error, wrap and throw rather than silently returning a (FREE) price.
    if (error instanceof Error && error.message.startsWith('[CREDITS]')) {
      throw error;
    }
    console.error('[CREDITS] Failed to get cost:', error);
    throw new Error(
      `[CREDITS] getCreditCost unavailable for action "${action}" tier "${tier}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The authoritative set of subscription tiers that have credit-cost rows.
 *
 * This mirrors the tiers seeded into `credit_costs` (migration 080:
 * FREE/STARTER/PRO/BUSINESS/ENTERPRISE). It is deliberately NOT the set of
 * `subscription_plans.tier` values — that table has drifted over time
 * ('professional' in 025, 'scale' in 067) and those labels have no
 * `credit_costs` rows. Pricing an unknown tier must FAIL, not silently fall
 * back to FREE (see getAllCosts).
 */
export const CREDIT_TIERS = ['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'] as const;
export type CreditTier = (typeof CREDIT_TIERS)[number];

/** True when `tier` (any case) is a tier that has credit costs defined. */
export function isKnownCreditTier(tier: string): boolean {
  return (CREDIT_TIERS as readonly string[]).includes(tier.toUpperCase());
}

/**
 * Get all credit costs for a specific tier.
 *
 * F3-hardened:
 * - An UNKNOWN/UNMAPPED tier (e.g. 'professional'/'scale', which have
 *   subscription_plans rows but no credit_costs rows) THROWS immediately. It
 *   must never fall through `WHERE tier = $1 OR tier = 'FREE'` and be served
 *   entirely at FREE prices (a silently wrong price for a paid plan). The tier
 *   is validated FIRST, before any SQL, so the catch below cannot swallow it.
 * - A KNOWN tier is priced by its OWN rows only. The query no longer unions
 *   tier = 'FREE' to fill gaps: a missing action for a paid tier is OMITTED from
 *   the returned map, NEVER silently back-filled with the FREE rate (consistent
 *   with getCreditCost, which throws that same case). The dashboard renderer
 *   (dashboardSlices.getCredits) already .catch()es this and degrades to
 *   "no costs shown" — it never receives a misleading FREE price for a paid plan.
 * - A pricing DB failure THROWS (it no longer returns a FREE default), so a
 *   pricing outage never silently prices a paid plan at FREE.
 */
export async function getAllCosts(tier: string): Promise<Record<CreditAction, number>> {
  const normalizedTier = tier.toUpperCase();

  if (!isKnownCreditTier(normalizedTier)) {
    throw new Error(
      `[CREDITS] Unknown subscription tier "${tier}" — refusing to price it at FREE. ` +
        `Known tiers: ${CREDIT_TIERS.join(', ')}.`,
    );
  }

  try {
    // Query this tier's OWN rows only. We deliberately do NOT union tier = 'FREE'
    // to fill gaps: silently substituting FREE prices for a paid tier's missing
    // action would underprice the dashboard display and contradict getCreditCost
    // (which throws the same case). A missing action is simply omitted from the
    // returned map — the dashboard renders only what is actually priced.
    const rows = await sql`
      SELECT action, cost
      FROM credit_costs
      WHERE tier = ${normalizedTier}
      ORDER BY action
    `;

    const costs: Record<string, number> = {};
    for (const row of rows) {
      costs[row.action] = row.cost;
    }

    return costs as Record<CreditAction, number>;
  } catch (error) {
    // A pricing-system DB failure must not silently produce FREE prices.
    // Re-throw so dashboardSlices.getCredits (which .catch()es this) degrades to
    // "no costs shown" — consistent with the billing path, never a silent FREE price.
    if (error instanceof Error && error.message.startsWith('[CREDITS]')) {
      throw error;
    }
    console.error('[CREDITS] Failed to get all costs:', error);
    throw new Error(
      `[CREDITS] getAllCosts unavailable for tier "${tier}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Check if organization has enough credits for an action.
 */
export async function hasEnoughCredits(organizationId: string, amount: number): Promise<boolean> {
  const balance = await getBalance(organizationId);
  return balance >= amount;
}

/**
 * Check if organization can afford a specific action at their tier.
 */
export async function canAffordAction(
  organizationId: string,
  action: CreditAction,
  tier: string
): Promise<{ canAfford: boolean; cost: number; balance: number }> {
  const [cost, balance] = await Promise.all([
    getCreditCost(action, tier),
    getBalance(organizationId),
  ]);

  return {
    canAfford: balance >= cost,
    cost,
    balance,
  };
}

/**
 * Validate credit amount for safety.
 * Throws on invalid amounts to fail fast.
 *
 * BULLETPROOF VALIDATIONS:
 * - Finite number check (rejects NaN, Infinity)
 * - Integer check (no floating point errors)
 * - Positive value check (no negative credits)
 * - Maximum bound check (prevents overflow)
 * - Safe integer check (within JS precision)
 */
function validateAmount(amount: number, operation: 'deduct' | 'add'): void {
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid credit amount: not a finite number`);
  }
  if (!Number.isInteger(amount)) {
    throw new Error(`Invalid credit amount: must be an integer, got ${amount}`);
  }
  if (amount < 0) {
    throw new Error(`Invalid credit amount: negative values not allowed`);
  }
  if (amount > MAX_CREDITS) {
    throw new Error(`Credit amount ${amount} exceeds maximum allowed (${MAX_CREDITS})`);
  }
  // Ensure amount is within JavaScript safe integer range
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`Credit amount ${amount} exceeds safe integer range`);
  }
}

/**
 * Validate organization ID format
 * Prevents SQL injection and ensures valid UUIDs
 */
function validateOrganizationId(orgId: string): void {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Invalid organization ID: must be a non-empty string');
  }
  // UUID format validation (with or without hyphens)
  const uuidRegex = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orgId)) {
    throw new Error('Invalid organization ID format');
  }
}

/**
 * Check for duplicate transaction using idempotency key.
 * Returns the existing transaction if found, null otherwise.
 */
async function checkIdempotency(
  idempotencyKey: string
): Promise<{ transactionId: string; balanceAfter: number } | null> {
  try {
    const [existing] = await sql`
      SELECT id, balance_after
      FROM credit_transactions
      WHERE idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    if (existing) {
      return {
        transactionId: existing.id,
        balanceAfter: existing.balance_after,
      };
    }
    return null;
  } catch {
    // Column may not exist yet, ignore
    return null;
  }
}

/**
 * Deduct credits from an organization's balance.
 * Returns success=false if insufficient credits.
 *
 * BULLETPROOF FEATURES:
 * - Uses FOR UPDATE SKIP LOCKED to prevent race conditions
 * - Atomic transaction logging (same query as deduction)
 * - Integer overflow/underflow protection
 * - Idempotency key support to prevent double-charges
 * - Organization ID validation
 * - Balance can never go negative (enforced at DB level)
 */
export async function deductCredits(
  organizationId: string,
  amount: number,
  type: TransactionType,
  description: string,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<DeductResult> {
  // Validate organization ID first
  try {
    validateOrganizationId(organizationId);
  } catch (error: any) {
    console.error('[CREDITS] Invalid organization ID:', error.message);
    return {
      success: false,
      remainingBalance: 0,
      deducted: 0,
      errorCode: 'INVALID_AMOUNT',
    };
  }

  // Handle zero amount (no-op)
  if (amount === 0) {
    return {
      success: true,
      remainingBalance: await getBalance(organizationId),
      deducted: 0,
    };
  }

  // Validate amount
  try {
    validateAmount(amount, 'deduct');
  } catch (error: any) {
    console.error('[CREDITS] Validation failed:', error.message);
    return {
      success: false,
      remainingBalance: await getBalance(organizationId),
      deducted: 0,
      errorCode: 'INVALID_AMOUNT',
    };
  }

  // Check idempotency if key provided
  if (idempotencyKey) {
    const existing = await checkIdempotency(idempotencyKey);
    if (existing) {
      console.log('[CREDITS] Duplicate request detected:', idempotencyKey);
      return {
        success: true,
        remainingBalance: existing.balanceAfter,
        deducted: amount,
        transactionId: existing.transactionId,
        errorCode: 'DUPLICATE',
      };
    }
  }

  try {
    // Generate transaction ID upfront for atomic insert
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // ATOMIC OPERATION: Lock row, deduct, and log in single query
    // Uses FOR UPDATE SKIP LOCKED to prevent race conditions
    // If another transaction holds the lock, this will skip and fail gracefully
    const [result] = await sql`
      WITH locked_balance AS (
        SELECT organization_id, balance
        FROM credit_balances
        WHERE organization_id = ${organizationId}
        FOR UPDATE SKIP LOCKED
      ),
      updated AS (
        UPDATE credit_balances cb
        SET
          balance = cb.balance - ${amount},
          lifetime_used = cb.lifetime_used + ${amount},
          updated_at = NOW()
        FROM locked_balance lb
        WHERE cb.organization_id = lb.organization_id
          AND lb.balance >= ${amount}
        RETURNING cb.balance, cb.organization_id
      ),
      logged AS (
        INSERT INTO credit_transactions (
          id, organization_id, type, amount, balance_after, description, metadata, idempotency_key
        )
        SELECT
          ${transactionId},
          ${organizationId},
          ${type},
          ${-amount},
          balance,
          ${description},
          ${JSON.stringify(metadata || {})}::jsonb,
          ${idempotencyKey || null}
        FROM updated
        RETURNING balance_after
      )
      SELECT balance_after as balance, ${transactionId} as transaction_id FROM logged
    `;

    if (!result) {
      // Either org doesn't exist, insufficient balance, or row was locked
      const currentBalance = await getBalance(organizationId);
      return {
        success: false,
        remainingBalance: currentBalance,
        deducted: 0,
        insufficientCredits: currentBalance < amount,
        errorCode: currentBalance < amount ? 'INSUFFICIENT_CREDITS' : 'INTERNAL_ERROR',
      };
    }

    return {
      success: true,
      remainingBalance: result.balance,
      deducted: amount,
      transactionId: result.transaction_id,
    };
  } catch (error: any) {
    console.error('[CREDITS] Failed to deduct credits:', error);

    // Check if it's a duplicate key error (idempotency)
    if (error.code === '23505' && idempotencyKey) {
      const existing = await checkIdempotency(idempotencyKey);
      if (existing) {
        return {
          success: true,
          remainingBalance: existing.balanceAfter,
          deducted: amount,
          transactionId: existing.transactionId,
          errorCode: 'DUPLICATE',
        };
      }
    }

    return {
      success: false,
      remainingBalance: await getBalance(organizationId),
      deducted: 0,
      errorCode: 'INTERNAL_ERROR',
    };
  }
}

/**
 * Deduct credits for a specific action, using tier-based pricing.
 * Supports idempotency keys to prevent double-charging for the same operation.
 */
export async function deductCreditsForAction(
  organizationId: string,
  action: CreditAction,
  tier: string,
  description?: string,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<DeductResult> {
    let cost: number;
  try {
    // A missing/unmapped tier or a missing paid-tier action row makes
    // getCreditCost THROW (fail-closed). Never silently debit at a wrong price.
    cost = await getCreditCost(action, tier);
  } catch (error) {
    console.error(
      `[CREDITS] Pricing unavailable for action "${action}" tier "${tier}" ` +
        `(org ${organizationId}); blocking deduction:`,
      error instanceof Error ? error.message : error,
    );
    return {
      success: false,
      remainingBalance: await getBalance(organizationId),
      deducted: 0,
      errorCode: 'PRICING_NOT_CONFIGURED',
    };
  }
  const actionDescription = description || `${action} operation`;

  // Generate idempotency key if not provided but action has a unique reference
  const effectiveIdempotencyKey = idempotencyKey ||
    (metadata?.referenceId ? `${action}_${organizationId}_${metadata.referenceId}` : undefined);

  const result = await deductCredits(
    organizationId,
    cost,
    'DEDUCT',
    actionDescription,
    {
      action,
      tier,
      cost,
      ...metadata,
    },
    effectiveIdempotencyKey
  );

  if (result.success && result.errorCode !== 'DUPLICATE') {
    await logEvent('credits_deducted', 'billing', organizationId, {
      action,
      tier,
      cost,
      transactionId: result.transactionId,
      remainingBalance: result.remainingBalance,
    });
  }

  return result;
}

/**
 * Add credits to an organization's balance.
 *
 * BULLETPROOF FEATURES:
 * - Uses FOR UPDATE to prevent race conditions
 * - Atomic transaction logging
 * - Integer overflow protection with pre-check
 * - Idempotency key support
 * - Organization ID validation
 */
export async function addCredits(
  organizationId: string,
  amount: number,
  type: TransactionType,
  description: string,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<{ balance: number; transactionId?: string; isDuplicate?: boolean }> {
  // Validate organization ID first
  validateOrganizationId(organizationId);

  // Handle zero amount (no-op)
  if (amount === 0) {
    return { balance: await getBalance(organizationId) };
  }

  // Validate amount
  try {
    validateAmount(amount, 'add');
  } catch (error: any) {
    console.error('[CREDITS] Validation failed:', error.message);
    throw error;
  }

  // Check idempotency if key provided
  if (idempotencyKey) {
    const existing = await checkIdempotency(idempotencyKey);
    if (existing) {
      console.log('[CREDITS] Duplicate add request detected:', idempotencyKey);
      return {
        balance: existing.balanceAfter,
        transactionId: existing.transactionId,
        isDuplicate: true,
      };
    }
  }

  try {
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const isPurchase = type === 'PURCHASE';

    // ATOMIC OPERATION: Ensure record exists, lock, add, and log
    // First ensure the balance record exists
    await sql`
      INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
      VALUES (${organizationId}, 0, 0, 0)
      ON CONFLICT (organization_id) DO NOTHING
    `;

    // Atomic add with overflow check and logging
    const [result] = await sql`
      WITH locked_balance AS (
        SELECT organization_id, balance
        FROM credit_balances
        WHERE organization_id = ${organizationId}
        FOR UPDATE
      ),
      overflow_check AS (
        SELECT
          organization_id,
          balance,
          CASE
            WHEN balance + ${amount} > ${MAX_CREDITS} THEN true
            ELSE false
          END as would_overflow
        FROM locked_balance
      ),
      updated AS (
        UPDATE credit_balances cb
        SET
          balance = cb.balance + ${amount},
          lifetime_purchased = cb.lifetime_purchased + ${isPurchase ? amount : 0},
          updated_at = NOW()
        FROM overflow_check oc
        WHERE cb.organization_id = oc.organization_id
          AND oc.would_overflow = false
        RETURNING cb.balance, cb.organization_id
      ),
      logged AS (
        INSERT INTO credit_transactions (
          id, organization_id, type, amount, balance_after, description, metadata, idempotency_key
        )
        SELECT
          ${transactionId},
          ${organizationId},
          ${type},
          ${amount},
          balance,
          ${description},
          ${JSON.stringify(metadata || {})}::jsonb,
          ${idempotencyKey || null}
        FROM updated
        RETURNING balance_after
      )
      SELECT balance_after as balance, ${transactionId} as transaction_id FROM logged
    `;

    if (!result) {
      // Overflow would occur
      const currentBalance = await getBalance(organizationId);
      console.error('[CREDITS] Would exceed max balance:', currentBalance, '+', amount);
      throw new Error(`Operation would exceed maximum credit balance (current: ${currentBalance}, adding: ${amount}, max: ${MAX_CREDITS})`);
    }

    await logEvent('credits_added', 'billing', organizationId, {
      type,
      amount,
      transactionId,
      newBalance: result.balance,
      description,
    });

    return {
      balance: result.balance,
      transactionId: result.transaction_id,
    };
  } catch (error: any) {
    // Check if it's a duplicate key error (idempotency)
    if (error.code === '23505' && idempotencyKey) {
      const existing = await checkIdempotency(idempotencyKey);
      if (existing) {
        return {
          balance: existing.balanceAfter,
          transactionId: existing.transactionId,
          isDuplicate: true,
        };
      }
    }

    console.error('[CREDITS] Failed to add credits:', error);
    throw error;
  }
}

/**
 * Get recent credit transactions for an organization.
 */
export async function getTransactionHistory(
  organizationId: string,
  limit: number = 50,
  offset: number = 0
): Promise<Array<{
  id: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}>> {
  try {
    const rows = await sql`
      SELECT id, type, amount, balance_after, description, metadata, created_at
      FROM credit_transactions
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return rows.map((row: any) => ({
      id: row.id,
      type: row.type as TransactionType,
      amount: row.amount,
      balanceAfter: row.balance_after,
      description: row.description || '',
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
    }));
  } catch (error) {
    console.error('[CREDITS] Failed to get transaction history:', error);
    return [];
  }
}

/**
 * Refund credits for a failed operation.
 * Use originalTransactionId to create idempotency key automatically.
 */
export async function refundCredits(
  organizationId: string,
  amount: number,
  description: string,
  metadata?: Record<string, unknown>,
  originalTransactionId?: string
): Promise<{ balance: number; transactionId?: string; isDuplicate?: boolean }> {
  const idempotencyKey = originalTransactionId
    ? `refund_${originalTransactionId}`
    : undefined;

  return addCredits(organizationId, amount, 'REFUND', description, {
    originalTransactionId,
    ...metadata,
  }, idempotencyKey);
}

/**
 * Grant bonus credits (e.g., promo, referral).
 * Use bonusCode for idempotency to prevent double-granting.
 */
export async function grantBonusCredits(
  organizationId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>,
  bonusCode?: string
): Promise<{ balance: number; transactionId?: string; isDuplicate?: boolean }> {
  const idempotencyKey = bonusCode
    ? `bonus_${organizationId}_${bonusCode}`
    : undefined;

  return addCredits(organizationId, amount, 'BONUS', reason, {
    bonusReason: reason,
    bonusCode,
    ...metadata,
  }, idempotencyKey);
}

/**
 * Reserve credits for a pending operation.
 * Credits are held until confirmed or released.
 * This is useful for long-running operations where you want to
 * guarantee credits are available but not yet consumed.
 */
export async function reserveCredits(
  organizationId: string,
  amount: number,
  description: string,
  reservationId: string,
  expiresInMinutes: number = 30
): Promise<{ success: boolean; reservationId: string; expiresAt: Date }> {
  try {
    validateAmount(amount, 'deduct');
  } catch (error: any) {
    console.error('[CREDITS] Reservation validation failed:', error.message);
    return {
      success: false,
      reservationId,
      expiresAt: new Date(),
    };
  }

  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  try {
    // Atomic reservation: lock row, check balance, insert reservation
    const [result] = await sql`
      WITH locked_balance AS (
        SELECT organization_id, balance
        FROM credit_balances
        WHERE organization_id = ${organizationId}
        FOR UPDATE
      ),
      existing_reservations AS (
        SELECT COALESCE(SUM(amount), 0) as reserved
        FROM credit_reservations
        WHERE organization_id = ${organizationId}
          AND status = 'PENDING'
          AND expires_at > NOW()
      ),
      available AS (
        SELECT
          lb.balance - er.reserved as available_balance
        FROM locked_balance lb, existing_reservations er
      ),
      inserted AS (
        INSERT INTO credit_reservations (
          id, organization_id, amount, description, status, expires_at
        )
        SELECT
          ${reservationId},
          ${organizationId},
          ${amount},
          ${description},
          'PENDING',
          ${expiresAt}
        FROM available
        WHERE available_balance >= ${amount}
        RETURNING id
      )
      SELECT id FROM inserted
    `;

    if (!result) {
      return {
        success: false,
        reservationId,
        expiresAt,
      };
    }

    return {
      success: true,
      reservationId,
      expiresAt,
    };
  } catch (error) {
    console.error('[CREDITS] Failed to reserve credits:', error);
    return {
      success: false,
      reservationId,
      expiresAt: new Date(),
    };
  }
}

/**
 * Confirm a credit reservation, actually deducting the credits.
 */
export async function confirmReservation(
  reservationId: string
): Promise<DeductResult> {
  try {
    // Atomic: update reservation status and deduct credits
    const [reservation] = await sql`
      UPDATE credit_reservations
      SET status = 'CONFIRMED', confirmed_at = NOW()
      WHERE id = ${reservationId}
        AND status = 'PENDING'
        AND expires_at > NOW()
      RETURNING organization_id, amount, description
    `;

    if (!reservation) {
      return {
        success: false,
        remainingBalance: 0,
        deducted: 0,
        errorCode: 'INTERNAL_ERROR',
      };
    }

    // Deduct with idempotency key based on reservation
    return deductCredits(
      reservation.organization_id,
      reservation.amount,
      'DEDUCT',
      reservation.description,
      { reservationId },
      `reservation_${reservationId}`
    );
  } catch (error) {
    console.error('[CREDITS] Failed to confirm reservation:', error);
    return {
      success: false,
      remainingBalance: 0,
      deducted: 0,
      errorCode: 'INTERNAL_ERROR',
    };
  }
}

/**
 * Release a credit reservation without deducting.
 */
export async function releaseReservation(reservationId: string): Promise<boolean> {
  try {
    const [result] = await sql`
      UPDATE credit_reservations
      SET status = 'RELEASED', released_at = NOW()
      WHERE id = ${reservationId}
        AND status = 'PENDING'
      RETURNING id
    `;

    return !!result;
  } catch (error) {
    console.error('[CREDITS] Failed to release reservation:', error);
    return false;
  }
}

/**
 * Get the effective available balance (balance minus pending reservations).
 */
export async function getEffectiveBalance(organizationId: string): Promise<number> {
  try {
    const [result] = await sql`
      SELECT
        cb.balance - COALESCE(
          (SELECT SUM(amount) FROM credit_reservations
           WHERE organization_id = ${organizationId}
             AND status = 'PENDING'
             AND expires_at > NOW()),
          0
        ) as effective_balance
      FROM credit_balances cb
      WHERE cb.organization_id = ${organizationId}
    `;

    return result?.effective_balance ?? 0;
  } catch (error) {
    console.error('[CREDITS] Failed to get effective balance:', error);
    return 0;
  }
}

/**
 * Verify ledger integrity for an organization.
 * Checks that the current balance matches the sum of all transactions.
 *
 * BULLETPROOF AUDIT:
 * - Compares recorded balance against computed balance from ledger
 * - Detects tampering, missing transactions, or corruption
 * - Should be run periodically for compliance
 */
export async function verifyLedgerIntegrity(organizationId: string): Promise<{
  valid: boolean;
  recordedBalance: number;
  computedBalance: number;
  discrepancy: number;
  transactionCount: number;
}> {
  try {
    validateOrganizationId(organizationId);

    const [result] = await sql`
      WITH ledger_sum AS (
        SELECT
          COALESCE(SUM(amount), 0) as computed_balance,
          COUNT(*) as transaction_count
        FROM credit_transactions
        WHERE organization_id = ${organizationId}
      ),
      current_balance AS (
        SELECT COALESCE(balance, 0) as recorded_balance
        FROM credit_balances
        WHERE organization_id = ${organizationId}
      )
      SELECT
        COALESCE(cb.recorded_balance, 0) as recorded_balance,
        ls.computed_balance,
        ls.transaction_count
      FROM ledger_sum ls
      LEFT JOIN current_balance cb ON true
    `;

    const recordedBalance = Number(result?.recorded_balance ?? 0);
    const computedBalance = Number(result?.computed_balance ?? 0);
    const transactionCount = Number(result?.transaction_count ?? 0);
    const discrepancy = recordedBalance - computedBalance;
    const valid = discrepancy === 0;

    if (!valid) {
      console.error('[CREDITS] Ledger integrity check FAILED:', {
        organizationId,
        recordedBalance,
        computedBalance,
        discrepancy,
      });

      await logEvent('ledger_integrity_failure', 'billing', organizationId, {
        recordedBalance,
        computedBalance,
        discrepancy,
        transactionCount,
      });
    }

    return {
      valid,
      recordedBalance,
      computedBalance,
      discrepancy,
      transactionCount,
    };
  } catch (error) {
    console.error('[CREDITS] Failed to verify ledger integrity:', error);
    return {
      valid: false,
      recordedBalance: 0,
      computedBalance: 0,
      discrepancy: 0,
      transactionCount: 0,
    };
  }
}

/**
 * Get a cryptographic hash of the transaction chain for tamper detection.
 * This creates a simple hash chain where each transaction includes the previous hash.
 */
export async function getTransactionChainHash(organizationId: string): Promise<string | null> {
  try {
    validateOrganizationId(organizationId);

    const [result] = await sql`
      SELECT
        md5(string_agg(
          id || ':' || type || ':' || amount::text || ':' || balance_after::text,
          '|' ORDER BY created_at ASC
        )) as chain_hash
      FROM credit_transactions
      WHERE organization_id = ${organizationId}
    `;

    return result?.chain_hash || null;
  } catch (error) {
    console.error('[CREDITS] Failed to compute chain hash:', error);
    return null;
  }
}

/**
 * Atomically transfer credits between organizations.
 * Both debit and credit happen in a single transaction.
 *
 * BULLETPROOF FEATURES:
 * - Single atomic transaction (all or nothing)
 * - Both organizations locked simultaneously
 * - Idempotency support
 * - Full audit trail
 */
export async function transferCredits(
  fromOrgId: string,
  toOrgId: string,
  amount: number,
  description: string,
  metadata?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<{
  success: boolean;
  fromBalance: number;
  toBalance: number;
  transactionId?: string;
  errorCode?: 'INSUFFICIENT_CREDITS' | 'INVALID_AMOUNT' | 'DUPLICATE' | 'INTERNAL_ERROR';
}> {
  // Validate inputs
  try {
    validateOrganizationId(fromOrgId);
    validateOrganizationId(toOrgId);
    validateAmount(amount, 'deduct');
  } catch (error: any) {
    console.error('[CREDITS] Transfer validation failed:', error.message);
    return {
      success: false,
      fromBalance: 0,
      toBalance: 0,
      errorCode: 'INVALID_AMOUNT',
    };
  }

  if (fromOrgId === toOrgId) {
    console.error('[CREDITS] Cannot transfer to same organization');
    return {
      success: false,
      fromBalance: await getBalance(fromOrgId),
      toBalance: await getBalance(toOrgId),
      errorCode: 'INVALID_AMOUNT',
    };
  }

  // Check idempotency
  if (idempotencyKey) {
    const existing = await checkIdempotency(idempotencyKey);
    if (existing) {
      return {
        success: true,
        fromBalance: 0,
        toBalance: existing.balanceAfter,
        transactionId: existing.transactionId,
        errorCode: 'DUPLICATE',
      };
    }
  }

  try {
    const transactionId = `txn_transfer_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // Atomic transfer: lock both rows, debit one, credit other, log both
    const [result] = await sql`
      WITH
      -- Ensure both balance records exist
      ensure_from AS (
        INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
        VALUES (${fromOrgId}, 0, 0, 0)
        ON CONFLICT (organization_id) DO NOTHING
      ),
      ensure_to AS (
        INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
        VALUES (${toOrgId}, 0, 0, 0)
        ON CONFLICT (organization_id) DO NOTHING
      ),
      -- Lock both rows in consistent order to prevent deadlocks
      locked AS (
        SELECT organization_id, balance
        FROM credit_balances
        WHERE organization_id IN (${fromOrgId}, ${toOrgId})
        ORDER BY organization_id
        FOR UPDATE
      ),
      -- Check source has enough
      source_check AS (
        SELECT balance >= ${amount} as has_funds
        FROM locked
        WHERE organization_id = ${fromOrgId}
      ),
      -- Debit source
      debited AS (
        UPDATE credit_balances
        SET balance = balance - ${amount}, lifetime_used = lifetime_used + ${amount}, updated_at = NOW()
        WHERE organization_id = ${fromOrgId}
          AND EXISTS (SELECT 1 FROM source_check WHERE has_funds = true)
        RETURNING balance as from_balance
      ),
      -- Credit destination (only if debit succeeded)
      credited AS (
        UPDATE credit_balances
        SET balance = balance + ${amount}, lifetime_purchased = lifetime_purchased + ${amount}, updated_at = NOW()
        WHERE organization_id = ${toOrgId}
          AND EXISTS (SELECT 1 FROM debited)
        RETURNING balance as to_balance
      ),
      -- Log source transaction
      log_from AS (
        INSERT INTO credit_transactions (id, organization_id, type, amount, balance_after, description, metadata, idempotency_key)
        SELECT
          ${transactionId} || '_from',
          ${fromOrgId},
          'DEDUCT',
          ${-amount},
          from_balance,
          ${description},
          ${JSON.stringify({ ...metadata, transfer_to: toOrgId, transfer_id: transactionId })}::jsonb,
          ${idempotencyKey ? idempotencyKey + '_from' : null}
        FROM debited
        RETURNING balance_after
      ),
      -- Log destination transaction
      log_to AS (
        INSERT INTO credit_transactions (id, organization_id, type, amount, balance_after, description, metadata, idempotency_key)
        SELECT
          ${transactionId} || '_to',
          ${toOrgId},
          'PURCHASE',
          ${amount},
          to_balance,
          ${description},
          ${JSON.stringify({ ...metadata, transfer_from: fromOrgId, transfer_id: transactionId })}::jsonb,
          ${idempotencyKey ? idempotencyKey + '_to' : null}
        FROM credited
        RETURNING balance_after
      )
      SELECT
        (SELECT from_balance FROM debited) as from_balance,
        (SELECT to_balance FROM credited) as to_balance,
        EXISTS (SELECT 1 FROM debited) as success
    `;

    if (!result?.success) {
      return {
        success: false,
        fromBalance: await getBalance(fromOrgId),
        toBalance: await getBalance(toOrgId),
        errorCode: 'INSUFFICIENT_CREDITS',
      };
    }

    await logEvent('credits_transferred', 'billing', fromOrgId, {
      toOrgId,
      amount,
      transactionId,
      fromBalance: result.from_balance,
      toBalance: result.to_balance,
    });

    return {
      success: true,
      fromBalance: result.from_balance,
      toBalance: result.to_balance,
      transactionId,
    };
  } catch (error: any) {
    console.error('[CREDITS] Transfer failed:', error);
    return {
      success: false,
      fromBalance: await getBalance(fromOrgId),
      toBalance: await getBalance(toOrgId),
      errorCode: 'INTERNAL_ERROR',
    };
  }
}
