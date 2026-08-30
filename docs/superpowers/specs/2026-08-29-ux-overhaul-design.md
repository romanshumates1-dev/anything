# DealFlow AI - Comprehensive UX Overhaul

**Date:** 2026-08-29
**Status:** Approved
**Scope:** 11 pages + design system + navigation

## Overview

Complete visual and UX transformation of all logged-in app pages. Design direction: Dark Premium + Sophisticated + Bold Energy (Linear meets Bloomberg Terminal meets modern fintech).

---

## Design System

### Color Palette

```css
/* Backgrounds - Dark Premium */
--bg-primary: #0F172A;      /* Deepest - sidebar, shell */
--bg-secondary: #1E293B;    /* Cards, panels */
--bg-tertiary: #334155;     /* Elevated elements */
--bg-surface: #0F172A;      /* App background */

/* Accents - Bold Energy */
--accent-blue: #3B82F6;     /* Primary actions */
--accent-blue-glow: rgba(59, 130, 246, 0.5);
--accent-purple: #8B5CF6;   /* Secondary accent */
--accent-gradient: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);

/* Semantic - Sophisticated */
--color-success: #10B981;   /* Profits, positive */
--color-success-glow: rgba(16, 185, 129, 0.5);
--color-warning: #F59E0B;   /* Costs, attention */
--color-error: #EF4444;     /* Alerts, negative */
--color-info: #06B6D4;      /* Informational */

/* Text */
--text-primary: #F8FAFC;    /* Headings, important */
--text-secondary: #94A3B8;  /* Body text */
--text-muted: #64748B;      /* Subtle, labels */

/* Borders & Overlays */
--border-subtle: rgba(255, 255, 255, 0.1);
--border-medium: rgba(255, 255, 255, 0.2);
--glass-bg: rgba(30, 41, 59, 0.8);
--glass-border: rgba(255, 255, 255, 0.1);
```

### Typography

```css
--font-sans: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;  /* Numbers, metrics */

--text-xs: 0.75rem;
--text-sm: 0.875rem;
--text-base: 1rem;
--text-lg: 1.125rem;
--text-xl: 1.25rem;
--text-2xl: 1.5rem;
--text-3xl: 1.875rem;
--text-4xl: 2.25rem;
```

### Component Patterns

**Glass Cards:**
```css
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
}
```

**Glowing Status Dots:**
```css
.status-dot-success {
  width: 8px;
  height: 8px;
  background: var(--color-success);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--color-success-glow);
}
```

**Gradient Buttons:**
```css
.btn-primary {
  background: var(--accent-gradient);
  color: white;
  border: none;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
}
.btn-primary:hover {
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.6);
  transform: translateY(-1px);
}
```

**Metric Numbers:**
- Use JetBrains Mono for all numbers
- Count-up animation on load
- Green/red color based on positive/negative

---

## Global Navigation - Sidebar

**Structure:**
```
┌─────────────────────────┐
│  🔷 DealFlow AI         │  ← Logo + brand name
│                         │
│  ▸ Dashboard            │  ← Active: blue bar + glow
│    Campaigns            │
│    Lead Finder          │
│    Contacts             │
│    Inbox                │
│    Contracts            │
│    Approvals            │
│                         │
│  ─────────────          │  ← Separator
│    Analytics            │
│    Planner              │
│    System Health        │
│    Settings             │
│                         │
│  ─────────────          │
│  [████████░░] 75%       │  ← Usage meter
│  Pro Plan               │
│                         │
│  👤 John Doe      ▾     │  ← User menu
└─────────────────────────┘
```

**Behavior:**
- Collapsed: icons only (hover shows tooltip)
- Active item: blue left border + subtle blue background
- Hover: background lighten
- Keyboard shortcut: `B` to toggle

---

## Page 1: Dashboard - Command Center

**URL:** `/dashboard`

### Layout Structure
```
┌────────────────────────────────────────────────────────────┐
│ Welcome back, John                         Aug 29, 2026    │
│ Your pipeline is looking strong today.     [Launch Campaign]│
├────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │$125,000  │ │ 847      │ │ 23.5%    │ │ 12       │       │
│ │Pipeline  │ │Active    │ │Response  │ │Deals MTD │       │
│ │+12% ▲    │ │Leads     │ │Rate      │ │$45,000   │       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐ ┌─────────────────────────────┐│
│ │ Monthly P&L             │ │ Activity Feed               ││
│ │                         │ │                             ││
│ │  $50k ┤    ╭───╮       │ │ Today                       ││
│ │       │   ╱    ╲ profit│ │ ● Deal closed - 123 Main    ││
│ │  $25k ┤  ╱      ╲      │ │ ● Contract signed - Oak Ave ││
│ │       │ ╱   spend╲     │ │ ● 50 messages sent          ││
│ │   $0  ┼─────────────   │ │                             ││
│ │       J F M A M J J A  │ │ Yesterday                   ││
│ │                         │ │ ● New lead - Pine Rd       ││
│ │ Net: +$32,450 this month│ │ ● Response from Smith      ││
│ └─────────────────────────┘ └─────────────────────────────┘│
├────────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐     │
│ │Action Items   │ │Active Campaigns│ │System Health  │     │
│ │               │ │               │ │               │     │
│ │🔴 Response    │ │Campaign A  ██▓│ │● Database  OK │     │
│ │   needed (3)  │ │Campaign B  ███│ │● AI Engine OK │     │
│ │🟡 Contracts   │ │Campaign C  █░░│ │● Queue     OK │     │
│ │   expiring (2)│ │               │ │● Auth      OK │     │
│ │🔵 Follow-ups  │ │[View All →]   │ │               │     │
│ │   due (5)     │ │               │ │All operational│     │
│ └───────────────┘ └───────────────┘ └───────────────┘     │
└────────────────────────────────────────────────────────────┘
```

### KPI Cards
- Glass card style with subtle gradient border
- Icon (outlined, 20px) + Value (JetBrains Mono, 2xl) + Label
- Sparkline in background (subtle, 20% opacity)
- Change indicator: green up arrow or red down arrow + percentage

### Monthly Profit & Credit Spend Chart
- Dual-axis area chart
- Green gradient fill for profits (revenue - costs)
- Amber/orange line for credit spend (SMS + AI costs)
- Hover tooltip shows: Date, Profit $X, Spend $X, Net $X
- Summary box below: "Net profit this month: +$X"

### Activity Feed (TopStep Style)
- Vertical timeline with colored dots by type
- Types: Deal (green), Contract (blue), Message (gray), Lead (purple), Alert (red)
- Grouped by day with sticky date headers
- Scrollable, max height 400px
- Each item: Icon + Description + Time ago

### Quick Start Cards
- Only show if user has < 5 campaigns
- 3 numbered steps with gradient numbers
- Each has CTA button

---

## Page 2: Campaigns - Mission Control

**URL:** `/campaigns`

### Layout
```
┌────────────────────────────────────────────────────────────┐
│ Campaigns                              [+ New Campaign]    │
│ Manage your outreach sequences                             │
├────────────────────────────────────────────────────────────┤
│ [All] [Active] [Paused] [Draft] [Complete]    🔍 Search    │
├────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐│
│ │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  Campaign Header Gradient     ││
│ │                                                         ││
│ │ Tax Delinquent Outreach              🟢 ACTIVE         ││
│ │ Started Aug 15 · 2,500 contacts                        ││
│ │                                                         ││
│ │ Sent      Delivered   Opened     Replied    Interested ││
│ │ 1,847     1,823       892        156        23         ││
│ │ ████████████████████░░░░░░░░░░░░░░░░░░░░  Funnel       ││
│ │                                                         ││
│ │ [Pause] [View Report] [Duplicate]              [...] ▾ ││
│ └─────────────────────────────────────────────────────────┘│
│                                                            │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Pre-Foreclosure Q3                   🟡 PAUSED         ││
│ │ ...                                                     ││
│ └─────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### Campaign Cards
- Header: gradient strip (blue→purple for active, gray for paused)
- Status badge with glow effect
- Metrics row with monospace numbers
- Horizontal funnel bar showing conversion drop-off
- Quick actions: contextual (Pause if active, Resume if paused)
- Hover: subtle lift effect

### New Campaign Button
- Gradient background
- Opens wizard or quick-launch modal

---

## Page 3: Lead Finder - Discovery Engine

**URL:** `/lead-finder`

### Layout
```
┌────────────────────────────────────────────────────────────┐
│ Lead Finder                                                │
│ Discover motivated sellers from public records             │
├──────────────────┬─────────────────────────────────────────┤
│ SOURCES          │ FILTERS           [AI Recommended ◉]   │
│                  │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│ ┌──────────────┐ │ │Tax  │ │Pre- │ │Code │ │Probate│      │
│ │ 📊 PropStream│ │ │Delin│ │Fore │ │Viol │ │      │       │
│ │ Quality: 8.5 │ │ └─────┘ └─────┘ └─────┘ └─────┘       │
│ │ $0.02/lead   │ │                                        │
│ │ [✓ Enabled]  │ │ Location: [Miami-Dade, FL      ▾]     │
│ └──────────────┘ │ Equity Min: [$50,000          ]        │
│                  │                                        │
│ ┌──────────────┐ │ [Save Preset ▾]          [Search 🔍]  │
│ │ 📋 BatchLeads│ ├────────────────────────────────────────┤
│ │ Quality: 7.8 │ │ 234 leads found              Sort: ▾  │
│ │ $0.03/lead   │ ├────────────────────────────────────────┤
│ │ [  Disabled] │ │ ┌────────┐ ┌────────┐ ┌────────┐     │
│ └──────────────┘ │ │🏠      │ │🏠      │ │🏠      │      │
│                  │ │123 Main│ │456 Oak │ │789 Pine│      │
│ ┌──────────────┐ │ │        │ │        │ │        │      │
│ │ 📁 CSV Import│ │ │Score:85│ │Score:72│ │Score:68│      │
│ │ Your lists   │ │ │Tax Del │ │PreForec│ │Probate │      │
│ │ [Upload]     │ │ │$125k eq│ │$89k eq │ │$200k eq│      │
│ └──────────────┘ │ │[+ Add] │ │[+ Add] │ │[+ Add] │      │
│                  │ └────────┘ └────────┘ └────────┘      │
└──────────────────┴─────────────────────────────────────────┘
│ ☑ 23 selected    [Add to Campaign] [Export] Est: $34.50   │
└────────────────────────────────────────────────────────────┘
```

### Source Cards (Left Panel)
- Visual cards with icon
- Quality score (1-10) with colored indicator
- Cost per lead
- Toggle switch to enable/disable
- Collapsible panel on mobile

### Filter Bar
- Pill-style toggles for distress types
- Dropdowns for location, property type
- "AI Recommended" toggle that sets optimal filters
- Save/load filter presets

### Results Grid
- Card-based, 3 columns on desktop
- Each card:
  - Map thumbnail or property type icon
  - Address (bold)
  - Lead score ring (0-100, color gradient green→yellow→red)
  - Distress badges
  - Estimated equity
  - Quick "Add to Campaign" button
- Checkbox for multi-select

### Bottom Action Bar
- Sticky at bottom
- Selected count
- Bulk actions
- Cost estimate for selected leads

---

## Page 4: Contacts - Relationship Hub

**URL:** `/contacts`

### Layout Options
- Toggle: [Kanban] [Table] [Cards]

### Kanban View (Default)
```
┌────────────────────────────────────────────────────────────┐
│ Contacts                    [+ Add Contact] [Import CSV]   │
│ 🔍 Search...    Filter: [All Stages ▾] [All Sources ▾]    │
├────────────────────────────────────────────────────────────┤
│ NEW        │ CONTACTED  │ INTERESTED │ NEGOTIATING│ CLOSED │
│ (45)       │ (128)      │ (23)       │ (8)        │ (12)   │
├────────────┼────────────┼────────────┼────────────┼────────┤
│┌──────────┐│┌──────────┐│┌──────────┐│┌──────────┐│┌──────┐│
││John Smith││Sarah Jones││Bob Wilson ││Jane Doe   ││Mike T ││
││123 Main  ││456 Oak    ││789 Pine   ││321 Elm    ││555 Br ││
││Score: 85 ││Score: 72  ││Score: 91  ││Score: 88  ││$12.5k ││
││2 days ago││5 hrs ago  ││1 day ago  ││Today      ││Closed ││
│└──────────┘│└──────────┘│└──────────┘│└──────────┘│└──────┘│
│┌──────────┐│┌──────────┐│            │            │        │
││...       ││...       ││            │            │        │
│└──────────┘│└──────────┘│            │            │        │
└────────────┴────────────┴────────────┴────────────┴────────┘
```

### Contact Cards
- Drag-and-drop between stages
- Shows: Name, Property address, Lead score, Last activity
- Click to open detail slide-over
- Color-coded top border by stage

### Table View
- Sortable columns
- Inline editing for quick updates
- Row actions on hover
- Bulk select with checkbox

---

## Page 5: Conversations / Inbox - Communication Hub

**URL:** `/inbox`

### Three-Column Layout
```
┌────────────────────────────────────────────────────────────┐
│ Inbox                                                      │
├──────────────┬─────────────────────────┬───────────────────┤
│ 🔍 Search... │                         │ Contact Details   │
│              │   John Smith            │                   │
│ [All][SMS]   │   123 Main St           │ 📍 123 Main St   │
│ [Email][Call]│                         │ 📱 (555) 123-4567│
│              │ ┌─────────────────────┐ │ 📧 john@email.com│
│ ┌──────────┐ │ │ Hi, I got your     │ │                   │
│ │●John Smith│ │ │ message about my   │ │ ─────────────────│
│ │ Got your..│ │ │ property. What's   │ │ Stage: Interested│
│ │ 2m ago   │ │ │ your offer?        │ │ Score: 85        │
│ └──────────┘ │ │           10:23 AM │ │ Value: $125,000  │
│              │ └─────────────────────┘ │                   │
│ ┌──────────┐ │         ┌─────────────┐ │ ─────────────────│
│ │ Sarah J  │ │         │ Thanks for  │ │ Timeline         │
│ │ Interested│ │         │ reaching    │ │ ● SMS sent      │
│ │ 1h ago   │ │         │ out! Based..│ │ ● Replied       │
│ └──────────┘ │         │    10:25 AM │ │ ● Stage updated │
│              │         └─────────────┘ │                   │
│ ┌──────────┐ │                         │ ─────────────────│
│ │🟡Bob W   │ │ ┌─────────────────────┐ │ Actions          │
│ │ Needs    │ │ │ Type a message...   │ │ [Create Contract]│
│ │ response │ │ └─────────────────────┘ │ [Update Stage]   │
│ └──────────┘ │ [AI Suggest] [Send →]   │ [Add Note]       │
└──────────────┴─────────────────────────┴───────────────────┘
```

### Conversation List (Left)
- Channel filter tabs
- Unread indicator (glowing blue dot)
- Status indicator (amber for needs response)
- Relative timestamps
- Search filters

### Message Thread (Center)
- Bubble layout (left = them, right = you)
- AI-generated messages marked with subtle badge
- Timestamps on hover
- "Smart Reply" suggestions (3 pills)
- Message input with send button

### Contact Panel (Right)
- Contact info card
- Deal stage selector
- Lead score
- Activity timeline
- Quick action buttons

---

## Page 6: Contracts - Document Hub

**URL:** `/contracts`

### Pipeline View
```
┌────────────────────────────────────────────────────────────┐
│ Contracts                              [+ New Contract]    │
├────────────────────────────────────────────────────────────┤
│ DRAFT (3)    SENT (5)    VIEWED (2)   SIGNED (8)  CLOSED  │
│    ↓           ↓           ↓            ↓          (12)   │
│ ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐ │
│ │ 📄   │    │ 📤   │    │ 👁️   │    │ ✍️   │    │ ✅   │ │
│ │Smith │    │Jones │    │Wilson│    │Davis │    │Brown │ │
│ │$125k │    │$89k  │    │$200k │    │$150k │    │$175k │ │
│ │      │    │2d ago│    │1d ago│    │Today │    │Closed│ │
│ └──────┘    └──────┘    └──────┘    └──────┘    └──────┘ │
│             │ ⚠️ Expires│            │            │        │
│             │  in 3 days│            │            │        │
└────────────────────────────────────────────────────────────┘
```

### Contract Cards
- Status icon + color
- Contact name
- Deal value (monospace, green)
- Expiration warning badge (amber glow)
- Click to view detail/preview

### Contract Detail Modal
- Document preview (PDF embed or image)
- E-sign status timeline
- Signature placeholders highlighted
- "Resend" and "Void" actions
- Activity log

---

## Page 7: Approvals - Decision Queue

**URL:** `/approvals`

### Layout
```
┌────────────────────────────────────────────────────────────┐
│ Approvals                              [Bulk Approve (3)]  │
│ Items requiring your review                                │
├────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 🟡 AI Response Approval                      2 min ago ││
│ │                                                         ││
│ │ Lead: John Smith (123 Main St)                         ││
│ │ Campaign: Tax Delinquent Outreach                      ││
│ │                                                         ││
│ │ Proposed message:                                       ││
│ │ ┌─────────────────────────────────────────────────────┐││
│ │ │ "Hi John, thanks for your interest! Based on the   │││
│ │ │ condition you described, I can offer $125,000..."   │││
│ │ └─────────────────────────────────────────────────────┘││
│ │                                                         ││
│ │ AI Confidence: 87%    Similar approved: 12             ││
│ │                                                         ││
│ │ [✓ Approve]  [✗ Reject]  [✎ Edit & Approve]           ││
│ └─────────────────────────────────────────────────────────┘│
│                                                            │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 🟡 Contract Value Approval                   1 hr ago  ││
│ │ ...                                                     ││
│ └─────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### Approval Cards
- Type indicator icon + color
- Context: Lead name, campaign, property
- Content preview (message, value, etc.)
- AI confidence score (if AI-generated)
- Similar approved count (builds trust)
- Three actions: Approve, Reject, Edit & Approve
- Keyboard shortcuts: Y = approve, N = reject

### Empty State
- Checkmark icon
- "All caught up! No pending approvals."

---

## Page 8: CRM Analytics - Intelligence Center

**URL:** `/analytics`

### Tab Navigation
```
[Overview] [Campaigns] [Funnel] [ROI] [Sources]
```

### Overview Tab
```
┌────────────────────────────────────────────────────────────┐
│ Analytics Overview                    Period: [Last 30d ▾] │
├────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ $45,230  │ │ 23       │ │ 4.2%     │ │ $1,965   │       │
│ │ Revenue  │ │ Deals    │ │ Conv Rate│ │ Avg Deal │       │
│ │ +18% ▲   │ │ +5 ▲     │ │ +0.8% ▲  │ │ -$200 ▼  │       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├────────────────────────────────────────────────────────────┤
│ Revenue & Spend Over Time                                  │
│ ┌─────────────────────────────────────────────────────────┐│
│ │     $50k ┤      ╭───────╮                              ││
│ │          │     ╱ Revenue╲                              ││
│ │     $25k ┤    ╱          ╲    Spend                    ││
│ │          │   ╱  ─────────────────                      ││
│ │      $0  ┼───────────────────────                      ││
│ │          W1   W2   W3   W4   W5                        ││
│ └─────────────────────────────────────────────────────────┘│
├────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────┐ ┌─────────────────────────────┐│
│ │ Conversion Funnel       │ │ Top Performing Campaigns    ││
│ │                         │ │                             ││
│ │ Contacted  ████████ 100%│ │ 1. Tax Delinquent    4.8%  ││
│ │ Responded  ███░░░░░  23%│ │ 2. Pre-Foreclosure   3.2%  ││
│ │ Interested ██░░░░░░   8%│ │ 3. Probate Q3        2.9%  ││
│ │ Contract   █░░░░░░░   3%│ │                             ││
│ │ Closed     █░░░░░░░   2%│ │                             ││
│ └─────────────────────────┘ └─────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### Charts
- Area charts with gradient fills
- Funnel chart (horizontal bars)
- Campaign comparison bar chart
- All use brand colors (blue, green, purple)

---

## Page 9: Planner - Campaign Scheduler

**URL:** `/campaigns/planner`

### Calendar View
```
┌────────────────────────────────────────────────────────────┐
│ Campaign Planner                       [+ Schedule Send]   │
│ [< Aug 2026 >]            View: [Day] [Week] [Month]      │
├────────────────────────────────────────────────────────────┤
│ MON 26    TUE 27    WED 28    THU 29    FRI 30    SAT 31  │
├──────────┼──────────┼──────────┼──────────┼──────────┼─────┤
│          │          │          │ ┌──────┐ │          │     │
│          │          │          │ │Tax DQ│ │          │     │
│          │          │          │ │500msg│ │          │     │
│          │          │          │ │9:00AM│ │          │     │
│          │          │          │ └──────┘ │          │     │
│ ┌──────┐ │          │ ┌──────┐ │          │          │     │
│ │PreFor│ │          │ │Probat│ │          │          │     │
│ │200msg│ │          │ │300msg│ │          │          │     │
│ │10:00A│ │          │ │11:00A│ │          │          │     │
│ └──────┘ │          │ └──────┘ │          │          │     │
├──────────┴──────────┴──────────┴──────────┴──────────┴─────┤
│ Daily Capacity: ████████░░ 800/1000 messages               │
│ 💡 AI Tip: Best send times for your audience: 9-11 AM     │
└────────────────────────────────────────────────────────────┘
```

### Features
- Drag-and-drop to reschedule
- Visual capacity indicator per day
- Color-coded by campaign
- AI optimal time suggestions highlighted
- Click to edit send details

---

## Page 10: System Health - Operations Center

**URL:** `/system-health`

### Layout
```
┌────────────────────────────────────────────────────────────┐
│ System Health                          Last check: 2m ago  │
│ All systems operational ✓                                  │
├────────────────────────────────────────────────────────────┤
│ SERVICE          STATUS              DESCRIPTION           │
├────────────────────────────────────────────────────────────┤
│ ● Database       ✓ Operational       Stores leads,        │
│   (Neon)                             campaigns & messages  │
│                                                            │
│ ● AI Engine      ✓ Operational       Powers message        │
│   (Claude)                           generation & analysis │
│                                                            │
│ ● SMS Gateway    ✓ Operational       Sends and receives    │
│   (AWS SNS)                          text messages         │
│                                                            │
│ ● Email Service  ✓ Operational       Handles email         │
│   (AWS SES)                          campaigns & alerts    │
│                                                            │
│ ● Job Queue      ✓ Active            Processes background  │
│                  12 jobs/min         tasks & scheduled work│
│                                                            │
│ ● Authentication ✓ Secure            Manages user logins   │
│   (Better-Auth)                      and session security  │
├────────────────────────────────────────────────────────────┤
│ Recent Incidents                                           │
│ No incidents in the last 30 days ✓                        │
└────────────────────────────────────────────────────────────┘
```

### Status Indicators
- Green glowing dot = Operational
- Amber glowing dot = Degraded (with explanation)
- Red glowing dot = Down (with incident details)
- Each service has a one-line description

### Expandable Details
- Click service row to expand
- Shows: Response time, uptime %, recent metrics
- Link to detailed logs (admin only)

---

## Page 11: Settings - Control Panel

**URL:** `/settings`

### Grouped Sections
```
┌────────────────────────────────────────────────────────────┐
│ Settings                                                   │
├────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 👤 Account                                              ││
│ │ Profile, password, notifications                        ││
│ │                                                    [→] ││
│ └─────────────────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 💳 Billing & Plan                                       ││
│ │ Pro Plan · $399/mo · Renews Sep 15                     ││
│ │ ████████░░ 75% of SMS used                        [→] ││
│ └─────────────────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 🤖 AI Configuration                                     ││
│ │ Provider: Claude · Model: Haiku 4.5                    ││
│ │                                                    [→] ││
│ └─────────────────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 🔗 Integrations                                         ││
│ │ PropStream, BatchLeads, Twilio                         ││
│ │                                                    [→] ││
│ └─────────────────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 🔑 API Keys                                             ││
│ │ 2 active keys                                          ││
│ │                                                    [→] ││
│ └─────────────────────────────────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────────┐│
│ │ 👥 Team                                                 ││
│ │ 3 members · Admin                                      ││
│ │                                                    [→] ││
│ └─────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### Section Cards
- Icon + Title + Subtitle with current state
- Usage meters where applicable
- Click to expand inline or navigate to sub-page
- Clear visual hierarchy

---

## Global Components

### Empty States
- Subtle illustration (line art style, brand colors)
- Headline: "No [items] yet"
- One-line description
- Single CTA button (gradient)

### Loading States
- Skeleton screens matching content shape
- Subtle shimmer animation (left-to-right)
- Dark skeleton on dark background

### Toast Notifications
- Slide in from top-right
- Color-coded border (green/amber/red/blue)
- Auto-dismiss with progress bar
- Action button if applicable

### Modals
- Dark overlay (80% opacity)
- Glass card style
- Smooth scale-up animation
- Focus trap for accessibility

---

## Branding Elements

### Logo Placement
- Sidebar header: Icon + "DealFlow AI" text
- Sign-in page: Large centered logo
- Loading screens: Animated logo

### Brand Voice in UI
- Headlines: Action-oriented ("Launch Campaign", "Find Leads")
- Success messages: Celebratory ("Deal closed! +$12,500")
- Empty states: Encouraging ("Ready to find your first deal?")

### Favicon & PWA
- Blue gradient icon
- PWA manifest with brand colors

---

## Implementation Priority

1. **Design System** - Dark theme CSS variables, glass card component
2. **Sidebar Navigation** - New dark nav with branding
3. **Dashboard** - Command center with charts
4. **Lead Finder** - Modern discovery interface
5. **Campaigns** - Mission control cards
6. **Inbox/Conversations** - Three-column layout
7. **Contacts** - Kanban + table views
8. **Contracts** - Pipeline visualization
9. **Analytics** - Chart dashboards
10. **Remaining pages** - Approvals, Planner, System Health, Settings

---

## Success Criteria

- [ ] All pages use dark premium theme consistently
- [ ] Glass-morphism cards throughout
- [ ] Glowing status indicators
- [ ] Gradient CTAs and accent elements
- [ ] JetBrains Mono for all numbers/metrics
- [ ] Monthly profit/spend chart on dashboard
- [ ] Activity feed (TopStep style) on dashboard
- [ ] Lead Finder with visual source cards and filter pills
- [ ] System Health with short descriptions per service
- [ ] Sidebar with usage meter and user menu
- [ ] Empty states with branded illustrations
- [ ] Loading states with dark skeletons
- [ ] Mobile responsive
- [ ] Typecheck passes
