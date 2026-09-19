# DealFlow AI - Entitlement Matrix

## Overview

This document defines the complete entitlement matrix for DealFlow AI's 8-tier pricing system. Each tier provides progressively more features, limits, and capabilities to serve different scales of real estate wholesaling operations.

## Pricing Tiers Summary

| Tier | Monthly | 3-Month | 6-Month | 12-Month | Effective Monthly (Annual) |
|------|---------|---------|---------|----------|---------------------------|
| Starter | $100 | $270 | $480 | $840 | $70 |
| Pro | $299 | $807 | $1,494 | $2,628 | $219 |
| Business | $599 | $1,617 | $2,994 | $5,268 | $439 |
| Growth | $999 | $2,697 | $4,994 | $8,788 | $732 |
| Scale | $1,500 | $4,050 | $7,500 | $13,200 | $1,100 |
| Professional | $2,499 | $6,747 | $12,494 | $21,988 | $1,832 |
| Enterprise | $5,000 | $13,500 | $25,000 | $44,000 | $3,667 |
| Elite | $10,000 | $27,000 | $50,000 | $88,000 | $7,333 |

## Discount Structure

| Period | Discount |
|--------|----------|
| Monthly (1) | 0% |
| Quarterly (3) | 10% |
| Semi-Annual (6) | 20% |
| Annual (12) | 30% |

## Feature Entitlements by Tier

### Lead Limits

| Tier | Leads/Month |
|------|-------------|
| Starter | 100 |
| Pro | 500 |
| Business | 2,000 |
| Growth | 5,000 |
| Scale | 10,000 |
| Professional | 25,000 |
| Enterprise | Unlimited |
| Elite | Unlimited |

### Campaign Limits

| Tier | Active Campaigns |
|------|-----------------|
| Starter | 2 |
| Pro | 10 |
| Business | 25 |
| Growth | 50 |
| Scale | 100 |
| Professional | 200 |
| Enterprise | Unlimited |
| Elite | Unlimited |

### Messaging Limits

| Tier | SMS/Month | Email/Month |
|------|-----------|-------------|
| Starter | 500 | 1,000 |
| Pro | 2,000 | 5,000 |
| Business | 5,000 | 15,000 |
| Growth | 10,000 | 30,000 |
| Scale | 20,000 | 50,000 |
| Professional | 50,000 | 100,000 |
| Enterprise | 100,000 | 250,000 |
| Elite | Unlimited | Unlimited |

### AI Credits

| Tier | Monthly Credits |
|------|-----------------|
| Starter | 500 |
| Pro | 2,000 |
| Business | 5,000 |
| Growth | 10,000 |
| Scale | 20,000 |
| Professional | 50,000 |
| Enterprise | 100,000 |
| Elite | 250,000 |

### Team Seats

| Tier | Included Seats |
|------|----------------|
| Starter | 1 |
| Pro | 3 |
| Business | 5 |
| Growth | 10 |
| Scale | 15 |
| Professional | 25 |
| Enterprise | 50 |
| Elite | Unlimited |

## Feature Availability Matrix

| Feature | Starter | Pro | Business | Growth | Scale | Professional | Enterprise | Elite |
|---------|---------|-----|----------|--------|-------|--------------|------------|-------|
| AI Messages | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Phone Outreach | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Basic Analytics | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Standard Analytics | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Advanced Analytics | No | No | Yes | Yes | Yes | Yes | Yes | Yes |
| Full Analytics Suite | No | No | No | No | Yes | Yes | Yes | Yes |
| API Access | No | No | No | No | No | Yes | Yes | Yes |
| Dedicated Support | No | No | No | No | No | No | Yes | Yes |
| White Label | No | No | No | No | No | No | No | Yes |

## Analytics Tiers Explained

### Basic Analytics (Starter)
- Campaign performance metrics
- Basic lead tracking
- Simple conversion reports

### Standard Analytics (Pro)
- Everything in Basic
- A/B testing results
- Response rate analysis
- Lead source tracking

### Advanced Analytics (Business, Growth)
- Everything in Standard
- Predictive lead scoring
- Market trend analysis
- ROI calculations
- Competitor insights

### Full Analytics Suite (Scale+)
- Everything in Advanced
- Custom report builder
- Data export API
- Real-time dashboards
- AI-powered recommendations
- Revenue forecasting

## API Access Details (Professional+)

| Capability | Professional | Enterprise | Elite |
|------------|--------------|------------|-------|
| API Calls/Hour | 1,000 | 10,000 | Unlimited |
| Webhook Events | Yes | Yes | Yes |
| Bulk Operations | Yes | Yes | Yes |
| Custom Integrations | No | Yes | Yes |
| Priority Rate Limits | No | Yes | Yes |

## Support Tiers

| Tier | Support Level | Response Time |
|------|---------------|---------------|
| Starter | Email | 48 hours |
| Pro | Email + Chat | 24 hours |
| Business | Email + Chat | 12 hours |
| Growth | Email + Chat + Phone | 8 hours |
| Scale | Priority Support | 4 hours |
| Professional | Priority Support | 2 hours |
| Enterprise | Dedicated CSM | 1 hour |
| Elite | Dedicated Team | 15 minutes |

## White Label Features (Elite Only)

- Custom domain support
- Branded email templates
- Custom logo and colors
- Branded mobile app
- Reseller dashboard
- Sub-account management
- Custom onboarding

## Overage Pricing

When limits are exceeded, the following overage rates apply:

| Resource | Overage Rate |
|----------|--------------|
| Additional Leads | $0.10/lead |
| Additional SMS | $0.05/message |
| Additional Email | $0.01/email |
| Additional AI Credits | $0.002/credit |
| Additional Team Seats | $25/seat/month |

## Implementation Reference

The pricing tiers are implemented in:
- `apps/web/src/app/api/utils/pricingTiers.ts`

### Usage Example

```typescript
import {
  PRICING_TIERS,
  getTierPrice,
  getEffectiveMonthlyPrice,
  getTierFeatures,
  getTierCredits,
  getDiscountPercentage,
  tierHasFeature,
  isHigherTier
} from '@/app/api/utils/pricingTiers';

// Get price for Business tier, annual billing
const price = getTierPrice('BUSINESS', 12); // 5268

// Get effective monthly price
const monthly = getEffectiveMonthlyPrice('BUSINESS', 12); // 439

// Check if tier has a feature
const hasApi = tierHasFeature('PROFESSIONAL', 'apiAccess'); // true

// Compare tiers
const isUpgrade = isHigherTier('GROWTH', 'PRO'); // true
```

## Billing Period Options

| Period | Months | Discount | Payment |
|--------|--------|----------|---------|
| Monthly | 1 | 0% | Recurring |
| Quarterly | 3 | 10% | Upfront |
| Semi-Annual | 6 | 20% | Upfront |
| Annual | 12 | 30% | Upfront |

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-09-16 | Initial 8-tier pricing structure |
