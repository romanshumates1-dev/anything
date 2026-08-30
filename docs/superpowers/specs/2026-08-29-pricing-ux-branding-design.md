# DealFlow AI - Pricing, UX & Branding Optimization

**Date:** 2026-08-29  
**Status:** Approved  
**Effort Estimate:** 8-12 hours

## Overview

Comprehensive optimization covering value-based pricing model, UX improvements across core pages, and design system polish. Pricing restructured around customer value ($10-50K deals) rather than service costs.

---

## Phase 1: Value-Based Pricing Model

### 1.1 Subscription Tiers

| Tier | Price | SMS | Email | AI Credits | Margin |
|------|-------|-----|-------|------------|--------|
| Free | $0 | 0 | 25 | 5 | — |
| Starter | $129/mo | 100 | 500 | 250 | 98% |
| Pro | $399/mo | 300 | 2,500 | 1,500 | 98% |
| Business | $899/mo | 1,000 | 10,000 | 5,000 | 97% |
| Scale | $2,499/mo | 3,000 | 50,000 | 20,000 | 97% |

**Target Customers:**
- Free: Tire-kickers, evaluation
- Starter: New wholesalers, 0-1 deals/month
- Pro: Active wholesalers, 1-3 deals/month
- Business: Teams, 3-10 deals/month
- Scale: High-volume operations, 10+ deals/month

### 1.2 Overage/Surcharge Fees (Per Tier)

When customers exceed included limits, they pay overage rates. Higher tiers get better rates.

| Tier | SMS Overage | Email Overage | AI Credit Overage |
|------|-------------|---------------|-------------------|
| Free | N/A (hard cap) | N/A (hard cap) | N/A (hard cap) |
| Starter | 18¢/msg | 0.5¢/email | 15¢/credit |
| Pro | 15¢/msg | 0.3¢/email | 12¢/credit |
| Business | 12¢/msg | 0.2¢/email | 8¢/credit |
| Scale | 9¢/msg | 0.1¢/email | 5¢/credit |

**Notes:**
- Free tier has hard caps - must upgrade to continue
- Overage rates are higher than pack rates to incentivize buying packs
- Customers notified at 80% usage with upgrade/pack purchase prompt
- Overage billing is automatic (no service interruption)

### 1.3 SMS Packs (Add-On)

| Pack | SMS | Price | Per SMS | Margin |
|------|-----|-------|---------|--------|
| Starter | 1,000 | $149 | 14.9¢ | 90% |
| Growth | 5,000 | $599 | 11.98¢ | 87% |
| Pro | 15,000 | $1,299 | 8.66¢ | 83% |
| Volume | 50,000 | $3,499 | 7¢ | 79% |

### 1.4 AI Credit Packs (Add-On)

| Pack | Credits | Price | Per Credit | Margin |
|------|---------|-------|------------|--------|
| Starter | 500 | $49 | 9.8¢ | 98% |
| Growth | 2,500 | $149 | 5.96¢ | 97% |
| Pro | 10,000 | $449 | 4.49¢ | 96% |
| Volume | 50,000 | $1,799 | 3.6¢ | 94% |

### 1.5 Credit Costs

| Operation | Credits |
|-----------|---------|
| Lead classification | 1 |
| AI message generation | 2 |
| AI negotiation response | 5 |
| Contract analysis | 10 |
| Buyer matching | 3 |

### 1.6 Cost Verification (Triple-Verified)

| Service | Your Cost | Source |
|---------|-----------|--------|
| AWS SNS SMS (10DLC) | $0.015/msg | AWS End User Messaging |
| AWS SES Email | $0.0001/msg | AWS SES Pricing |
| Claude Haiku 4.5 | $0.002/call | Anthropic Docs |
| Claude Sonnet 5 | $0.004/call | Anthropic Docs |

---

## Phase 2: UX Optimization

### 2.1 Dashboard Page

**Current Issues:**
- Generic stats without context
- No clear next actions
- Missing deal velocity visualization

**Improvements:**
- KPI cards with trend indicators (vs last period)
- Deal pipeline funnel visualization
- "Action Items" widget (leads needing response, expiring contracts)
- Revenue forecast chart
- Recent activity feed

### 2.2 CRM/Leads Page

**Current Issues:**
- Basic table view
- Limited filtering
- No bulk actions

**Improvements:**
- Kanban view option (by stage)
- Advanced filters (status, source, value, date)
- Bulk actions (assign, tag, export, delete)
- Inline editing for quick updates
- Lead score visualization
- Quick actions on hover

### 2.3 Conversations Page

**Current Issues:**
- Separate threads hard to track
- No unified inbox
- Manual response composition

**Improvements:**
- Unified inbox (all channels)
- AI response suggestions (one-click send)
- Conversation status indicators
- Quick reply templates
- Mark as handled/needs attention
- Filter by status, channel, campaign

### 2.4 Campaigns Page

**Current Issues:**
- List view only
- Limited performance visibility
- No A/B comparison

**Improvements:**
- Campaign cards with key metrics
- Visual status indicators (draft, active, paused, complete)
- Performance sparklines
- Quick actions (pause, duplicate, edit)
- A/B test comparison view
- Launch wizard improvements

### 2.5 Lead Finder Page

**Improvements:**
- Source quality indicators (response rate history)
- Cost-per-lead estimates
- Preview before import
- Duplicate detection
- List health scoring

### 2.6 Contracts Page

**Improvements:**
- Template preview thumbnails
- Signature status timeline
- Expiration warnings
- One-click resend
- Document viewer inline

### 2.7 Settings Page

**Improvements:**
- Grouped sections with descriptions
- Onboarding checklist (if incomplete)
- Usage meters with upgrade prompts
- API key management with last-used dates

### 2.8 System Health Page

**Improvements:**
- Status dashboard (green/yellow/red)
- Job queue monitor with throughput
- Error log with grouping
- Performance trends
- One-click retry for failed jobs

---

## Phase 3: Design System & Branding

### 3.1 Color Palette

```css
/* Primary */
--color-primary-500: #1E40AF;  /* Deep blue - trust */
--color-primary-600: #1E3A8A;  /* Hover state */

/* Success/Money */
--color-success-500: #059669;  /* Emerald green */
--color-success-600: #047857;

/* Warning */
--color-warning-500: #D97706;  /* Amber */

/* Error */
--color-error-500: #DC2626;    /* Red */

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
```

### 3.2 Typography

```css
/* Font Family */
--font-sans: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;

/* Font Sizes */
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
```

### 3.3 Spacing

```css
/* Base unit: 4px */
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
```

### 3.4 Component Patterns

**Cards:**
- Background: white
- Border: 1px gray-200
- Border-radius: 8px
- Shadow: sm (0 1px 2px rgba(0,0,0,0.05))
- Padding: 24px

**Status Pills:**
- Success: bg-green-100 text-green-800
- Warning: bg-amber-100 text-amber-800
- Error: bg-red-100 text-red-800
- Info: bg-blue-100 text-blue-800
- Neutral: bg-gray-100 text-gray-800

**Buttons:**
- Primary: bg-primary-500, white text, hover:bg-primary-600
- Secondary: bg-white, gray-700 text, border gray-300
- Danger: bg-red-500, white text

**Empty States:**
- Illustration (simple, line-art style)
- Headline explaining the state
- Single primary CTA
- Optional secondary link

**Loading States:**
- Skeleton placeholders matching content shape
- Subtle pulse animation
- No spinners except for actions in progress

### 3.5 Brand Voice

**Tone:**
- Confident, not arrogant
- Action-oriented
- Numbers-forward (show ROI, deal values)
- Direct, no fluff

**CTA Examples:**
- "Launch Campaign" (not "Submit")
- "Close This Deal" (not "Update Status")
- "Start Finding Leads" (not "Go to Lead Finder")
- "Get More Credits" (not "Purchase")

**Success Messages:**
- "Campaign launched! Reaching 2,500 leads now."
- "Contract sent. You'll be notified when they sign."
- "Deal closed! $12,500 assignment fee locked in."

---

## Implementation Order

1. **Pricing Model** (2-3 hours)
   - Update migration file with new tiers
   - Update pricing page component
   - Update billing/subscribe routes

2. **Design System** (1-2 hours)
   - Create/update CSS variables
   - Update Tailwind config if needed
   - Document component patterns

3. **Dashboard UX** (2-3 hours)
   - KPI cards with trends
   - Action items widget
   - Pipeline visualization

4. **CRM/Leads UX** (2-3 hours)
   - Filters and bulk actions
   - Kanban view option
   - Inline editing

5. **Remaining Pages** (2-3 hours)
   - Conversations unified inbox
   - Campaigns performance cards
   - Settings organization

---

## Success Criteria

- [ ] New pricing tiers in database (migration applied)
- [ ] Pricing page reflects new tiers and packs
- [ ] Dashboard shows KPIs with trends and actions
- [ ] CRM has filters, bulk actions, and stage view
- [ ] Conversations has unified inbox
- [ ] Consistent color/typography across app
- [ ] Empty states have illustrations and CTAs
- [ ] Loading states use skeletons
- [ ] Typecheck passes

---

## Out of Scope

- New feature development
- Mobile app changes
- Third-party integrations
- Marketing site redesign (beyond pricing page)
