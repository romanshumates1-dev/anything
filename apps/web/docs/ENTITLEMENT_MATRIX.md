# DealFlow AI - Entitlement Matrix

## Pricing Tiers Overview

DealFlow AI offers 8 pricing tiers with 4 billing period options (1, 3, 6, and 12 months). Longer commitments receive progressive discounts.

## Pricing Table

| Tier | Monthly | 3-Month | 6-Month | Annual | Credits |
|------|---------|---------|---------|--------|---------|
| Starter | $100 | $270 ($90/mo) | $480 ($80/mo) | $840 ($70/mo) | 500 |
| Pro | $299 | $807 ($269/mo) | $1,494 ($249/mo) | $2,628 ($219/mo) | 2,000 |
| Business | $599 | $1,617 ($539/mo) | $2,994 ($499/mo) | $5,268 ($439/mo) | 5,000 |
| Growth | $999 | $2,697 ($899/mo) | $4,994 ($832/mo) | $8,788 ($732/mo) | 10,000 |
| Scale | $1,500 | $4,050 ($1,350/mo) | $7,500 ($1,250/mo) | $13,200 ($1,100/mo) | 20,000 |
| Professional | $2,499 | $6,747 ($2,249/mo) | $12,494 ($2,082/mo) | $21,988 ($1,832/mo) | 50,000 |
| Enterprise | $5,000 | $13,500 ($4,500/mo) | $25,000 ($4,167/mo) | $44,000 ($3,667/mo) | 100,000 |
| Elite | $10,000 | $27,000 ($9,000/mo) | $50,000 ($8,333/mo) | $88,000 ($7,333/mo) | 250,000 |

## Feature Entitlements

### Lead Management

| Feature | Starter | Pro | Business | Growth | Scale | Professional | Enterprise | Elite |
|---------|---------|-----|----------|--------|-------|--------------|------------|-------|
| Lead Limit | 100 | 500 | 2,000 | 5,000 | 10,000 | 25,000 | Unlimited | Unlimited |
| Campaign Limit | 2 | 10 | 25 | 50 | 100 | 200 | Unlimited | Unlimited |

### Outreach Capabilities

| Feature | Starter | Pro | Business | Growth | Scale | Professional | Enterprise | Elite |
|---------|---------|-----|----------|--------|-------|--------------|------------|-------|
| SMS/Month | 500 | 2,000 | 5,000 | 10,000 | 20,000 | 50,000 | 100,000 | Unlimited |
| Email/Month | 1,000 | 5,000 | 15,000 | 30,000 | 50,000 | 100,000 | 250,000 | Unlimited |
| AI Messages | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Phone Outreach | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

### Analytics & Reporting

| Feature | Starter | Pro | Business | Growth | Scale | Professional | Enterprise | Elite |
|---------|---------|-----|----------|--------|-------|--------------|------------|-------|
| Analytics Level | Basic | Standard | Advanced | Advanced | Full | Full | Full | Full |

Analytics levels:
- **Basic**: Campaign performance, open/click rates
- **Standard**: Basic + conversion tracking, A/B testing
- **Advanced**: Standard + predictive analytics, ROI tracking
- **Full**: Advanced + custom reports, data export, API access

### Team & Collaboration

| Feature | Starter | Pro | Business | Growth | Scale | Professional | Enterprise | Elite |
|---------|---------|-----|----------|--------|-------|--------------|------------|-------|
| Team Seats | 1 | 3 | 5 | 10 | 15 | 25 | 50 | Unlimited |

### Premium Features

| Feature | Starter | Pro | Business | Growth | Scale | Professional | Enterprise | Elite |
|---------|---------|-----|----------|--------|-------|--------------|------------|-------|
| API Access | No | No | No | No | No | Yes | Yes | Yes |
| Dedicated Support | No | No | No | No | No | No | Yes | Yes |
| White Label | No | No | No | No | No | No | No | Yes |

## Billing Period Discounts

| Period | Discount |
|--------|----------|
| Monthly | 0% (Base price) |
| 3-Month | ~10% off |
| 6-Month | ~20% off |
| Annual | ~30% off |

## Credit System

Credits are used for:
- AI-powered lead scoring and analysis
- Automated negotiation assistance
- Property valuation estimates
- Market analysis reports
- Skip tracing lookups

Credit allocation resets monthly regardless of billing period.

## Upgrade/Downgrade Policy

- **Upgrades**: Prorated credit for remaining time on current plan
- **Downgrades**: Take effect at end of current billing period
- **Mid-cycle changes**: Available for upgrades only

## Enterprise Custom Plans

For organizations needing:
- Custom lead/campaign limits beyond Elite tier
- Dedicated infrastructure
- Custom integrations
- SLA guarantees
- Volume discounts

Contact sales@dealflow.ai for custom enterprise pricing.

## Implementation Reference

```typescript
import { 
  PRICING_TIERS,
  getTierPrice,
  getEffectiveMonthlyPrice,
  getTierFeatures,
  getTierCredits,
  getDiscountPercentage 
} from '@/app/api/utils/pricingTiers';

// Get price for Pro tier, annual billing
const price = getTierPrice('PRO', 12); // 2628

// Get effective monthly rate
const monthly = getEffectiveMonthlyPrice('PRO', 12); // 219

// Get features for a tier
const features = getTierFeatures('BUSINESS');
// { leads: 2000, campaigns: 25, ... }

// Get discount percentage
const discount = getDiscountPercentage('PRO', 12); // 27
```
