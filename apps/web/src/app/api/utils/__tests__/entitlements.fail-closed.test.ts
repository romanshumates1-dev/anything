/**
 * REQUIREMENT SET X1 — "UI must not claim what backend denies."
 *
 * The backend half of that requirement is that entitlements FAIL CLOSED. A
 * feature gate that opens when it cannot determine a tier is worse than no gate:
 * it tells the UI "you have this", and the UI then renders a paid capability as
 * active while nothing is enforcing it.
 *
 * `entitlements.ts` had NO test file at all, which is why the matrix recorded
 * this as IN PROGRESS with "frontend/backend agreement not exhaustively
 * verified" — unproven rather than known-broken.
 *
 * WHAT THESE TESTS PIN
 * --------------------
 * Every degraded input a real deployment will actually produce is routed to the
 * LOWEST tier, never the highest and never a permissive default:
 *
 *   * no subscription row (a brand-new org)         -> FREE
 *   * an unrecognised tier string (schema drift)    -> FREE
 *   * a NULL / empty tier column                    -> FREE
 *   * the database throwing entirely                 -> FREE
 *   * `getTierLimits` asked for a nonsense tier     -> FREE defaults
 *
 * `enforceEntitlement` is asserted to THROW and to log `feature_denied`, so a
 * denial is both enforced and auditable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, mockLogEvent } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockLogEvent: vi.fn(async () => undefined),
}));

vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({
  logEvent: (...a: unknown[]) => mockLogEvent(...a),
}));

import {
  checkEntitlement,
  checkEntitlements,
  enforceEntitlement,
  getOrganizationTier,
  getTierLimits,
  getUpgradeRecommendations,
  FeatureNotAllowedError,
  type Feature,
} from '@/app/api/utils/entitlements';

/** Every paid feature: none of these should reach FREE by accident. */
const PAID_FEATURES: Feature[] = [
  'ai_negotiation',
  'bulk_sms',
  'advanced_analytics',
  'api_access',
  'custom_branding',
  'priority_support',
  'webhook_integrations',
  'crm_integrations',
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('X1 — the entitlement gate fails CLOSED', () => {
  describe('getOrganizationTier never invents authority', () => {
    it('returns FREE when the org has no subscription row', async () => {
      mockSql.mockResolvedValueOnce([{ tier: null }]);
      expect(await getOrganizationTier('org-1')).toBe('FREE');
    });

    it('returns FREE for an unrecognised tier string', async () => {
      // Schema drift: a tier this build does not know about must not be
      // treated as high-value. Defaulting to the top tier here would hand out
      // every paid feature to anyone whose row says something unexpected.
      mockSql.mockResolvedValueOnce([{ tier: 'PLATINUM_PLUS' }]);
      expect(await getOrganizationTier('org-1')).toBe('FREE');
    });

    it('normalises a lowercase tier rather than discarding it', async () => {
      // `.toUpperCase()` is applied first, so a legitimately-lowercased row is
      // honoured. The fail-closed rule applies to tiers this build does not
      // recognise, not to casing.
      mockSql.mockResolvedValueOnce([{ tier: 'pro' }]);
      expect(await getOrganizationTier('org-1')).toBe('PRO');
      mockSql.mockResolvedValueOnce([{ tier: 'enterprise' }]);
      expect(await getOrganizationTier('org-1')).toBe('ENTERPRISE');
    });

    it('returns FREE when the database throws', async () => {
      mockSql.mockRejectedValueOnce(new Error('connection reset'));
      // No rethrow: a billing outage must not become an outage of every paid
      // route, and must not become silent access either. FREE is both safe and
      // available.
      expect(await getOrganizationTier('org-1')).toBe('FREE');
    });

    it('returns FREE when the query returns no rows at all', async () => {
      mockSql.mockResolvedValueOnce([]);
      expect(await getOrganizationTier('org-1')).toBe('FREE');
    });
  });

  describe('getTierLimits falls back to FREE, not to something permissive', () => {
    it('unknown tier resolves to the FREE configuration', async () => {
      const limits = await getTierLimits('NOT_A_TIER');
      expect(limits.tier).toBe('FREE');
    });

    it('FREE does not grant the paid features', async () => {
      const limits = await getTierLimits('FREE');
      for (const feature of PAID_FEATURES) {
        expect(limits.features).not.toContain(feature);
      }
    });
  });

  describe('checkEntitlement denies rather than allowing', () => {
    it('a FREE org cannot use a paid feature', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'FREE' }]);
      const result = await checkEntitlement('org-1', 'ai_negotiation');
      expect(result.allowed).toBe(false);
    });

    it('an unknown tier is treated as FREE and denied', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'UNOBTAINIUM' }]);
      const result = await checkEntitlement('org-1', 'advanced_analytics');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('FREE');
    });

    it('a database outage denies instead of granting', async () => {
      mockSql.mockRejectedValueOnce(new Error('billing provider down'));
      const result = await checkEntitlement('org-1', 'api_access');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('FREE');
    });

    it('a denial names the tier the user is actually on', async () => {
      // The UI renders `upgradeRequired`. Reporting a tier the org does not
      // hold would be exactly the "UI claims what the backend denies" failure.
      mockSql.mockResolvedValueOnce([{ tier: 'STARTER' }]);
      const result = await checkEntitlement('org-1', 'advanced_analytics');
      expect(result.allowed).toBe(false);
      expect(result.tier).toBe('STARTER');
      expect(result.upgradeRequired).toBeTruthy();
    });

    it('allows a feature the tier genuinely holds', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'PRO' }]);
      const result = await checkEntitlement('org-1', 'ai_negotiation');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('PRO');
    });
  });

  describe('enforceEntitlement actually blocks', () => {
    it('throws on denial', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'FREE' }]);
      await expect(enforceEntitlement('org-1', 'bulk_sms')).rejects.toBeInstanceOf(
        FeatureNotAllowedError,
      );
    });

    it('audits the denial so it is reviewable', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'FREE' }]);
      await expect(enforceEntitlement('org-1', 'bulk_sms')).rejects.toThrow();
      expect(mockLogEvent).toHaveBeenCalledWith(
        'feature_denied',
        'entitlements',
        'org-1',
        expect.objectContaining({ feature: 'bulk_sms', tier: 'FREE' }),
      );
    });

    it('resolves without throwing when the tier really holds the feature', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'PRO' }]);
      await expect(
        enforceEntitlement('org-1', 'ai_negotiation'),
      ).resolves.toBeUndefined();
      expect(mockLogEvent).not.toHaveBeenCalled();
    });
  });

  describe('no tier accidentally grants everything', () => {
    it('FREE is strictly weaker than ENTERPRISE', async () => {
      const free = await getTierLimits('FREE');
      const enterprise = await getTierLimits('ENTERPRISE');
      expect(free.features.length).toBeLessThan(enterprise.features.length);
    });
  });

  describe('BUSINESS and SCALE are honoured, not demoted to FREE', () => {
    // F3-family defect (found 2026-10-13): DEFAULT_TIER_CONFIGS knew only
    // FREE/STARTER/PRO/ENTERPRISE, so getOrganizationTier mapped the live paid
    // tiers BUSINESS ($899/mo) and SCALE ($2,499/mo) to FREE — a paying org
    // lost every paid feature. getTierLimits on those tiers likewise returned
    // FREE. Both are fixed: the tiers resolve to their own configs.
    it.each(['BUSINESS', 'SCALE'] as const)('getOrganizationTier honours %s', async (tier) => {
      mockSql.mockResolvedValueOnce([{ tier }]);
      expect(await getOrganizationTier('org-1')).toBe(tier);
    });

    it.each(['business', 'scale'] as const)('lowercase %s normalises (casing, not drift)', async (tier) => {
      mockSql.mockResolvedValueOnce([{ tier }]);
      expect(await getOrganizationTier('org-1')).toBe(tier.toUpperCase());
    });

    it('normalises the legacy professional alias to PRO (066), not FREE', async () => {
      // Migration 066 retiered plan_professional -> tier='pro', but the tier
      // CHECK still permits 'professional'. Aliasing to PRO keeps legacy rows
      // at their real capability instead of fail-closed demotion to FREE.
      mockSql.mockResolvedValueOnce([{ tier: 'professional' }]);
      expect(await getOrganizationTier('org-1')).toBe('PRO');
    });

    it('reads tier via the authoritative tables (087), not the phantom `subscriptions` relation', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'business' }]);
      await getOrganizationTier('org-1');
      const [strings] = mockSql.mock.calls[0];
      const query = Array.isArray(strings) ? strings.join('?') : String(strings);
      expect(query).toContain('organization_subscriptions');
      expect(query).toContain('subscription_plans');
      // The pre-fix query joined `subscriptions` (no migration creates it) with
      // status='ACTIVE' (026 stores lowercase) and selected s.tier (tier lives
      // on subscription_plans) — it threw on EVERY call, and the catch silently
      // demoted every org to FREE. Pin the fix so it cannot regress.
      expect(query).not.toMatch(/JOIN\s+subscriptions\s/);
      expect(query).not.toContain("'ACTIVE'");
    });

    it.each(['BUSINESS', 'SCALE'] as const)('getTierLimits(%s) returns its own config, not FREE', async (tier) => {
      const limits = await getTierLimits(tier);
      expect(limits.tier).toBe(tier);
      expect(limits.features).toContain('ai_negotiation');
    });

    it('SCALE holds the full enterprise feature set', async () => {
      const scale = await getTierLimits('SCALE');
      const enterprise = await getTierLimits('ENTERPRISE');
      expect(scale.features).toEqual(enterprise.features);
    });

    it('BUSINESS sits strictly between PRO and SCALE in capability', async () => {
      const pro = await getTierLimits('PRO');
      const business = await getTierLimits('BUSINESS');
      const scale = await getTierLimits('SCALE');
      expect(business.features.length).toBeGreaterThan(pro.features.length);
      expect(scale.features.length).toBeGreaterThanOrEqual(business.features.length);
      expect(business.limits.team_members).toBe(15);
      expect(scale.limits.team_members).toBe(50);
    });

    it('a BUSINESS org can use a paid feature (not demoted)', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'BUSINESS' }]);
      const result = await checkEntitlement('org-1', 'ai_negotiation');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('BUSINESS');
    });

    it('a SCALE org can use a paid feature (not demoted)', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'SCALE' }]);
      const result = await checkEntitlement('org-1', 'custom_branding');
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('SCALE');
    });

    it('a STARTER denial names BUSINESS for priority_support (first tier granting it)', async () => {
      // priority_support first appears at BUSINESS (not PRO), so the minimum
      // tier suggestion must be BUSINESS — proving tierOrder array #1
      // (checkEntitlement) includes the new tiers.
      mockSql.mockResolvedValueOnce([{ tier: 'STARTER' }]);
      const result = await checkEntitlement('org-1', 'priority_support');
      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe('BUSINESS');
    });

    it('bulk denial names BUSINESS for priority_support too (tierOrder array #2)', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'STARTER' }]);
      const results = await checkEntitlements('org-1', ['priority_support']);
      expect(results['priority_support'].allowed).toBe(false);
      expect(results['priority_support'].upgradeRequired).toBe('BUSINESS');
    });

    it('upgrade recommendations walk PRO -> BUSINESS -> SCALE -> ENTERPRISE in order', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'PRO' }]);
      const { currentTier, recommendations } = await getUpgradeRecommendations('org-1');
      expect(currentTier).toBe('PRO');
      const tiers = recommendations.map((r) => r.tier);
      expect(tiers).toEqual(['BUSINESS', 'SCALE', 'ENTERPRISE']);
    });

    it('a SCALE org is only offered ENTERPRISE as an upgrade', async () => {
      mockSql.mockResolvedValueOnce([{ tier: 'SCALE' }]);
      const { recommendations } = await getUpgradeRecommendations('org-1');
      expect(recommendations.map((r) => r.tier)).toEqual(['ENTERPRISE']);
    });
  });
});