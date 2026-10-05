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
  enforceEntitlement,
  getOrganizationTier,
  getTierLimits,
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
});