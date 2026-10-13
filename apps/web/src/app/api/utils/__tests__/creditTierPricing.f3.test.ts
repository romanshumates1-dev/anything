/**
 * F3 regression — credit-tier pricing integrity (revenue-risk follow-through).
 *
 * Background (see DEALSWIFT-AI-PROJECT-CHECKPOINT.md §Phase 4, 2026-10-12):
 * `subscription_plans.tier` (migrations 025/035/067) authoritatively includes real
 * paid plans `professional` ($249/mo) and `scale` ($2,499/mo). But `credit_costs`
 * (migration 080) is seeded only for FREE/STARTER/PRO/BUSINESS/ENTERPRISE.
 *
 * Two previously-unified defects:
 *   (a) getAllCosts('scale' | 'professional') -> THROWS "refusing to price it at FREE"
 *       (fail-closed, correct). Verified here so it stays that way.
 *   (b) getCreditCost(action, 'scale' | 'professional') -> currently SILENTLY returns
 *       the FREE-tier cost via `WHERE tier=$1 OR tier='FREE'`. That FREE fallback feeds:
 *         - canAffordAction (credits.ts:280)  — live affordability check
 *         - deductCreditsForAction (credits.ts:533) — THE LIVE CREDIT-DEDUCTION PATH
 *       so a paying Scale/Professional org is UNDERCHARGED on every billable action,
 *       and the underprice is what gets written to the transaction ledger (metadata.cost).
 *
 * This file pins the *intended* fail-closed contract for getCreditCost. It is RED
 * against the current code (the current code FREE-falls-back) and will go GREEN once
 * the safe migration (credit_costs rows for PROFESSIONAL/SCALE) + harden is applied.
 *
 * Per the directive: do NOT invent rates here. The only assertions are about *shape*
 * (throws / does-not-FREE-pricing / exact-row-query), never about a specific number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sql', () => ({ default: vi.fn() }));
vi.mock('../logger', () => ({ logEvent: vi.fn() }));

import sql from '../sql';
import { getCreditCost, getAllCosts, isKnownCreditTier, CREDIT_TIERS } from '../credits';

// Tiers that have real plan rows but no credit_costs rows (migrations 025/035/067 vs 080).
const UNMAPPED_PAID_TIERS = ['professional', 'scale'] as const;

describe('F3 credit-tier pricing integrity', () => {
  beforeEach(() => vi.clearAllMocks);

  describe('getAllCosts stays fail-closed for known-but-unmapped paid tiers', () => {
    it.each(UNMAPPED_PAID_TIERS)('throws for %s (no FREE substitution on dashboard)', async (tier) => {
      (sql as any).mockReset();
      await expect(getAllCosts(tier)).rejects.toThrow(/Unknown subscription tier/i);
      // sql must never be queried for an unmapped tier.
      expect(sql).not.toHaveBeenCalled();
    });
  });

  describe('getCreditCost must NOT silently price unmapped paid tiers at FREE', () => {
    // RED today: the current impl FREE-falls-back. After the safe fix this MUST hold.
    it.each(UNMAPPED_PAID_TIERS)('does not return the FREE-tier price for %s', async (tier) => {
      (sql as any).mockReset();
      // Arrange: a known FREE row exists in the DB for SMS_SEND (cost 5).
      (sql as any).mockResolvedValue([{ action: 'SMS_SEND', cost: 5 }]);

      await expect(getCreditCost('SMS_SEND', tier)).rejects.toThrow(/Unknown subscription tier/i);

            // The tier check runs BEFORE any SQL is issued: an unmapped tier must never
      // reach the credit_costs table, so no `OR tier='FREE'` fallback (the old
      // defect) can ever leak a FREE price for a paying plan — not in the return
      // value, not in metadata.cost, and not in the billing ledger.
      expect(sql).not.toHaveBeenCalled();
    });

    it('rejects a genuinely unknown tier (not a plan at all)', async () => {
      (sql as any).mockReset();
      // No rows anywhere.
      (sql as any).mockResolvedValue([]);
      await expect(getCreditCost('AI_REQUEST', 'GARBAGE_TIER')).rejects.toThrow(
        /Unknown subscription tier/i,
      );
    });
  });

  describe('mapped tiers still price exactly from their own rows', () => {
    it.each(['FREE', 'PRO', 'ENTERPRISE', 'STARTER', 'BUSINESS'] as const)(
      'uses the %s tier row, not a substitution',
      async (tier) => {
        (sql as any).mockReset();
        const expected = tier === 'FREE' ? 5 : tier === 'PRO' ? 3 : 2;
        (sql as any).mockResolvedValue([{ cost: expected }]);

        const cost = await getCreditCost('SMS_SEND', tier);
        expect(cost).toBe(expected);

        // The query is issued with the (uppercased) requested tier and does NOT
        // silently fall back before the explicit rows are exhausted.
        const passedValues = (sql as any).mock.calls[0].slice(1);
        expect(passedValues).toContain(tier.toUpperCase());
      },
    );
  });

  describe('CREDIT_TIERS set and isKnownCreditTier', () => {
    it('does NOT include the drifted paid-tier labels (they have no credit_costs)', () => {
      expect(isKnownCreditTier('professional')).toBe(false);
      expect(isKnownCreditTier('scale')).toBe(false);
    });

    it('includes the five tiers that DO have credit_costs rows (migration 080)', () => {
      for (const t of ['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']) {
        expect(isKnownCreditTier(t)).toBe(true);
      }
      expect(CREDIT_TIERS).toEqual(['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']);
    });
  });
});
