export function buildPriceLadder(min: number, max: number, direction: 'SELLER' | 'BUYER'): {
  tier1: number; tier2: number; tier3: number; tier4: number;
} {
  const span = max - min;
  if (direction === 'SELLER') {
    return {
      tier1: Math.round(max - span * 0.05),
      tier2: Math.round(max - span * 0.35),
      tier3: Math.round(max - span * 0.65),
      tier4: min,
    };
  }
  return {
    tier1: max,
    tier2: Math.round(max - span * 0.30),
    tier3: Math.round(max - span * 0.60),
    tier4: min,
  };
}

export function currentTierPrice(range: {
  tier1Price: number; tier2Price: number; tier3Price: number; tier4Price: number;
  currentTier: number;
}): number {
  const tiers = [range.tier1Price, range.tier2Price, range.tier3Price, range.tier4Price];
  return tiers[range.currentTier - 1] ?? range.tier4Price;
}