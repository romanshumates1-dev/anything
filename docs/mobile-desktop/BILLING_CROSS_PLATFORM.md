# Billing & Entitlements Cross-Platform Guide

> **Key Principle**: Backend is AUTHORITATIVE. Clients display, never decide.

This document provides the complete reference for implementing billing, credits, and entitlements across mobile (iOS/Android), desktop (Electron), and web platforms.

---

## Architecture Overview

```
+------------------+     +------------------+     +------------------+
|     iOS App      |     |   Android App    |     |   Desktop App    |
+------------------+     +------------------+     +------------------+
         |                       |                       |
         +-------------------+---+-----------------------+
                             |
                    +--------v--------+
                    |   REST API      |
                    |  (Next.js)      |
                    +--------+--------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v--------+ +--------v--------+ +--------v--------+
|    Credits      | |  Entitlements   | |  Subscriptions  |
|    System       | |    System       | |    System       |
+-----------------+ +-----------------+ +-----------------+
         |                   |                   |
         +-------------------+-------------------+
                             |
                    +--------v--------+
                    |   PostgreSQL    |
                    |    (Neon)       |
                    +-----------------+
```

---

## Credit APIs

### GET /api/credits - Get Balance & Costs

Returns current credit balance and tier-specific costs.

**Request:**
```http
GET /api/credits?history=true&limit=20
Authorization: Bearer <session_token>
```

**Response:**
```json
{
  "balance": 1500,
  "lifetimePurchased": 5000,
  "lifetimeUsed": 3500,
  "tier": "pro",
  "costs": {
    "SMS_SEND": 3,
    "EMAIL_SEND": 1,
    "AI_REQUEST": 8,
    "AI_NEGOTIATION": 20,
    "CONTRACT_GENERATE": 12,
    "LEAD_FIND": 2
  },
  "transactions": [
    {
      "id": "txn_1234567890_abc",
      "type": "DEDUCT",
      "amount": -5,
      "balanceAfter": 1500,
      "description": "SMS_SEND operation",
      "createdAt": "2026-09-16T10:30:00.000Z"
    }
  ]
}
```

### GET /api/credits/purchase - List Credit Packs

Returns available credit packs for purchase.

**Response:**
```json
{
  "packs": [
    { "id": "pack_100", "credits": 100, "price": 5, "pricePerCredit": 0.05, "label": "100 Credits" },
    { "id": "pack_500", "credits": 500, "price": 20, "pricePerCredit": 0.04, "label": "500 Credits", "popular": true, "savings": "20%" },
    { "id": "pack_1000", "credits": 1000, "price": 35, "pricePerCredit": 0.035, "label": "1,000 Credits", "savings": "30%" },
    { "id": "pack_5000", "credits": 5000, "price": 150, "pricePerCredit": 0.03, "label": "5,000 Credits", "savings": "40%" },
    { "id": "pack_10000", "credits": 10000, "price": 250, "pricePerCredit": 0.025, "label": "10,000 Credits", "savings": "50%" }
  ]
}
```

### POST /api/credits/purchase - Purchase Credits

Creates Stripe checkout session for credit purchase.

**Request:**
```json
{
  "packId": "pack_500"
}
```

**Response:**
```json
{
  "success": true,
  "checkoutUrl": "https://checkout.stripe.com/..."
}
```

---

## Subscription APIs

### GET /api/billing/subscribe - Get Current Subscription

Returns current subscription status and usage.

**Request:**
```http
GET /api/billing/subscribe?usage=true
Authorization: Bearer <session_token>
```

**Response:**
```json
{
  "subscription": {
    "tier": "pro",
    "price": 299,
    "trialEndsAt": "2026-09-30T00:00:00.000Z",
    "isTrialing": true
  },
  "limits": {
    "aiCredits": 2000,
    "aiCreditsMax": 2000,
    "leads": 500,
    "sms": 2000,
    "campaigns": 10,
    "users": 3
  },
  "features": ["campaigns", "bulk_sms", "bulk_email", "lead_finder", "analytics"],
  "usage": {
    "leads_count": 150,
    "campaigns_count": 3,
    "users_count": 2
  },
  "plans": { ... },
  "creditPacks": { ... }
}
```

### GET /api/billing/plans - List Available Plans

Returns all subscription plans from database.

**Response:**
```json
{
  "plans": [
    {
      "id": "starter",
      "name": "Starter",
      "tier": "starter",
      "price": 100,
      "limits": { "sms": 500, "email": 1000, "ai": 500 },
      "overage": { "sms": 0.02, "email": 0.005, "ai": 0.05 },
      "features": ["campaigns", "csv_export"],
      "campaigns": 2,
      "seats": 1
    }
  ]
}
```

### POST /api/billing/subscribe - Subscribe/Upgrade

**For existing users (upgrade):**
```json
{
  "planId": "pro",
  "promoCode": "LAUNCH50"
}
```

**For new users (signup + subscribe):**
```json
{
  "planId": "pro",
  "email": "user@example.com",
  "password": "securepassword",
  "promoCode": "LAUNCH50"
}
```

**Response:**
```json
{
  "success": true,
  "plan": "pro",
  "price": 150,
  "trial": true,
  "trialDays": 14,
  "message": "Upgraded to Pro plan. 14-day free trial started."
}
```

### GET /api/billing/refund - Check Refund Eligibility

**Response:**
```json
{
  "eligible": true,
  "reason": null,
  "details": {
    "subscriptionTier": "pro",
    "purchasedAt": "2026-09-10T00:00:00.000Z",
    "refundWindowEnds": "2026-09-17T00:00:00.000Z",
    "daysRemaining": 1,
    "subscriptionPrice": "$299.00",
    "creditsUsed": 50,
    "creditsNonRefundable": "$2.50",
    "eligibleRefund": "$296.50"
  }
}
```

### POST /api/billing/refund - Request Refund

**Request:**
```json
{
  "reason": "No longer need the service",
  "confirmCreditsLoss": true
}
```

---

## Entitlement Checking

### Features by Tier

| Feature | FREE | STARTER | PRO | ENTERPRISE |
|---------|------|---------|-----|------------|
| campaigns | Yes | Yes | Yes | Yes |
| ai_negotiation | - | - | Yes | Yes |
| bulk_sms | - | - | Yes | Yes |
| bulk_email | - | Yes | Yes | Yes |
| contract_generation | - | - | Yes | Yes |
| lead_finder | - | Yes | Yes | Yes |
| advanced_analytics | - | - | Yes | Yes |
| api_access | - | - | Yes | Yes |
| team_members | - | - | Yes | Yes |
| custom_branding | - | - | - | Yes |
| priority_support | - | - | - | Yes |
| webhook_integrations | - | - | Yes | Yes |
| csv_export | Yes | Yes | Yes | Yes |
| crm_integrations | - | Yes | Yes | Yes |

### Usage Limits by Tier

| Resource | FREE | STARTER | PRO | ENTERPRISE |
|----------|------|---------|-----|------------|
| campaigns_per_month | 2 | 10 | 50 | Unlimited |
| leads_per_month | 50 | 500 | 5,000 | Unlimited |
| sms_per_day | 10 | 100 | 1,000 | 10,000 |
| emails_per_day | 25 | 500 | 5,000 | 50,000 |
| ai_requests_per_day | 5 | 50 | 500 | 5,000 |
| team_members | 1 | 3 | 10 | Unlimited |
| active_campaigns | 1 | 3 | 10 | Unlimited |
| contacts | 100 | 1,000 | 10,000 | Unlimited |
| api_calls_per_minute | 10 | 30 | 100 | 500 |

### Credit Costs by Tier

| Action | FREE | STARTER | PRO | ENTERPRISE |
|--------|------|---------|-----|------------|
| SMS_SEND | 7 | 6 | 5 | 4 |
| EMAIL_SEND | 3 | 2 | 2 | 1 |
| AI_REQUEST | 15 | 12 | 10 | 8 |
| AI_NEGOTIATION | 38 | 30 | 25 | 20 |
| CONTRACT_GENERATE | 23 | 18 | 15 | 12 |
| LEAD_FIND | 5 | 4 | 3 | 2 |

*Note: FREE tier has 1.5x multiplier, STARTER has 1.2x, PRO is base (1.0x), ENTERPRISE has 0.8x (20% discount)*

---

## Pricing Tiers (8-Tier System)

| Tier | Monthly | 3-Month | 6-Month | Annual | Credits/Mo |
|------|---------|---------|---------|--------|------------|
| STARTER | $100 | $270 | $480 | $840 | 500 |
| PRO | $299 | $807 | $1,494 | $2,628 | 2,000 |
| BUSINESS | $599 | $1,617 | $2,994 | $5,268 | 5,000 |
| GROWTH | $999 | $2,697 | $4,994 | $8,788 | 10,000 |
| SCALE | $1,500 | $4,050 | $7,500 | $13,200 | 20,000 |
| PROFESSIONAL | $2,499 | $6,747 | $12,494 | $21,988 | 50,000 |
| ENTERPRISE | $5,000 | $13,500 | $25,000 | $44,000 | 100,000 |
| ELITE | $10,000 | $27,000 | $50,000 | $88,000 | 250,000 |

### Tier Feature Matrix

| Feature | STARTER | PRO | BUSINESS | GROWTH+ |
|---------|---------|-----|----------|---------|
| Leads | 100 | 500 | 2,000 | 5,000+ |
| Campaigns | 2 | 10 | 25 | 50+ |
| SMS/Month | 500 | 2,000 | 5,000 | 10,000+ |
| Email/Month | 1,000 | 5,000 | 15,000 | 30,000+ |
| AI Messages | Yes | Yes | Yes | Yes |
| Phone Outreach | - | Yes | Yes | Yes |
| Analytics | Basic | Standard | Advanced | Full |
| Team Seats | 1 | 3 | 5 | 10+ |
| API Access | - | - | - | PROFESSIONAL+ |
| White Label | - | - | - | ELITE only |

---

## Mobile/Desktop Implementation

### 1. Fetch Subscription on App Start

```typescript
// On app launch / user login
async function initializeBilling() {
  try {
    const response = await fetch('/api/billing/subscribe?usage=true', {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    const data = await response.json();
    
    // Cache for UI display
    billingStore.setSubscription(data.subscription);
    billingStore.setLimits(data.limits);
    billingStore.setFeatures(data.features);
    
    // Fetch credits balance
    const credits = await fetch('/api/credits', {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    billingStore.setCredits(await credits.json());
  } catch (error) {
    // Handle offline - use cached values
    console.warn('Could not fetch billing info, using cache');
  }
}
```

### 2. Cache Tier for UI Display

```typescript
interface BillingCache {
  subscription: {
    tier: string;
    price: number;
    trialEndsAt: string | null;
    isTrialing: boolean;
  };
  credits: {
    balance: number;
    costs: Record<string, number>;
  };
  limits: Record<string, number>;
  features: string[];
  lastFetched: number;
}

// Cache TTL: 5 minutes for credits, 15 minutes for subscription
const CREDITS_CACHE_TTL = 5 * 60 * 1000;
const SUBSCRIPTION_CACHE_TTL = 15 * 60 * 1000;

function shouldRefreshCredits(cache: BillingCache): boolean {
  return Date.now() - cache.lastFetched > CREDITS_CACHE_TTL;
}
```

### 3. Check Entitlements Before Actions

```typescript
// ALWAYS check server before expensive operations
async function canPerformAction(
  feature: string, 
  creditAction?: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Quick local check for obvious failures
  if (!billingCache.features.includes(feature)) {
    return { 
      allowed: false, 
      reason: `Feature '${feature}' requires upgrade` 
    };
  }
  
  // For credit-consuming actions, verify balance
  if (creditAction) {
    const cost = billingCache.credits.costs[creditAction] || 10;
    if (billingCache.credits.balance < cost) {
      return {
        allowed: false,
        reason: `Insufficient credits (need ${cost}, have ${billingCache.credits.balance})`
      };
    }
    
    // Server verification for important actions
    const response = await fetch('/api/credits', {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    const serverCredits = await response.json();
    if (serverCredits.balance < cost) {
      return {
        allowed: false,
        reason: 'Insufficient credits (server verified)'
      };
    }
  }
  
  return { allowed: true };
}
```

### 4. Handle 403 Gracefully with Upgrade Prompt

```typescript
async function handleApiResponse(response: Response) {
  if (response.status === 403) {
    const error = await response.json();
    
    if (error.code === 'FEATURE_NOT_ALLOWED') {
      showUpgradePrompt({
        title: 'Feature Unavailable',
        message: error.message,
        upgradeRequired: error.upgradeRequired,
        currentTier: error.tier
      });
    } else if (error.code === 'LIMIT_EXCEEDED') {
      showLimitExceededDialog({
        resource: error.resource,
        current: error.current,
        limit: error.limit,
        resetAt: error.resetAt
      });
    } else if (error.code === 'INSUFFICIENT_CREDITS') {
      showPurchaseCreditsPrompt({
        needed: error.cost,
        balance: error.balance
      });
    }
    
    return null;
  }
  
  return response.json();
}
```

### 5. Sync Credits Periodically

```typescript
// Refresh credits after any action that consumes them
async function refreshCreditsAfterAction() {
  try {
    const response = await fetch('/api/credits', {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    const data = await response.json();
    billingStore.setCredits(data);
  } catch {
    // Silent fail - will sync on next app focus
  }
}

// Also refresh when app comes to foreground
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (shouldRefreshCredits(billingCache)) {
      refreshCreditsAfterAction();
    }
  }
});
```

---

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `INSUFFICIENT_CREDITS` | 402 | Not enough credits for operation |
| `FEATURE_NOT_ALLOWED` | 403 | Feature requires higher tier |
| `LIMIT_EXCEEDED` | 429 | Usage limit reached for resource |
| `INVALID_AMOUNT` | 400 | Invalid credit amount specified |
| `DUPLICATE` | 200* | Idempotent request already processed |
| `OVERFLOW` | 400 | Would exceed max credit balance |
| `INTERNAL_ERROR` | 500 | Server-side failure |

*DUPLICATE returns 200 with the original transaction result for idempotency

---

## Security Considerations

1. **Never trust client state** - All billing decisions are server-side
2. **Use idempotency keys** - Prevent double-charges on retry
3. **Validate organization ID** - UUID format enforced
4. **Row locking** - Prevents race conditions on balance updates
5. **Ledger integrity** - All transactions logged immutably
6. **Audit trail** - Every change is logged with user/timestamp

---

## Credit System Guarantees

The credit system provides bulletproof guarantees:

- **Atomic operations** with row locking (`FOR UPDATE SKIP LOCKED`)
- **Integer overflow protection** (max 2B credits)
- **Underflow protection** (balance never negative)
- **Immutable transaction ledger** (every change logged)
- **Idempotency support** via idempotency keys
- **Race condition prevention** via pessimistic locking
- **Double-spend prevention** via atomic CTE operations

---

## Related Documentation

- [Entitlement Matrix](../ENTITLEMENT_MATRIX.md)
- [Web Parity Matrix](./WEB_PARITY_MATRIX.md)
- [Campaign Cross Platform](./CAMPAIGN_CROSS_PLATFORM.md)
- [Campaign API Contract](./CAMPAIGN_API_CONTRACT.md)
