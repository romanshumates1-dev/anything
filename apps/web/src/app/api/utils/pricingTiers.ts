/**
 * DealFlow AI - Pricing Tiers Configuration
 *
 * 8-tier pricing system with 1/3/6/12 month billing periods.
 * Longer commitments receive progressive discounts.
 */

export const PRICING_TIERS = {
  STARTER: {
    name: 'Starter',
    prices: {
      1: 100,   // $100/month
      3: 270,   // $90/month effective
      6: 480,   // $80/month effective
      12: 840,  // $70/month effective
    },
    credits: 500,
    features: {
      leads: 100,
      campaigns: 2,
      smsPerMonth: 500,
      emailPerMonth: 1000,
      aiMessages: true,
      phoneOutreach: false,
      analytics: 'basic',
      teamSeats: 1,
    }
  },
  PRO: {
    name: 'Pro',
    prices: { 1: 299, 3: 807, 6: 1494, 12: 2628 },
    credits: 2000,
    features: {
      leads: 500,
      campaigns: 10,
      smsPerMonth: 2000,
      emailPerMonth: 5000,
      aiMessages: true,
      phoneOutreach: true,
      analytics: 'standard',
      teamSeats: 3,
    }
  },
  BUSINESS: {
    name: 'Business',
    prices: { 1: 599, 3: 1617, 6: 2994, 12: 5268 },
    credits: 5000,
    features: {
      leads: 2000,
      campaigns: 25,
      smsPerMonth: 5000,
      emailPerMonth: 15000,
      aiMessages: true,
      phoneOutreach: true,
      analytics: 'advanced',
      teamSeats: 5,
    }
  },
  GROWTH: {
    name: 'Growth',
    prices: { 1: 999, 3: 2697, 6: 4994, 12: 8788 },
    credits: 10000,
    features: {
      leads: 5000,
      campaigns: 50,
      smsPerMonth: 10000,
      emailPerMonth: 30000,
      aiMessages: true,
      phoneOutreach: true,
      analytics: 'advanced',
      teamSeats: 10,
    }
  },
  SCALE: {
    name: 'Scale',
    prices: { 1: 1500, 3: 4050, 6: 7500, 12: 13200 },
    credits: 20000,
    features: {
      leads: 10000,
      campaigns: 100,
      smsPerMonth: 20000,
      emailPerMonth: 50000,
      aiMessages: true,
      phoneOutreach: true,
      analytics: 'full',
      teamSeats: 15,
    }
  },
  PROFESSIONAL: {
    name: 'Professional',
    prices: { 1: 2499, 3: 6747, 6: 12494, 12: 21988 },
    credits: 50000,
    features: {
      leads: 25000,
      campaigns: 200,
      smsPerMonth: 50000,
      emailPerMonth: 100000,
      aiMessages: true,
      phoneOutreach: true,
      analytics: 'full',
      teamSeats: 25,
      apiAccess: true,
    }
  },
  ENTERPRISE: {
    name: 'Enterprise',
    prices: { 1: 5000, 3: 13500, 6: 25000, 12: 44000 },
    credits: 100000,
    features: {
      leads: 'unlimited',
      campaigns: 'unlimited',
      smsPerMonth: 100000,
      emailPerMonth: 250000,
      aiMessages: true,
      phoneOutreach: true,
      analytics: 'full',
      teamSeats: 50,
      apiAccess: true,
      dedicatedSupport: true,
    }
  },
  ELITE: {
    name: 'Elite',
    prices: { 1: 10000, 3: 27000, 6: 50000, 12: 88000 },
    credits: 250000,
    features: {
      leads: 'unlimited',
      campaigns: 'unlimited',
      smsPerMonth: 'unlimited',
      emailPerMonth: 'unlimited',
      aiMessages: true,
      phoneOutreach: true,
      analytics: 'full',
      teamSeats: 'unlimited',
      apiAccess: true,
      dedicatedSupport: true,
      whiteLabel: true,
    }
  }
} as const;

export type TierName = keyof typeof PRICING_TIERS;
export type BillingPeriod = 1 | 3 | 6 | 12;

/**
 * Get the total price for a tier and billing period
 */
export function getTierPrice(tier: TierName, period: BillingPeriod): number {
  return PRICING_TIERS[tier].prices[period];
}

/**
 * Get the effective monthly price (total divided by months)
 */
export function getEffectiveMonthlyPrice(tier: TierName, period: BillingPeriod): number {
  return Math.round(PRICING_TIERS[tier].prices[period] / period);
}

/**
 * Get the features for a specific tier
 */
export function getTierFeatures(tier: TierName) {
  return PRICING_TIERS[tier].features;
}

/**
 * Get the credits included in a tier
 */
export function getTierCredits(tier: TierName): number {
  return PRICING_TIERS[tier].credits;
}

/**
 * Calculate the discount percentage for a billing period compared to monthly
 */
export function getDiscountPercentage(tier: TierName, period: BillingPeriod): number {
  if (period === 1) return 0;
  const monthlyPrice = PRICING_TIERS[tier].prices[1];
  const periodPrice = PRICING_TIERS[tier].prices[period];
  const expectedPrice = monthlyPrice * period;
  return Math.round(((expectedPrice - periodPrice) / expectedPrice) * 100);
}

/**
 * Get all tier names in order from lowest to highest
 */
export function getTierOrder(): TierName[] {
  return ['STARTER', 'PRO', 'BUSINESS', 'GROWTH', 'SCALE', 'PROFESSIONAL', 'ENTERPRISE', 'ELITE'];
}

/**
 * Check if a tier has a specific feature
 */
export function tierHasFeature(tier: TierName, feature: string): boolean {
  const features = PRICING_TIERS[tier].features as Record<string, unknown>;
  return feature in features && features[feature] !== false;
}

/**
 * Get the tier index (0-based) for comparison
 */
export function getTierIndex(tier: TierName): number {
  return getTierOrder().indexOf(tier);
}

/**
 * Check if tierA is higher than tierB
 */
export function isHigherTier(tierA: TierName, tierB: TierName): boolean {
  return getTierIndex(tierA) > getTierIndex(tierB);
}
