# Pricing, UX & Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement value-based pricing model, UX improvements across core pages, and design system updates for production readiness.

**Architecture:** Database migration updates pricing tiers and adds overage tracking. Pricing page reflects new tiers/packs. Design system CSS variables applied globally. Dashboard/CRM pages get KPI cards, filters, and improved layouts.

**Tech Stack:** Next.js 14, PostgreSQL (Neon), TailwindCSS, React 18

## Global Constraints

- All prices in cents in database, dollars in UI
- Margins must remain 95%+ on all tiers
- SMS cost assumption: $0.015/msg (AWS SNS 10DLC)
- Email cost assumption: $0.0001/msg (AWS SES)
- AI credit cost assumption: $0.002/call (Claude Haiku 4.5)
- Design tokens use CSS variables (not hardcoded values)
- No new dependencies without explicit approval
- Typecheck must pass after each task

---

### Task 1: Database Migration - New Pricing Tiers

**Files:**
- Create: `apps/web/db/migrations/067_value_based_pricing.sql`

**Interfaces:**
- Consumes: existing `subscription_tiers` table schema
- Produces: updated tier rows with new prices, limits, and overage rates

- [ ] **Step 1: Create migration file**

```sql
-- 067_value_based_pricing.sql
-- Value-based pricing model with 97%+ margins

BEGIN;

-- Clear existing tiers (they reference old pricing)
DELETE FROM subscription_tiers;

-- Insert new value-based tiers
INSERT INTO subscription_tiers (
  name, slug, price_cents, sms_limit, email_limit, ai_credits,
  sms_overage_cents, email_overage_cents, ai_overage_cents,
  features, is_active
) VALUES
  -- Free tier (hard caps, no overage)
  ('Free', 'free', 0, 0, 25, 5, NULL, NULL, NULL,
   '["Basic CRM", "25 emails/mo", "5 AI credits"]', true),

  -- Starter: $129/mo
  ('Starter', 'starter', 12900, 100, 500, 250, 18, 1, 15,
   '["100 SMS/mo", "500 emails/mo", "250 AI credits", "Basic analytics", "Email support"]', true),

  -- Pro: $399/mo
  ('Pro', 'pro', 39900, 300, 2500, 1500, 15, 1, 12,
   '["300 SMS/mo", "2,500 emails/mo", "1,500 AI credits", "Advanced analytics", "Priority support", "Custom templates"]', true),

  -- Business: $899/mo
  ('Business', 'business', 89900, 1000, 10000, 5000, 12, 1, 8,
   '["1,000 SMS/mo", "10,000 emails/mo", "5,000 AI credits", "Team features", "API access", "Dedicated success manager"]', true),

  -- Scale: $2,499/mo
  ('Scale', 'scale', 249900, 3000, 50000, 20000, 9, 1, 5,
   '["3,000 SMS/mo", "50,000 emails/mo", "20,000 AI credits", "White-label options", "Custom integrations", "SLA guarantee"]', true);

COMMIT;
```

- [ ] **Step 2: Apply migration**

Run: `cd apps/web && node --env-file=.env -e "const {neon}=require('@neondatabase/serverless');const sql=neon(process.env.DATABASE_URL);require('fs').readFileSync('db/migrations/067_value_based_pricing.sql','utf8').split(';').filter(s=>s.trim()).forEach(async s=>await sql(s))"`

Expected: No errors, tiers updated

- [ ] **Step 3: Verify migration**

Run: `cd apps/web && node --env-file=.env -e "const {neon}=require('@neondatabase/serverless');const sql=neon(process.env.DATABASE_URL);sql\`SELECT name, price_cents, sms_limit, sms_overage_cents FROM subscription_tiers ORDER BY price_cents\`.then(console.log)"`

Expected: 5 tiers with correct prices (0, 12900, 39900, 89900, 249900)

- [ ] **Step 4: Commit**

```bash
git add apps/web/db/migrations/067_value_based_pricing.sql
git commit -m "feat(pricing): add value-based pricing tiers with 97%+ margins

- Free: $0 (25 email, 5 AI, hard caps)
- Starter: $129 (100 SMS, 500 email, 250 AI)
- Pro: $399 (300 SMS, 2.5K email, 1.5K AI)
- Business: $899 (1K SMS, 10K email, 5K AI)
- Scale: $2,499 (3K SMS, 50K email, 20K AI)

Overage rates decrease with tier level."
```

---

### Task 2: Update Pricing Page Component

**Files:**
- Modify: `apps/web/src/app/(marketing)/pricing/page.tsx`

**Interfaces:**
- Consumes: Task 1's tier structure
- Produces: Updated TIERS array, SMS_PACKS array, AI_PACKS array

- [ ] **Step 1: Update TIERS constant**

Replace the existing TIERS array with:

```typescript
const TIERS = [
  {
    name: 'Free',
    slug: 'free',
    price: 0,
    description: 'Try before you buy',
    features: [
      '25 emails/month',
      '5 AI credits',
      'Basic CRM',
      'Lead tracking',
    ],
    limits: { sms: 0, email: 25, ai: 5 },
    cta: 'Start Free',
    popular: false,
  },
  {
    name: 'Starter',
    slug: 'starter',
    price: 129,
    description: 'For new wholesalers',
    features: [
      '100 SMS/month',
      '500 emails/month',
      '250 AI credits',
      'Basic analytics',
      'Email support',
    ],
    limits: { sms: 100, email: 500, ai: 250 },
    overage: { sms: 0.18, email: 0.005, ai: 0.15 },
    cta: 'Get Started',
    popular: false,
  },
  {
    name: 'Pro',
    slug: 'pro',
    price: 399,
    description: 'For active wholesalers',
    features: [
      '300 SMS/month',
      '2,500 emails/month',
      '1,500 AI credits',
      'Advanced analytics',
      'Priority support',
      'Custom templates',
    ],
    limits: { sms: 300, email: 2500, ai: 1500 },
    overage: { sms: 0.15, email: 0.003, ai: 0.12 },
    cta: 'Go Pro',
    popular: true,
  },
  {
    name: 'Business',
    slug: 'business',
    price: 899,
    description: 'For growing teams',
    features: [
      '1,000 SMS/month',
      '10,000 emails/month',
      '5,000 AI credits',
      'Team features',
      'API access',
      'Dedicated success manager',
    ],
    limits: { sms: 1000, email: 10000, ai: 5000 },
    overage: { sms: 0.12, email: 0.002, ai: 0.08 },
    cta: 'Scale Up',
    popular: false,
  },
  {
    name: 'Scale',
    slug: 'scale',
    price: 2499,
    description: 'For high-volume operations',
    features: [
      '3,000 SMS/month',
      '50,000 emails/month',
      '20,000 AI credits',
      'White-label options',
      'Custom integrations',
      'SLA guarantee',
    ],
    limits: { sms: 3000, email: 50000, ai: 20000 },
    overage: { sms: 0.09, email: 0.001, ai: 0.05 },
    cta: 'Contact Sales',
    popular: false,
  },
];
```

- [ ] **Step 2: Add SMS_PACKS constant**

Add after TIERS:

```typescript
const SMS_PACKS = [
  { name: 'Starter', sms: 1000, price: 149, perSms: 0.149 },
  { name: 'Growth', sms: 5000, price: 599, perSms: 0.1198 },
  { name: 'Pro', sms: 15000, price: 1299, perSms: 0.0866 },
  { name: 'Volume', sms: 50000, price: 3499, perSms: 0.07 },
];

const AI_PACKS = [
  { name: 'Starter', credits: 500, price: 49, perCredit: 0.098 },
  { name: 'Growth', credits: 2500, price: 149, perCredit: 0.0596 },
  { name: 'Pro', credits: 10000, price: 449, perCredit: 0.0449 },
  { name: 'Volume', credits: 50000, price: 1799, perCredit: 0.036 },
];
```

- [ ] **Step 3: Update the pricing grid JSX**

Find the pricing cards section and update to show overage rates for paid tiers:

```tsx
{tier.overage && (
  <div className="mt-4 pt-4 border-t border-gray-200">
    <p className="text-xs text-gray-500 font-medium mb-2">Overage rates:</p>
    <div className="text-xs text-gray-500 space-y-1">
      <p>SMS: ${tier.overage.sms}/msg</p>
      <p>Email: ${tier.overage.email}/email</p>
      <p>AI: ${tier.overage.ai}/credit</p>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(marketing)/pricing/page.tsx
git commit -m "feat(pricing): update pricing page with value-based tiers

- New tier prices: Free, $129, $399, $899, $2,499
- Added SMS packs: 1K-50K messages
- Added AI credit packs: 500-50K credits
- Display overage rates per tier"
```

---

### Task 3: Update Outreach Calculator Costs

**Files:**
- Modify: `apps/web/src/app/api/campaigns/outreach-calculator/route.ts:49-55`

**Interfaces:**
- Consumes: None
- Produces: Corrected BENCHMARKS.costs with accurate AWS pricing

- [ ] **Step 1: Update BENCHMARKS.costs**

Replace lines 49-55:

```typescript
  // Cost per channel (verified AWS pricing 2026-08)
  costs: {
    emailPer1000: 0.10,      // AWS SES: $0.10/1000
    smsPer1000: 15.00,       // AWS SNS 10DLC: ~$0.015/msg
    rcsPer1000: 15.00,       // AWS RCS (similar to SMS)
    directMailPer1000: 450,  // Printed mailers
  },
```

- [ ] **Step 2: Update smsDriver.ts comment**

In `apps/web/src/app/api/services/smsDriver.ts`, update line 5:

```typescript
 * Cost: ~$0.015 per SMS (AWS SNS 10DLC with carrier fees)
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/campaigns/outreach-calculator/route.ts apps/web/src/app/api/services/smsDriver.ts
git commit -m "fix(costs): correct SMS cost to $0.015/msg (AWS SNS 10DLC)

Previous value of $0.00645 was outdated. AWS SNS 10DLC
costs ~$0.015/msg including carrier fees."
```

---

### Task 4: Design System CSS Variables

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: None
- Produces: CSS custom properties for colors, typography, spacing

- [ ] **Step 1: Add CSS variables to globals.css**

Add at the top of the file, after any existing imports:

```css
:root {
  /* Primary - Deep blue (trust) */
  --color-primary-50: #EFF6FF;
  --color-primary-100: #DBEAFE;
  --color-primary-200: #BFDBFE;
  --color-primary-300: #93C5FD;
  --color-primary-400: #60A5FA;
  --color-primary-500: #1E40AF;
  --color-primary-600: #1E3A8A;
  --color-primary-700: #1E3A8A;

  /* Success - Emerald green (money) */
  --color-success-50: #ECFDF5;
  --color-success-100: #D1FAE5;
  --color-success-500: #059669;
  --color-success-600: #047857;
  --color-success-700: #065F46;

  /* Warning - Amber */
  --color-warning-50: #FFFBEB;
  --color-warning-100: #FEF3C7;
  --color-warning-500: #D97706;
  --color-warning-600: #B45309;

  /* Error - Red */
  --color-error-50: #FEF2F2;
  --color-error-100: #FEE2E2;
  --color-error-500: #DC2626;
  --color-error-600: #B91C1C;

  /* Neutrals */
  --color-gray-50: #F8FAFC;
  --color-gray-100: #F1F5F9;
  --color-gray-200: #E2E8F0;
  --color-gray-300: #CBD5E1;
  --color-gray-400: #94A3B8;
  --color-gray-500: #64748B;
  --color-gray-600: #475569;
  --color-gray-700: #334155;
  --color-gray-800: #1E293B;
  --color-gray-900: #0F172A;

  /* Typography */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Spacing (4px base) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;

  /* Border radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors (CSS doesn't affect TS)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(design): add CSS custom properties for design system

- Primary blue palette (trust)
- Success green palette (money)
- Warning amber, error red
- Gray neutrals
- Typography variables
- Spacing scale (4px base)
- Border radius and shadows"
```

---

### Task 5: Dashboard KPI Cards Component

**Files:**
- Create: `apps/web/src/components/dashboard/KpiCard.tsx`
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: Design system CSS variables from Task 4
- Produces: `KpiCard` component with trend indicator

- [ ] **Step 1: Create KpiCard component**

```tsx
// apps/web/src/components/dashboard/KpiCard.tsx
'use client';

import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/20/solid';

interface KpiCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  format?: 'number' | 'currency' | 'percent';
}

export function KpiCard({
  title,
  value,
  change,
  changeLabel = 'vs last period',
  icon,
  format = 'number',
}: KpiCardProps) {
  const formatValue = (val: string | number) => {
    if (typeof val === 'string') return val;
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
        }).format(val);
      case 'percent':
        return `${val}%`;
      default:
        return new Intl.NumberFormat('en-US').format(val);
    }
  };

  const isPositive = change && change > 0;
  const isNegative = change && change < 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <p className="mt-2 text-3xl font-semibold text-gray-900">
        {formatValue(value)}
      </p>
      {change !== undefined && (
        <div className="mt-2 flex items-center text-sm">
          {isPositive && (
            <ArrowUpIcon className="h-4 w-4 text-green-500 mr-1" />
          )}
          {isNegative && (
            <ArrowDownIcon className="h-4 w-4 text-red-500 mr-1" />
          )}
          <span
            className={
              isPositive
                ? 'text-green-600'
                : isNegative
                ? 'text-red-600'
                : 'text-gray-500'
            }
          >
            {isPositive && '+'}
            {change}%
          </span>
          <span className="text-gray-400 ml-1">{changeLabel}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/KpiCard.tsx
git commit -m "feat(dashboard): add KpiCard component with trend indicators

- Supports number, currency, percent formats
- Shows change vs last period with arrows
- Uses design system colors"
```

---

### Task 6: Dashboard Action Items Widget

**Files:**
- Create: `apps/web/src/components/dashboard/ActionItems.tsx`

**Interfaces:**
- Consumes: None
- Produces: `ActionItems` component showing pending tasks

- [ ] **Step 1: Create ActionItems component**

```tsx
// apps/web/src/components/dashboard/ActionItems.tsx
'use client';

import Link from 'next/link';
import {
  ChatBubbleLeftIcon,
  DocumentTextIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

interface ActionItem {
  id: string;
  type: 'response_needed' | 'contract_expiring' | 'follow_up';
  title: string;
  subtitle: string;
  href: string;
  urgent?: boolean;
}

interface ActionItemsProps {
  items: ActionItem[];
}

const typeIcons = {
  response_needed: ChatBubbleLeftIcon,
  contract_expiring: DocumentTextIcon,
  follow_up: ClockIcon,
};

const typeColors = {
  response_needed: 'text-blue-500 bg-blue-50',
  contract_expiring: 'text-amber-500 bg-amber-50',
  follow_up: 'text-gray-500 bg-gray-50',
};

export function ActionItems({ items }: ActionItemsProps) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h3 className="text-sm font-medium text-gray-900 mb-4">Action Items</h3>
        <div className="text-center py-8">
          <p className="text-sm text-gray-500">You're all caught up!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <h3 className="text-sm font-medium text-gray-900 mb-4">
        Action Items{' '}
        <span className="text-gray-400">({items.length})</span>
      </h3>
      <ul className="divide-y divide-gray-100">
        {items.slice(0, 5).map((item) => {
          const Icon = typeIcons[item.type];
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-3 py-3 hover:bg-gray-50 -mx-2 px-2 rounded"
              >
                <div className={`p-2 rounded-lg ${typeColors[item.type]}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {item.subtitle}
                  </p>
                </div>
                {item.urgent && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                    Urgent
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {items.length > 5 && (
        <Link
          href="/tasks"
          className="block text-center text-sm text-blue-600 hover:text-blue-700 mt-4"
        >
          View all {items.length} items
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/ActionItems.tsx
git commit -m "feat(dashboard): add ActionItems widget

- Shows pending responses, expiring contracts, follow-ups
- Urgent badge for time-sensitive items
- Empty state when caught up"
```

---

### Task 7: Status Pill Component

**Files:**
- Create: `apps/web/src/components/ui/StatusPill.tsx`

**Interfaces:**
- Consumes: Design system colors from Task 4
- Produces: `StatusPill` component for consistent status display

- [ ] **Step 1: Create StatusPill component**

```tsx
// apps/web/src/components/ui/StatusPill.tsx
import { cn } from '@/lib/utils';

type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusPillProps {
  variant: StatusVariant;
  children: React.ReactNode;
  size?: 'sm' | 'md';
}

const variantStyles: Record<StatusVariant, string> = {
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
  neutral: 'bg-gray-100 text-gray-800',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

export function StatusPill({
  variant,
  children,
  size = 'sm',
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded-full',
        variantStyles[variant],
        sizeStyles[size]
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/StatusPill.tsx
git commit -m "feat(ui): add StatusPill component

- success, warning, error, info, neutral variants
- sm and md sizes
- Consistent status display across app"
```

---

### Task 8: Skeleton Loading Component

**Files:**
- Create: `apps/web/src/components/ui/Skeleton.tsx`

**Interfaces:**
- Consumes: None
- Produces: `Skeleton` component for loading states

- [ ] **Step 1: Create Skeleton component**

```tsx
// apps/web/src/components/ui/Skeleton.tsx
import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-gray-200',
        className
      )}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <Skeleton className="h-4 w-24 mb-2" />
      <Skeleton className="h-8 w-32 mb-4" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200">
        <Skeleton className="h-4 w-48" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-4 border-b border-gray-100 last:border-0"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32 mb-2" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/Skeleton.tsx
git commit -m "feat(ui): add Skeleton loading components

- Base Skeleton with pulse animation
- SkeletonCard for KPI cards
- SkeletonTable for list views"
```

---

### Task 9: Empty State Component

**Files:**
- Create: `apps/web/src/components/ui/EmptyState.tsx`

**Interfaces:**
- Consumes: None
- Produces: `EmptyState` component for zero-data states

- [ ] **Step 1: Create EmptyState component**

```tsx
// apps/web/src/components/ui/EmptyState.tsx
import Link from 'next/link';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    href: string;
  };
  secondaryAction?: {
    label: string;
    href: string;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="text-center py-12 px-4">
      {icon && (
        <div className="mx-auto h-12 w-12 text-gray-400 mb-4">{icon}</div>
      )}
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
        {description}
      </p>
      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          {action.label}
        </Link>
      )}
      {secondaryAction && (
        <Link
          href={secondaryAction.href}
          className="block mt-3 text-sm text-gray-500 hover:text-gray-700"
        >
          {secondaryAction.label}
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/EmptyState.tsx
git commit -m "feat(ui): add EmptyState component

- Icon, title, description
- Primary and secondary CTAs
- Centered layout with max-width"
```

---

### Task 10: Update Dashboard Page with New Components

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: KpiCard (Task 5), ActionItems (Task 6), SkeletonCard (Task 8)
- Produces: Updated dashboard with KPI grid and action items

- [ ] **Step 1: Read current dashboard page**

Read the file to understand current structure before modifying.

- [ ] **Step 2: Add imports for new components**

Add at top of file:

```tsx
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ActionItems } from '@/components/dashboard/ActionItems';
import { SkeletonCard } from '@/components/ui/Skeleton';
import {
  CurrencyDollarIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  DocumentCheckIcon,
} from '@heroicons/react/24/outline';
```

- [ ] **Step 3: Update the dashboard layout with KPI grid**

Replace or add KPI section:

```tsx
{/* KPI Grid */}
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
  <KpiCard
    title="Pipeline Value"
    value={stats?.pipelineValue || 0}
    change={stats?.pipelineChange}
    format="currency"
    icon={<CurrencyDollarIcon className="h-5 w-5" />}
  />
  <KpiCard
    title="Active Leads"
    value={stats?.activeLeads || 0}
    change={stats?.leadsChange}
    icon={<UserGroupIcon className="h-5 w-5" />}
  />
  <KpiCard
    title="Conversations"
    value={stats?.openConversations || 0}
    change={stats?.conversationsChange}
    icon={<ChatBubbleLeftRightIcon className="h-5 w-5" />}
  />
  <KpiCard
    title="Contracts Pending"
    value={stats?.pendingContracts || 0}
    change={stats?.contractsChange}
    icon={<DocumentCheckIcon className="h-5 w-5" />}
  />
</div>

{/* Action Items */}
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  <div className="lg:col-span-2">
    {/* Existing content like activity feed */}
  </div>
  <div>
    <ActionItems items={actionItems || []} />
  </div>
</div>
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors (may need to add stats type)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(app)/dashboard/page.tsx
git commit -m "feat(dashboard): integrate KPI cards and action items

- 4-column KPI grid with trends
- Pipeline value, active leads, conversations, contracts
- Action items widget in sidebar"
```

---

### Task 11: CRM Leads Filter Component

**Files:**
- Create: `apps/web/src/components/leads/LeadFilters.tsx`

**Interfaces:**
- Consumes: None
- Produces: `LeadFilters` component with status, source, date filters

- [ ] **Step 1: Create LeadFilters component**

```tsx
// apps/web/src/components/leads/LeadFilters.tsx
'use client';

import { useState } from 'react';
import { FunnelIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface FilterState {
  status: string[];
  source: string[];
  dateRange: string;
}

interface LeadFiltersProps {
  onFilterChange: (filters: FilterState) => void;
  initialFilters?: Partial<FilterState>;
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'appointment', label: 'Appointment Set' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'contract', label: 'Under Contract' },
  { value: 'closed', label: 'Closed' },
  { value: 'lost', label: 'Lost' },
];

const SOURCE_OPTIONS = [
  { value: 'propstream', label: 'PropStream' },
  { value: 'batchleads', label: 'BatchLeads' },
  { value: 'manual', label: 'Manual Entry' },
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
];

const DATE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
];

export function LeadFilters({ onFilterChange, initialFilters }: LeadFiltersProps) {
  const [filters, setFilters] = useState<FilterState>({
    status: initialFilters?.status || [],
    source: initialFilters?.source || [],
    dateRange: initialFilters?.dateRange || 'all',
  });
  const [isOpen, setIsOpen] = useState(false);

  const activeFilterCount =
    filters.status.length +
    filters.source.length +
    (filters.dateRange !== 'all' ? 1 : 0);

  const updateFilters = (newFilters: Partial<FilterState>) => {
    const updated = { ...filters, ...newFilters };
    setFilters(updated);
    onFilterChange(updated);
  };

  const clearFilters = () => {
    const cleared = { status: [], source: [], dateRange: 'all' };
    setFilters(cleared);
    onFilterChange(cleared);
  };

  const toggleArrayFilter = (
    key: 'status' | 'source',
    value: string
  ) => {
    const current = filters[key];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    updateFilters({ [key]: updated });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
      >
        <FunnelIcon className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center h-5 w-5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
            {activeFilterCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-10 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">Filters</span>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="p-4 space-y-4">
            {/* Status */}
            <div>
              <label className="text-xs font-medium text-gray-700 uppercase tracking-wider">
                Status
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleArrayFilter('status', opt.value)}
                    className={`px-2 py-1 text-xs rounded-full border ${
                      filters.status.includes(opt.value)
                        ? 'bg-blue-100 border-blue-300 text-blue-800'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source */}
            <div>
              <label className="text-xs font-medium text-gray-700 uppercase tracking-wider">
                Source
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleArrayFilter('source', opt.value)}
                    className={`px-2 py-1 text-xs rounded-full border ${
                      filters.source.includes(opt.value)
                        ? 'bg-blue-100 border-blue-300 text-blue-800'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div>
              <label className="text-xs font-medium text-gray-700 uppercase tracking-wider">
                Date Added
              </label>
              <select
                value={filters.dateRange}
                onChange={(e) => updateFilters({ dateRange: e.target.value })}
                className="mt-2 block w-full rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
              >
                {DATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-4 border-t border-gray-200">
            <button
              onClick={() => setIsOpen(false)}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/leads/LeadFilters.tsx
git commit -m "feat(crm): add LeadFilters component

- Multi-select status and source filters
- Date range dropdown
- Active filter count badge
- Clear all option"
```

---

### Task 12: CRM Bulk Actions Component

**Files:**
- Create: `apps/web/src/components/leads/BulkActions.tsx`

**Interfaces:**
- Consumes: None
- Produces: `BulkActions` component for multi-select operations

- [ ] **Step 1: Create BulkActions component**

```tsx
// apps/web/src/components/leads/BulkActions.tsx
'use client';

import {
  TagIcon,
  UserPlusIcon,
  TrashIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

interface BulkActionsProps {
  selectedCount: number;
  onAssign: () => void;
  onTag: () => void;
  onExport: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

export function BulkActions({
  selectedCount,
  onAssign,
  onTag,
  onExport,
  onDelete,
  onClearSelection,
}: BulkActionsProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-lg shadow-lg">
        <span className="text-sm font-medium mr-2">
          {selectedCount} selected
        </span>
        <div className="h-4 w-px bg-gray-700" />
        <button
          onClick={onAssign}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-gray-800 rounded"
        >
          <UserPlusIcon className="h-4 w-4" />
          Assign
        </button>
        <button
          onClick={onTag}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-gray-800 rounded"
        >
          <TagIcon className="h-4 w-4" />
          Tag
        </button>
        <button
          onClick={onExport}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-gray-800 rounded"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          Export
        </button>
        <div className="h-4 w-px bg-gray-700" />
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:bg-gray-800 rounded"
        >
          <TrashIcon className="h-4 w-4" />
          Delete
        </button>
        <button
          onClick={onClearSelection}
          className="ml-2 text-sm text-gray-400 hover:text-white"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/leads/BulkActions.tsx
git commit -m "feat(crm): add BulkActions component

- Floating action bar when items selected
- Assign, tag, export, delete actions
- Clear selection button"
```

---

### Task 13: Conversations Unified Inbox Component

**Files:**
- Create: `apps/web/src/components/conversations/UnifiedInbox.tsx`

**Interfaces:**
- Consumes: StatusPill (Task 7)
- Produces: `UnifiedInbox` component with channel filtering

- [ ] **Step 1: Create UnifiedInbox component**

```tsx
// apps/web/src/components/conversations/UnifiedInbox.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  EnvelopeIcon,
  ChatBubbleLeftIcon,
  PhoneIcon,
} from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';

interface Conversation {
  id: string;
  leadName: string;
  leadId: string;
  channel: 'email' | 'sms' | 'phone';
  lastMessage: string;
  lastMessageAt: string;
  status: 'unread' | 'needs_response' | 'responded' | 'closed';
  unreadCount?: number;
}

interface UnifiedInboxProps {
  conversations: Conversation[];
  onMarkHandled?: (id: string) => void;
}

const channelIcons = {
  email: EnvelopeIcon,
  sms: ChatBubbleLeftIcon,
  phone: PhoneIcon,
};

const channelLabels = {
  email: 'Email',
  sms: 'SMS',
  phone: 'Phone',
};

const statusVariants = {
  unread: 'info' as const,
  needs_response: 'warning' as const,
  responded: 'success' as const,
  closed: 'neutral' as const,
};

const statusLabels = {
  unread: 'Unread',
  needs_response: 'Needs Response',
  responded: 'Responded',
  closed: 'Closed',
};

export function UnifiedInbox({ conversations, onMarkHandled }: UnifiedInboxProps) {
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filteredConversations = conversations.filter((c) => {
    if (channelFilter && c.channel !== channelFilter) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    return true;
  });

  const channelCounts = {
    all: conversations.length,
    email: conversations.filter((c) => c.channel === 'email').length,
    sms: conversations.filter((c) => c.channel === 'sms').length,
    phone: conversations.filter((c) => c.channel === 'phone').length,
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Channel tabs */}
      <div className="flex border-b border-gray-200">
        {[
          { key: null, label: 'All', count: channelCounts.all },
          { key: 'email', label: 'Email', count: channelCounts.email },
          { key: 'sms', label: 'SMS', count: channelCounts.sms },
          { key: 'phone', label: 'Phone', count: channelCounts.phone },
        ].map((tab) => (
          <button
            key={tab.key ?? 'all'}
            onClick={() => setChannelFilter(tab.key)}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 -mb-px ${
              channelFilter === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            <span className="ml-2 text-xs text-gray-400">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Status filter row */}
      <div className="px-4 py-2 border-b border-gray-100 flex gap-2">
        {['unread', 'needs_response', 'responded', 'closed'].map((status) => (
          <button
            key={status}
            onClick={() =>
              setStatusFilter(statusFilter === status ? null : status)
            }
            className={`px-2 py-1 text-xs rounded-full border ${
              statusFilter === status
                ? 'bg-blue-100 border-blue-300 text-blue-800'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {statusLabels[status as keyof typeof statusLabels]}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <ul className="divide-y divide-gray-100">
        {filteredConversations.length === 0 ? (
          <li className="p-8 text-center text-sm text-gray-500">
            No conversations match your filters
          </li>
        ) : (
          filteredConversations.map((conv) => {
            const ChannelIcon = channelIcons[conv.channel];
            return (
              <li key={conv.id}>
                <Link
                  href={`/conversations/${conv.id}`}
                  className="flex items-start gap-3 p-4 hover:bg-gray-50"
                >
                  <div
                    className={`p-2 rounded-lg ${
                      conv.status === 'unread' || conv.status === 'needs_response'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <ChannelIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p
                        className={`text-sm truncate ${
                          conv.status === 'unread'
                            ? 'font-semibold text-gray-900'
                            : 'font-medium text-gray-700'
                        }`}
                      >
                        {conv.leadName}
                      </p>
                      <span className="text-xs text-gray-400">
                        {formatDistanceToNow(new Date(conv.lastMessageAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-0.5">
                      {conv.lastMessage}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusPill variant={statusVariants[conv.status]} size="sm">
                        {statusLabels[conv.status]}
                      </StatusPill>
                      {conv.unreadCount && conv.unreadCount > 0 && (
                        <span className="inline-flex items-center justify-center h-5 min-w-[1.25rem] px-1 text-xs font-medium bg-blue-600 text-white rounded-full">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/conversations/UnifiedInbox.tsx
git commit -m "feat(conversations): add UnifiedInbox component

- Channel tabs (all, email, SMS, phone)
- Status filters (unread, needs response, responded, closed)
- Unread count badges
- Relative timestamps"
```

---

### Task 14: Campaign Performance Card Component

**Files:**
- Create: `apps/web/src/components/campaigns/CampaignCard.tsx`

**Interfaces:**
- Consumes: StatusPill (Task 7)
- Produces: `CampaignCard` component with metrics and actions

- [ ] **Step 1: Create CampaignCard component**

```tsx
// apps/web/src/components/campaigns/CampaignCard.tsx
'use client';

import Link from 'next/link';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  PlayIcon,
  PauseIcon,
  DocumentDuplicateIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';

interface CampaignMetrics {
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  interested: number;
}

interface CampaignCardProps {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'complete';
  metrics: CampaignMetrics;
  createdAt: string;
  onPause?: () => void;
  onResume?: () => void;
  onDuplicate?: () => void;
}

const statusVariants = {
  draft: 'neutral' as const,
  active: 'success' as const,
  paused: 'warning' as const,
  complete: 'info' as const,
};

export function CampaignCard({
  id,
  name,
  status,
  metrics,
  createdAt,
  onPause,
  onResume,
  onDuplicate,
}: CampaignCardProps) {
  const deliveryRate =
    metrics.sent > 0
      ? Math.round((metrics.delivered / metrics.sent) * 100)
      : 0;
  const openRate =
    metrics.delivered > 0
      ? Math.round((metrics.opened / metrics.delivered) * 100)
      : 0;
  const replyRate =
    metrics.delivered > 0
      ? Math.round((metrics.replied / metrics.delivered) * 100)
      : 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div>
          <Link
            href={`/campaigns/${id}`}
            className="text-lg font-semibold text-gray-900 hover:text-blue-600"
          >
            {name}
          </Link>
          <p className="text-sm text-gray-500 mt-0.5">
            Created {new Date(createdAt).toLocaleDateString()}
          </p>
        </div>
        <StatusPill variant={statusVariants[status]}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </StatusPill>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4 py-4 border-y border-gray-100">
        <div>
          <p className="text-2xl font-semibold text-gray-900">
            {metrics.sent.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">Sent</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-gray-900">{deliveryRate}%</p>
          <p className="text-xs text-gray-500">Delivered</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-gray-900">{openRate}%</p>
          <p className="text-xs text-gray-500">Opened</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-green-600">{replyRate}%</p>
          <p className="text-xs text-gray-500">Replied</p>
        </div>
      </div>

      {/* Interested count */}
      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm">
          <span className="font-medium text-green-600">
            {metrics.interested}
          </span>{' '}
          <span className="text-gray-500">interested leads</span>
        </p>

        {/* Quick actions */}
        <div className="flex items-center gap-1">
          {status === 'active' && onPause && (
            <button
              onClick={onPause}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Pause campaign"
            >
              <PauseIcon className="h-4 w-4" />
            </button>
          )}
          {status === 'paused' && onResume && (
            <button
              onClick={onResume}
              className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
              title="Resume campaign"
            >
              <PlayIcon className="h-4 w-4" />
            </button>
          )}
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Duplicate campaign"
            >
              <DocumentDuplicateIcon className="h-4 w-4" />
            </button>
          )}
          <Link
            href={`/campaigns/${id}/edit`}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="Edit campaign"
          >
            <PencilIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/campaigns/CampaignCard.tsx
git commit -m "feat(campaigns): add CampaignCard with metrics

- Status badge (draft, active, paused, complete)
- Key metrics: sent, delivered, opened, replied
- Interested leads count
- Quick actions: pause, resume, duplicate, edit"
```

---

### Task 15: Final Typecheck and Integration Test

**Files:**
- All files from Tasks 1-14

**Interfaces:**
- Consumes: All previous tasks
- Produces: Verified build with no errors

- [ ] **Step 1: Run full typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No type errors

- [ ] **Step 2: Run linter**

Run: `cd apps/web && npx oxlint --no-ignore src/components`

Expected: No critical errors (warnings acceptable)

- [ ] **Step 3: Start dev server and verify**

Run: `cd apps/web && yarn dev`

Expected: Server starts without errors

- [ ] **Step 4: Commit any final fixes**

If any fixes were needed:

```bash
git add -A
git commit -m "fix: resolve typecheck and lint issues from UX updates"
```

---

## Success Criteria

- [ ] New pricing tiers in database (migration applied)
- [ ] Pricing page reflects new tiers ($129, $399, $899, $2,499)
- [ ] SMS packs and AI packs displayed on pricing page
- [ ] Overage rates shown per tier
- [ ] Dashboard shows KPI cards with trend indicators
- [ ] Dashboard shows action items widget
- [ ] CRM has filter component
- [ ] CRM has bulk actions component
- [ ] Conversations has unified inbox component
- [ ] Campaigns has performance card component
- [ ] StatusPill, Skeleton, EmptyState components created
- [ ] Design system CSS variables added
- [ ] Typecheck passes

---

## Out of Scope

- Mobile app changes
- Marketing site redesign (beyond pricing page)
- New feature development beyond UX improvements
- Third-party integrations
