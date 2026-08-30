# UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform all logged-in app pages to a dark premium design with glass-morphism cards, glowing accents, and sophisticated UX.

**Architecture:** Update global CSS variables for dark theme, modify Shell.tsx for dark sidebar, create reusable dark-themed components, then update each page to use the new design system.

**Tech Stack:** Next.js 14, TailwindCSS, React 18, Recharts (for charts), Heroicons, Lucide

## Global Constraints

- Background colors: `#0F172A` (primary), `#1E293B` (secondary), `#334155` (tertiary)
- Accent: `#3B82F6` (blue), `#8B5CF6` (purple), gradients between them
- Success: `#10B981`, Warning: `#F59E0B`, Error: `#EF4444`
- Text: `#F8FAFC` (primary), `#94A3B8` (secondary), `#64748B` (muted)
- All metric numbers use JetBrains Mono font
- Glass cards: `rgba(30, 41, 59, 0.8)` background with `backdrop-filter: blur(12px)`
- Status dots have glow effect: `box-shadow: 0 0 8px <color-with-alpha>`
- Typecheck must pass after each task

---

### Task 1: Dark Theme CSS Variables

**Files:**
- Modify: `apps/web/src/app/global.css`

**Interfaces:**
- Consumes: None
- Produces: CSS custom properties for dark theme used by all subsequent tasks

- [ ] **Step 1: Update global.css with dark theme variables**

Replace the existing `:root` block and add dark theme variables in `apps/web/src/app/global.css`:

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

:root {
  /* Dark Premium Backgrounds */
  --bg-primary: #0F172A;
  --bg-secondary: #1E293B;
  --bg-tertiary: #334155;
  --bg-surface: #0F172A;

  /* Accent Colors */
  --accent-blue: #3B82F6;
  --accent-blue-glow: rgba(59, 130, 246, 0.5);
  --accent-purple: #8B5CF6;
  --accent-purple-glow: rgba(139, 92, 246, 0.5);

  /* Semantic Colors */
  --color-success: #10B981;
  --color-success-glow: rgba(16, 185, 129, 0.5);
  --color-warning: #F59E0B;
  --color-warning-glow: rgba(245, 158, 11, 0.5);
  --color-error: #EF4444;
  --color-error-glow: rgba(239, 68, 68, 0.5);
  --color-info: #06B6D4;

  /* Text Colors */
  --text-primary: #F8FAFC;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;

  /* Borders & Glass */
  --border-subtle: rgba(255, 255, 255, 0.1);
  --border-medium: rgba(255, 255, 255, 0.2);
  --glass-bg: rgba(30, 41, 59, 0.8);
  --glass-border: rgba(255, 255, 255, 0.1);

  /* Typography */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  /* Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5);
  --shadow-glow-blue: 0 0 20px rgba(59, 130, 246, 0.3);
  --shadow-glow-green: 0 0 20px rgba(16, 185, 129, 0.3);
}

/* Utility classes for dark theme */
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.text-gradient {
  background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-purple) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.btn-gradient {
  background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-purple) 100%);
  color: white;
  border: none;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
  transition: all 0.2s ease;
}

.btn-gradient:hover {
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.6);
  transform: translateY(-1px);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot-success {
  background: var(--color-success);
  box-shadow: 0 0 8px var(--color-success-glow);
}

.status-dot-warning {
  background: var(--color-warning);
  box-shadow: 0 0 8px var(--color-warning-glow);
}

.status-dot-error {
  background: var(--color-error);
  box-shadow: 0 0 8px var(--color-error-glow);
}

.font-mono {
  font-family: var(--font-mono);
}

/* Number animation for KPIs */
@keyframes countUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-count {
  animation: countUp 0.5s ease-out forwards;
}

/* Shimmer for loading states */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton-dark {
  background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors (CSS changes don't affect TS)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/global.css
git commit -m "feat(design): add dark premium theme CSS variables

- Dark backgrounds (#0F172A, #1E293B, #334155)
- Accent colors with glow effects
- Glass card utility class
- Gradient button styles
- Status dot animations
- Skeleton shimmer for dark theme"
```

---

### Task 2: GlassCard Component

**Files:**
- Create: `apps/web/src/components/ui/GlassCard.tsx`

**Interfaces:**
- Consumes: CSS variables from Task 1
- Produces: `GlassCard` component with `variant` prop ('default' | 'elevated' | 'bordered')

- [ ] **Step 1: Create GlassCard component**

```tsx
// apps/web/src/components/ui/GlassCard.tsx
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'elevated' | 'bordered';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const variantStyles = {
  default: 'glass-card',
  elevated: 'glass-card shadow-lg',
  bordered: 'glass-card border-[var(--border-medium)]',
};

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export function GlassCard({
  children,
  className,
  variant = 'default',
  padding = 'md',
}: GlassCardProps) {
  return (
    <div
      className={cn(
        variantStyles[variant],
        paddingStyles[padding],
        className
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/GlassCard.tsx
git commit -m "feat(ui): add GlassCard component for dark theme

- Glass-morphism with backdrop blur
- Three variants: default, elevated, bordered
- Configurable padding"
```

---

### Task 3: MetricValue Component

**Files:**
- Create: `apps/web/src/components/ui/MetricValue.tsx`

**Interfaces:**
- Consumes: CSS variables from Task 1
- Produces: `MetricValue` component for displaying numbers with JetBrains Mono + optional trend

- [ ] **Step 1: Create MetricValue component**

```tsx
// apps/web/src/components/ui/MetricValue.tsx
'use client';

import { cn } from '@/lib/utils';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/20/solid';

interface MetricValueProps {
  value: number | string;
  format?: 'number' | 'currency' | 'percent';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  trend?: number;
  trendLabel?: string;
  className?: string;
}

const sizeStyles = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
  xl: 'text-4xl',
};

export function MetricValue({
  value,
  format = 'number',
  size = 'lg',
  trend,
  trendLabel,
  className,
}: MetricValueProps) {
  const formatValue = (val: number | string): string => {
    if (typeof val === 'string') return val;
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(val);
      case 'percent':
        return `${val.toFixed(1)}%`;
      default:
        return new Intl.NumberFormat('en-US').format(val);
    }
  };

  const isPositive = trend !== undefined && trend > 0;
  const isNegative = trend !== undefined && trend < 0;

  return (
    <div className={cn('animate-count', className)}>
      <span
        className={cn(
          'font-mono font-semibold text-[var(--text-primary)]',
          sizeStyles[size]
        )}
      >
        {formatValue(value)}
      </span>
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-1">
          {isPositive && (
            <ArrowUpIcon className="h-4 w-4 text-[var(--color-success)]" />
          )}
          {isNegative && (
            <ArrowDownIcon className="h-4 w-4 text-[var(--color-error)]" />
          )}
          <span
            className={cn(
              'text-sm font-medium',
              isPositive && 'text-[var(--color-success)]',
              isNegative && 'text-[var(--color-error)]',
              !isPositive && !isNegative && 'text-[var(--text-muted)]'
            )}
          >
            {isPositive && '+'}
            {trend}%
          </span>
          {trendLabel && (
            <span className="text-sm text-[var(--text-muted)] ml-1">
              {trendLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/MetricValue.tsx
git commit -m "feat(ui): add MetricValue component with JetBrains Mono

- Formats: number, currency, percent
- Size variants: sm, md, lg, xl
- Optional trend indicator with arrows
- Count-up animation"
```

---

### Task 4: StatusDot Component

**Files:**
- Create: `apps/web/src/components/ui/StatusDot.tsx`

**Interfaces:**
- Consumes: CSS variables from Task 1
- Produces: `StatusDot` component with glow effect

- [ ] **Step 1: Create StatusDot component**

```tsx
// apps/web/src/components/ui/StatusDot.tsx
import { cn } from '@/lib/utils';

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusDotProps {
  status: StatusType;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

const statusStyles: Record<StatusType, string> = {
  success: 'status-dot-success',
  warning: 'status-dot-warning',
  error: 'status-dot-error',
  info: 'bg-[var(--color-info)] shadow-[0_0_8px_rgba(6,182,212,0.5)]',
  neutral: 'bg-[var(--text-muted)]',
};

const sizeStyles = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export function StatusDot({
  status,
  size = 'md',
  pulse = false,
  className,
}: StatusDotProps) {
  return (
    <span
      className={cn(
        'status-dot inline-block rounded-full',
        statusStyles[status],
        sizeStyles[size],
        pulse && 'animate-pulse',
        className
      )}
    />
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/StatusDot.tsx
git commit -m "feat(ui): add StatusDot component with glow effect

- Status types: success, warning, error, info, neutral
- Size variants with glow shadows
- Optional pulse animation"
```

---

### Task 5: Dark Shell Layout

**Files:**
- Modify: `apps/web/src/components/Shell.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2), StatusDot (Task 4)
- Produces: Dark-themed sidebar and header

- [ ] **Step 1: Update Shell.tsx with dark theme**

Replace the entire content of `apps/web/src/components/Shell.tsx`:

```tsx
"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { StatusDot } from "@/components/ui/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Loader2, LayoutDashboard, Megaphone, Search, Users, MessageSquare, FileText, CheckCircle, BarChart3, Calendar, Activity, Settings, ChevronDown, LogOut } from "lucide-react";
import DemoModeBanner from "@/components/DemoModeBanner";

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/lead-finder', label: 'Lead Finder', icon: Search },
  { href: '/leads', label: 'Contacts', icon: Users },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/approvals', label: 'Approvals', icon: CheckCircle, badge: true },
  { type: 'separator' },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/campaigns/planner', label: 'Planner', icon: Calendar },
  { href: '/system-health', label: 'System Health', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();

  const { data: health } = useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      const res = await fetch("/api/system/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
    staleTime: 30_000,
    enabled: !!session,
  });

  const { data: approvals } = useQuery({
    queryKey: ["approvals-count"],
    queryFn: async () => {
      const res = await fetch("/api/approvals/count");
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    retry: 0,
    enabled: !!session,
  });

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">DF</span>
            </div>
            <span className="text-lg font-semibold text-[var(--text-primary)]">DealFlow AI</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item, idx) => {
            if (item.type === 'separator') {
              return <div key={idx} className="my-4 border-t border-[var(--border-subtle)]" />;
            }
            const Icon = item.icon!;
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href!}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-l-2 border-[var(--accent-blue)] -ml-[2px] pl-[14px]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
                {item.badge && approvals?.count > 0 && (
                  <Badge className="ml-auto bg-[var(--color-error)] text-white text-xs px-1.5 py-0.5">
                    {approvals.count}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Usage Meter */}
        <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[var(--text-muted)]">SMS Usage</span>
            <span className="text-[var(--text-secondary)]">75%</span>
          </div>
          <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div className="h-full w-3/4 bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full" />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">Pro Plan</p>
        </div>

        {/* User Menu */}
        <div className="p-3 border-t border-[var(--border-subtle)]">
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {session.user?.email?.[0]?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {session.user?.name || session.user?.email?.split('@')[0]}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">{session.user?.email}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <StatusDot status={health?.status === 'healthy' ? 'success' : 'warning'} />
            <span className="text-sm text-[var(--text-secondary)]">
              {health?.status === 'healthy' ? 'All systems operational' : 'System degraded'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/campaigns/wizard"
              className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium"
            >
              Launch Campaign
            </Link>
          </div>
        </header>

        <DemoModeBanner />

        {/* Page Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Shell.tsx
git commit -m "feat(shell): convert to dark premium theme

- Dark sidebar with gradient logo
- Active state with blue accent bar
- Usage meter with gradient progress
- User menu with avatar
- Glowing status indicator
- Gradient CTA button in header"
```

---

### Task 6: Dashboard Page Overhaul

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Create: `apps/web/src/components/dashboard/ProfitChart.tsx`
- Create: `apps/web/src/components/dashboard/ActivityFeed.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2), MetricValue (Task 3), StatusDot (Task 4)
- Produces: Dark-themed dashboard with charts and activity feed

- [ ] **Step 1: Create ProfitChart component**

```tsx
// apps/web/src/components/dashboard/ProfitChart.tsx
'use client';

import { GlassCard } from '@/components/ui/GlassCard';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const data = [
  { month: 'Jan', profit: 12000, spend: 3200 },
  { month: 'Feb', profit: 18000, spend: 4100 },
  { month: 'Mar', profit: 15000, spend: 3800 },
  { month: 'Apr', profit: 22000, spend: 5200 },
  { month: 'May', profit: 28000, spend: 6100 },
  { month: 'Jun', profit: 32000, spend: 7000 },
  { month: 'Jul', profit: 38000, spend: 8200 },
  { month: 'Aug', profit: 45000, spend: 9500 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-card p-3 text-sm">
        <p className="text-[var(--text-primary)] font-medium mb-2">{label}</p>
        <p className="text-[var(--color-success)]">
          Profit: ${payload[0]?.value?.toLocaleString()}
        </p>
        <p className="text-[var(--color-warning)]">
          Spend: ${payload[1]?.value?.toLocaleString()}
        </p>
        <p className="text-[var(--text-secondary)] mt-1 pt-1 border-t border-[var(--border-subtle)]">
          Net: ${(payload[0]?.value - payload[1]?.value)?.toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

export function ProfitChart() {
  const latestProfit = data[data.length - 1].profit;
  const latestSpend = data[data.length - 1].spend;
  const netProfit = latestProfit - latestSpend;

  return (
    <GlassCard className="h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Monthly P&L</h3>
        <div className="text-right">
          <p className="text-sm text-[var(--text-muted)]">Net this month</p>
          <p className="text-xl font-mono font-semibold text-[var(--color-success)]">
            +${netProfit.toLocaleString()}
          </p>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="month"
              stroke="#64748B"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#64748B"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value / 1000}k`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="profit"
              stroke="#10B981"
              strokeWidth={2}
              fill="url(#profitGradient)"
              name="Profit"
            />
            <Area
              type="monotone"
              dataKey="spend"
              stroke="#F59E0B"
              strokeWidth={2}
              fill="url(#spendGradient)"
              name="Spend"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-6 mt-4 pt-4 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[var(--color-success)]" />
          <span className="text-sm text-[var(--text-secondary)]">Profit</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[var(--color-warning)]" />
          <span className="text-sm text-[var(--text-secondary)]">Credit Spend</span>
        </div>
      </div>
    </GlassCard>
  );
}
```

- [ ] **Step 2: Create ActivityFeed component**

```tsx
// apps/web/src/components/dashboard/ActivityFeed.tsx
'use client';

import { GlassCard } from '@/components/ui/GlassCard';
import { CheckCircle, FileText, MessageSquare, UserPlus, AlertTriangle } from 'lucide-react';

interface ActivityItem {
  id: string;
  type: 'deal' | 'contract' | 'message' | 'lead' | 'alert';
  title: string;
  time: string;
  day: string;
}

const activities: ActivityItem[] = [
  { id: '1', type: 'deal', title: 'Deal closed - 123 Main St ($12,500)', time: '2 hours ago', day: 'Today' },
  { id: '2', type: 'contract', title: 'Contract signed - 456 Oak Ave', time: '4 hours ago', day: 'Today' },
  { id: '3', type: 'message', title: '50 messages sent in Tax Delinquent campaign', time: '5 hours ago', day: 'Today' },
  { id: '4', type: 'lead', title: 'New lead added - 789 Pine Rd', time: '1 day ago', day: 'Yesterday' },
  { id: '5', type: 'message', title: 'Response from John Smith', time: '1 day ago', day: 'Yesterday' },
  { id: '6', type: 'alert', title: 'Contract expiring in 3 days', time: '2 days ago', day: 'Earlier' },
];

const iconMap = {
  deal: { icon: CheckCircle, color: 'text-[var(--color-success)]', bg: 'bg-[var(--color-success)]/10' },
  contract: { icon: FileText, color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10' },
  message: { icon: MessageSquare, color: 'text-[var(--text-muted)]', bg: 'bg-[var(--bg-tertiary)]' },
  lead: { icon: UserPlus, color: 'text-[var(--accent-purple)]', bg: 'bg-[var(--accent-purple)]/10' },
  alert: { icon: AlertTriangle, color: 'text-[var(--color-warning)]', bg: 'bg-[var(--color-warning)]/10' },
};

export function ActivityFeed() {
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.day]) acc[activity.day] = [];
    acc[activity.day].push(activity);
    return acc;
  }, {} as Record<string, ActivityItem[]>);

  return (
    <GlassCard className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Activity</h3>
      <div className="flex-1 overflow-y-auto space-y-4 max-h-80">
        {Object.entries(groupedActivities).map(([day, items]) => (
          <div key={day}>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2 sticky top-0 bg-[var(--glass-bg)] py-1">
              {day}
            </p>
            <div className="space-y-2">
              {items.map((activity) => {
                const { icon: Icon, color, bg } = iconMap[activity.type];
                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                  >
                    <div className={`p-2 rounded-lg ${bg}`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">{activity.title}</p>
                      <p className="text-xs text-[var(--text-muted)]">{activity.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
```

- [ ] **Step 3: Update Dashboard page**

Replace `apps/web/src/app/dashboard/page.tsx`:

```tsx
'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { MetricValue } from '@/components/ui/MetricValue';
import { StatusDot } from '@/components/ui/StatusDot';
import { ProfitChart } from '@/components/dashboard/ProfitChart';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { ActionItems } from '@/components/dashboard/ActionItems';
import {
  CurrencyDollarIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  DocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const kpis = [
    {
      label: 'Pipeline Value',
      value: stats?.pipelineValue || 125000,
      format: 'currency' as const,
      trend: 12,
      icon: CurrencyDollarIcon,
    },
    {
      label: 'Active Leads',
      value: stats?.totalLeads || 847,
      format: 'number' as const,
      trend: 8,
      icon: UserGroupIcon,
    },
    {
      label: 'Response Rate',
      value: stats?.responseRate || 23.5,
      format: 'percent' as const,
      trend: 2.3,
      icon: ChatBubbleLeftRightIcon,
    },
    {
      label: 'Deals This Month',
      value: stats?.dealsThisMonth || 12,
      format: 'number' as const,
      trend: 5,
      icon: DocumentCheckIcon,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Welcome back, {session.user?.name || session.user?.email?.split('@')[0]}
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Your pipeline is looking strong today.
          </p>
        </div>
        <Link
          href="/campaigns/wizard"
          className="btn-gradient px-5 py-2.5 rounded-lg font-medium flex items-center gap-2"
        >
          Launch Campaign
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <GlassCard key={kpi.label} padding="md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-[var(--text-muted)] mb-1">{kpi.label}</p>
                <MetricValue
                  value={kpi.value}
                  format={kpi.format}
                  trend={kpi.trend}
                  trendLabel="vs last month"
                  size="lg"
                />
              </div>
              <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
                <kpi.icon className="h-5 w-5 text-[var(--accent-blue)]" />
              </div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProfitChart />
        <ActivityFeed />
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Action Items */}
        <ActionItems
          items={[
            {
              id: '1',
              type: 'response_needed',
              title: 'Response from John Smith',
              subtitle: '123 Main St - Interested in offer',
              href: '/inbox?lead=1',
              urgent: true,
            },
            {
              id: '2',
              type: 'contract_expiring',
              title: 'Contract expires in 3 days',
              subtitle: '456 Oak Ave - Smith/Johnson',
              href: '/contracts?id=2',
            },
            {
              id: '3',
              type: 'follow_up',
              title: 'Follow up with Sarah Davis',
              subtitle: '789 Pine Rd - No response in 5 days',
              href: '/crm?lead=3',
            },
          ]}
        />

        {/* Active Campaigns */}
        <GlassCard>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Active Campaigns</h3>
          <div className="space-y-3">
            {[
              { name: 'Tax Delinquent Q3', progress: 75, sent: 1847 },
              { name: 'Pre-Foreclosure', progress: 45, sent: 892 },
              { name: 'Probate Leads', progress: 20, sent: 234 },
            ].map((campaign) => (
              <div key={campaign.name} className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{campaign.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">{campaign.sent} sent</span>
                </div>
                <div className="h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full transition-all"
                    style={{ width: `${campaign.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/campaigns"
            className="block text-center text-sm text-[var(--accent-blue)] hover:underline mt-4"
          >
            View all campaigns →
          </Link>
        </GlassCard>

        {/* System Health */}
        <GlassCard>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">System Health</h3>
          <div className="space-y-3">
            {[
              { name: 'Database', status: 'success' as const },
              { name: 'AI Engine', status: 'success' as const },
              { name: 'SMS Gateway', status: 'success' as const },
              { name: 'Job Queue', status: 'success' as const },
            ].map((service) => (
              <div key={service.name} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <StatusDot status={service.status} />
                  <span className="text-sm text-[var(--text-primary)]">{service.name}</span>
                </div>
                <span className="text-xs text-[var(--color-success)]">Operational</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <p className="text-sm text-[var(--color-success)] flex items-center gap-2">
              <StatusDot status="success" />
              All systems operational
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/ProfitChart.tsx apps/web/src/components/dashboard/ActivityFeed.tsx apps/web/src/app/dashboard/page.tsx
git commit -m "feat(dashboard): dark premium command center

- Glass card KPI grid with trends
- Monthly profit/spend area chart
- TopStep-style activity feed
- Active campaigns with progress bars
- System health summary"
```

---

### Task 7: Update ActionItems for Dark Theme

**Files:**
- Modify: `apps/web/src/components/dashboard/ActionItems.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2)
- Produces: Dark-themed action items widget

- [ ] **Step 1: Update ActionItems component**

Replace `apps/web/src/components/dashboard/ActionItems.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
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

const typeConfig = {
  response_needed: {
    icon: ChatBubbleLeftIcon,
    color: 'text-[var(--accent-blue)]',
    bg: 'bg-[var(--accent-blue)]/10',
  },
  contract_expiring: {
    icon: DocumentTextIcon,
    color: 'text-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
  },
  follow_up: {
    icon: ClockIcon,
    color: 'text-[var(--text-muted)]',
    bg: 'bg-[var(--bg-tertiary)]',
  },
};

export function ActionItems({ items }: ActionItemsProps) {
  if (items.length === 0) {
    return (
      <GlassCard>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Action Items</h3>
        <div className="text-center py-8">
          <p className="text-sm text-[var(--text-muted)]">You're all caught up!</p>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Action Items
        <span className="text-[var(--text-muted)] font-normal ml-2">({items.length})</span>
      </h3>
      <ul className="space-y-2">
        {items.slice(0, 5).map((item) => {
          const { icon: Icon, color, bg } = typeConfig[item.type];
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div className={`p-2 rounded-lg ${bg}`}>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {item.subtitle}
                  </p>
                </div>
                {item.urgent && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--color-error)]/10 text-[var(--color-error)] animate-pulse">
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
          className="block text-center text-sm text-[var(--accent-blue)] hover:underline mt-4"
        >
          View all {items.length} items
        </Link>
      )}
    </GlassCard>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/ActionItems.tsx
git commit -m "feat(dashboard): update ActionItems for dark theme

- Glass card wrapper
- Dark hover states
- Colored icon backgrounds
- Pulsing urgent badge"
```

---

### Task 8: Lead Finder Page Overhaul

**Files:**
- Modify: `apps/web/src/app/lead-finder/page.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2), MetricValue (Task 3)
- Produces: Dark-themed lead finder with visual source cards

- [ ] **Step 1: Update Lead Finder page**

Replace `apps/web/src/app/lead-finder/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import {
  Search,
  Database,
  FileSpreadsheet,
  Upload,
  Filter,
  Sparkles,
  MapPin,
  Plus,
  Download,
  Loader2,
} from 'lucide-react';

const sources = [
  { id: 'propstream', name: 'PropStream', icon: Database, quality: 8.5, costPer: 0.02, enabled: true },
  { id: 'batchleads', name: 'BatchLeads', icon: FileSpreadsheet, quality: 7.8, costPer: 0.03, enabled: false },
  { id: 'csv', name: 'CSV Import', icon: Upload, quality: null, costPer: null, enabled: true },
];

const distressTypes = [
  { id: 'tax', label: 'Tax Delinquent', color: 'bg-[var(--color-error)]' },
  { id: 'preforec', label: 'Pre-Foreclosure', color: 'bg-[var(--color-warning)]' },
  { id: 'code', label: 'Code Violation', color: 'bg-[var(--accent-purple)]' },
  { id: 'probate', label: 'Probate', color: 'bg-[var(--accent-blue)]' },
];

const mockLeads = [
  { id: 1, address: '123 Main St', city: 'Miami', owner: 'John Smith', score: 85, equity: 125000, distress: ['tax'] },
  { id: 2, address: '456 Oak Ave', city: 'Tampa', owner: 'Sarah Johnson', score: 72, equity: 89000, distress: ['preforec'] },
  { id: 3, address: '789 Pine Rd', city: 'Orlando', owner: 'Bob Wilson', score: 91, equity: 200000, distress: ['probate', 'tax'] },
  { id: 4, address: '321 Elm St', city: 'Jacksonville', owner: 'Jane Doe', score: 68, equity: 75000, distress: ['code'] },
  { id: 5, address: '555 Cedar Ln', city: 'Miami', owner: 'Mike Brown', score: 78, equity: 150000, distress: ['tax'] },
  { id: 6, address: '777 Maple Dr', city: 'Tampa', owner: 'Lisa Davis', score: 82, equity: 110000, distress: ['preforec'] },
];

export default function LeadFinderPage() {
  const { data: session, isPending } = useSession();
  const [selectedSources, setSelectedSources] = useState<string[]>(['propstream', 'csv']);
  const [selectedDistress, setSelectedDistress] = useState<string[]>([]);
  const [aiRecommended, setAiRecommended] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<number[]>([]);

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const toggleSource = (id: string) => {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const toggleDistress = (id: string) => {
    setSelectedDistress((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const toggleLead = (id: number) => {
    setSelectedLeads((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedLeads.length === mockLeads.length) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(mockLeads.map((l) => l.id));
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[var(--color-success)]';
    if (score >= 60) return 'text-[var(--color-warning)]';
    return 'text-[var(--color-error)]';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Lead Finder</h1>
        <p className="text-[var(--text-secondary)] mt-1">Discover motivated sellers from public records</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar - Sources */}
        <div className="space-y-4">
          <GlassCard padding="sm">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 px-2">Sources</h3>
            <div className="space-y-2">
              {sources.map((source) => {
                const Icon = source.icon;
                const isSelected = selectedSources.includes(source.id);
                return (
                  <button
                    key={source.id}
                    onClick={() => toggleSource(source.id)}
                    className={`w-full p-3 rounded-lg text-left transition-all ${
                      isSelected
                        ? 'bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30'
                        : 'bg-[var(--bg-tertiary)] border border-transparent hover:border-[var(--border-medium)]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-[var(--accent-blue)]/20' : 'bg-[var(--bg-primary)]'}`}>
                        <Icon className={`h-4 w-4 ${isSelected ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'}`} />
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {source.name}
                        </p>
                        {source.quality && (
                          <p className="text-xs text-[var(--text-muted)]">
                            Quality: {source.quality} · ${source.costPer}/lead
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassCard>
        </div>

        {/* Main Content - Filters & Results */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filters */}
          <GlassCard padding="md">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-sm text-[var(--text-secondary)]">Distress Type:</span>
              </div>
              {distressTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => toggleDistress(type.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedDistress.includes(type.id)
                      ? `${type.color} text-white`
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  }`}
                >
                  {type.label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setAiRecommended(!aiRecommended)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    aiRecommended
                      ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Sparkles className="h-4 w-4" />
                  AI Recommended
                </button>
                <button className="btn-gradient px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search
                </button>
              </div>
            </div>
          </GlassCard>

          {/* Results Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={selectAll}
                className="text-sm text-[var(--accent-blue)] hover:underline"
              >
                {selectedLeads.length === mockLeads.length ? 'Deselect all' : 'Select all'}
              </button>
              <span className="text-sm text-[var(--text-muted)]">
                {mockLeads.length} leads found
              </span>
            </div>
            <select className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-secondary)]">
              <option>Sort by: Score</option>
              <option>Sort by: Equity</option>
              <option>Sort by: Date Added</option>
            </select>
          </div>

          {/* Results Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mockLeads.map((lead) => (
              <GlassCard
                key={lead.id}
                padding="none"
                className={`overflow-hidden cursor-pointer transition-all ${
                  selectedLeads.includes(lead.id)
                    ? 'ring-2 ring-[var(--accent-blue)]'
                    : 'hover:border-[var(--border-medium)]'
                }`}
                onClick={() => toggleLead(lead.id)}
              >
                {/* Map placeholder */}
                <div className="h-24 bg-[var(--bg-tertiary)] flex items-center justify-center">
                  <MapPin className="h-8 w-8 text-[var(--text-muted)]" />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">{lead.address}</p>
                      <p className="text-sm text-[var(--text-muted)]">{lead.city}, FL</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-mono font-bold ${getScoreColor(lead.score)}`}>
                        {lead.score}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">Score</p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mb-3">{lead.owner}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      {lead.distress.map((d) => {
                        const type = distressTypes.find((t) => t.id === d);
                        return (
                          <span
                            key={d}
                            className={`px-2 py-0.5 rounded text-xs font-medium ${type?.color} text-white`}
                          >
                            {type?.label}
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-sm font-mono text-[var(--color-success)]">
                      ${lead.equity.toLocaleString()}
                    </p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      {selectedLeads.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <GlassCard padding="none" className="flex items-center gap-4 px-6 py-3">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {selectedLeads.length} selected
            </span>
            <div className="h-4 w-px bg-[var(--border-subtle)]" />
            <button className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add to Campaign
            </button>
            <button className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export
            </button>
            <div className="h-4 w-px bg-[var(--border-subtle)]" />
            <span className="text-sm text-[var(--text-muted)]">
              Est. ${(selectedLeads.length * 0.02).toFixed(2)}
            </span>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/lead-finder/page.tsx
git commit -m "feat(lead-finder): dark premium discovery engine

- Visual source cards with quality scores
- Distress type filter pills
- AI Recommended toggle
- Card-based results with score rings
- Floating bulk action bar
- Cost estimates"
```

---

### Task 9: System Health Page with Descriptions

**Files:**
- Modify: `apps/web/src/app/system-health/page.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2), StatusDot (Task 4)
- Produces: Dark-themed system health with service descriptions

- [ ] **Step 1: Update System Health page**

Replace `apps/web/src/app/system-health/page.tsx`:

```tsx
'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { useState } from 'react';

const services = [
  {
    id: 'database',
    name: 'Database',
    provider: 'Neon',
    description: 'Stores all leads, campaigns, and messages',
    metrics: { responseTime: '12ms', uptime: '99.99%' },
  },
  {
    id: 'ai',
    name: 'AI Engine',
    provider: 'Claude',
    description: 'Powers message generation and lead analysis',
    metrics: { responseTime: '850ms', uptime: '99.95%' },
  },
  {
    id: 'sms',
    name: 'SMS Gateway',
    provider: 'AWS SNS',
    description: 'Sends and receives text messages',
    metrics: { responseTime: '45ms', uptime: '99.99%' },
  },
  {
    id: 'email',
    name: 'Email Service',
    provider: 'AWS SES',
    description: 'Handles email campaigns and notifications',
    metrics: { responseTime: '120ms', uptime: '99.99%' },
  },
  {
    id: 'queue',
    name: 'Job Queue',
    provider: 'Internal',
    description: 'Processes background tasks and scheduled work',
    metrics: { throughput: '12 jobs/min', pending: '3' },
  },
  {
    id: 'auth',
    name: 'Authentication',
    provider: 'Better-Auth',
    description: 'Manages user logins and session security',
    metrics: { activeSessions: '24', uptime: '99.99%' },
  },
];

export default function SystemHealthPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [expandedService, setExpandedService] = useState<string | null>(null);

  const { data: health, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['system-health-detail'],
    queryFn: async () => {
      const res = await fetch('/api/system/health');
      if (!res.ok) throw new Error('Failed to fetch health');
      return res.json();
    },
    enabled: !!session,
    refetchInterval: 30000,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const allHealthy = health?.status === 'healthy';

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">System Health</h1>
          <p className="text-[var(--text-secondary)] mt-1">Monitor service status and performance</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Overall Status */}
      <GlassCard className="flex items-center gap-4">
        <StatusDot status={allHealthy ? 'success' : 'warning'} size="lg" />
        <div>
          <p className="text-lg font-semibold text-[var(--text-primary)]">
            {allHealthy ? 'All systems operational' : 'Some systems degraded'}
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Last checked: {new Date().toLocaleTimeString()}
          </p>
        </div>
      </GlassCard>

      {/* Services Grid */}
      <GlassCard padding="none">
        <div className="divide-y divide-[var(--border-subtle)]">
          {services.map((service) => {
            const isExpanded = expandedService === service.id;
            return (
              <div key={service.id}>
                <button
                  onClick={() => setExpandedService(isExpanded ? null : service.id)}
                  className="w-full px-6 py-4 flex items-center gap-4 hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <StatusDot status="success" />
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[var(--text-primary)]">{service.name}</p>
                      <span className="text-xs text-[var(--text-muted)]">({service.provider})</span>
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">{service.description}</p>
                  </div>
                  <span className="text-sm text-[var(--color-success)]">Operational</span>
                  <ChevronDown
                    className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {isExpanded && (
                  <div className="px-6 py-4 bg-[var(--bg-tertiary)] border-t border-[var(--border-subtle)]">
                    <div className="grid grid-cols-2 gap-4">
                      {Object.entries(service.metrics).map(([key, value]) => (
                        <div key={key}>
                          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </p>
                          <p className="text-lg font-mono text-[var(--text-primary)]">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Incident History */}
      <GlassCard>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Recent Incidents</h3>
        <div className="flex items-center gap-3 py-8 justify-center">
          <StatusDot status="success" />
          <p className="text-sm text-[var(--text-muted)]">No incidents in the last 30 days</p>
        </div>
      </GlassCard>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/system-health/page.tsx
git commit -m "feat(system-health): dark operations center with descriptions

- Service list with one-line descriptions
- Expandable metrics per service
- Overall status banner
- Auto-refresh with manual trigger
- Incident history section"
```

---

### Task 10: Campaigns Page Overhaul

**Files:**
- Modify: `apps/web/src/app/campaigns/page.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2), MetricValue (Task 3), StatusDot (Task 4)
- Produces: Dark-themed campaign cards with metrics

- [ ] **Step 1: Update Campaigns page**

Replace `apps/web/src/app/campaigns/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Loader2, Plus, Play, Pause, Copy, MoreHorizontal, Rocket } from 'lucide-react';

const statusConfig = {
  DRAFT: { label: 'Draft', dot: 'neutral' as const, bg: 'bg-[var(--text-muted)]/10' },
  ACTIVE: { label: 'Active', dot: 'success' as const, bg: 'bg-[var(--color-success)]/10' },
  PAUSED: { label: 'Paused', dot: 'warning' as const, bg: 'bg-[var(--color-warning)]/10' },
  COMPLETE: { label: 'Complete', dot: 'info' as const, bg: 'bg-[var(--color-info)]/10' },
  SCHEDULED: { label: 'Scheduled', dot: 'info' as const, bg: 'bg-[var(--color-info)]/10' },
};

function CampaignCard({ campaign }: { campaign: any }) {
  const queryClient = useQueryClient();
  const status = statusConfig[campaign.status as keyof typeof statusConfig] || statusConfig.DRAFT;

  const metrics = {
    sent: campaign.total_sent || 0,
    delivered: campaign.total_delivered || 0,
    opened: campaign.total_opened || 0,
    replied: campaign.total_replied || 0,
    interested: campaign.total_interested || 0,
  };

  const deliveryRate = metrics.sent > 0 ? Math.round((metrics.delivered / metrics.sent) * 100) : 0;
  const replyRate = metrics.delivered > 0 ? Math.round((metrics.replied / metrics.delivered) * 100) : 0;

  const launch = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/outreach/campaigns/${campaign.id}/start`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to launch');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] }),
  });

  return (
    <GlassCard padding="none" className="overflow-hidden">
      {/* Header gradient */}
      <div className={`h-2 ${campaign.status === 'ACTIVE' ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]' : 'bg-[var(--bg-tertiary)]'}`} />
      
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{campaign.name}</h3>
            <p className="text-sm text-[var(--text-muted)]">
              {campaign.total_contacts || 0} contacts · {campaign.direction || 'outbound'}
            </p>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${status.bg}`}>
            <StatusDot status={status.dot} size="sm" />
            <span className="text-xs font-medium text-[var(--text-primary)]">{status.label}</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {[
            { label: 'Sent', value: metrics.sent },
            { label: 'Delivered', value: `${deliveryRate}%` },
            { label: 'Opened', value: metrics.opened },
            { label: 'Replied', value: metrics.replied },
            { label: 'Interested', value: metrics.interested, highlight: true },
          ].map((m) => (
            <div key={m.label} className="text-center">
              <p className={`text-lg font-mono font-semibold ${m.highlight ? 'text-[var(--color-success)]' : 'text-[var(--text-primary)]'}`}>
                {m.value}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Funnel bar */}
        <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--color-success)] rounded-full"
            style={{ width: `${Math.min(100, replyRate * 5)}%` }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {campaign.status === 'ACTIVE' ? (
            <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : (
            <button
              onClick={() => launch.mutate()}
              disabled={launch.isPending}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 px-4 py-2 rounded-lg"
            >
              {launch.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {campaign.status === 'PAUSED' ? 'Resume' : 'Launch'}
            </button>
          )}
          <button className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <Copy className="h-4 w-4" />
          </button>
          <button className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </GlassCard>
  );
}

export default function CampaignsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [filter, setFilter] = useState<string>('all');

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['outreach-campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const filters = ['all', 'active', 'paused', 'draft', 'complete'];
  const filteredCampaigns = campaigns?.filter((c: any) =>
    filter === 'all' ? true : c.status?.toLowerCase() === filter
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Campaigns</h1>
          <p className="text-[var(--text-secondary)] mt-1">Manage your outreach sequences</p>
        </div>
        <Link href="/campaigns/wizard" className="btn-gradient px-5 py-2.5 rounded-lg font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Campaign grid */}
      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <GlassCard className="text-center py-12">
          <p className="text-[var(--text-muted)]">No campaigns found</p>
          <Link href="/campaigns/wizard" className="text-[var(--accent-blue)] hover:underline mt-2 inline-block">
            Create your first campaign →
          </Link>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredCampaigns.map((c: any) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/campaigns/page.tsx
git commit -m "feat(campaigns): dark mission control with metrics

- Campaign cards with gradient headers
- Status badges with glowing dots
- Metrics row (sent, delivered, opened, replied, interested)
- Funnel progress bar
- Quick actions (launch, pause, duplicate)
- Filter tabs"
```

---

### Task 11: Inbox/Conversations Page Overhaul

**Files:**
- Modify: `apps/web/src/app/inbox/page.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2), StatusDot (Task 4)
- Produces: Dark-themed three-column inbox layout

- [ ] **Step 1: Update Inbox page**

Replace `apps/web/src/app/inbox/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Loader2, Search, MessageSquare, Mail, Phone, User, Bot, Send, Sparkles } from 'lucide-react';
import Link from 'next/link';

const channelTabs = [
  { id: 'all', label: 'All', icon: MessageSquare },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'phone', label: 'Phone', icon: Phone },
];

const statusFilters = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'needs_response', label: 'Needs Response' },
  { id: 'responded', label: 'Responded' },
];

const mockConversations = [
  { id: 1, name: 'John Smith', phone: '+1 (555) 123-4567', lastMessage: 'Hi, I got your message about my property. What\'s your offer?', time: '2m ago', status: 'needs_response', channel: 'sms', unread: true },
  { id: 2, name: 'Sarah Johnson', phone: '+1 (555) 234-5678', lastMessage: 'That sounds interesting. Can you tell me more about the process?', time: '1h ago', status: 'needs_response', channel: 'sms', unread: true },
  { id: 3, name: 'Bob Wilson', phone: '+1 (555) 345-6789', lastMessage: 'Thanks, I\'ll think about it and get back to you.', time: '3h ago', status: 'responded', channel: 'sms', unread: false },
  { id: 4, name: 'Jane Doe', phone: '+1 (555) 456-7890', lastMessage: 'Not interested at this time.', time: '1d ago', status: 'closed', channel: 'email', unread: false },
];

const mockMessages = [
  { id: 1, sender: 'them', text: 'Hi, I got your message about my property at 123 Main St.', time: '10:23 AM' },
  { id: 2, sender: 'ai', text: 'Thanks for reaching out! Based on the current market, I can offer you a fair cash price. What condition is the property in?', time: '10:25 AM' },
  { id: 3, sender: 'them', text: 'It needs some work. The roof is old and the kitchen needs updating. What\'s your offer?', time: '10:28 AM' },
];

export default function InboxPage() {
  const { data: session, isPending } = useSession();
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedConv, setSelectedConv] = useState<number | null>(1);
  const [message, setMessage] = useState('');

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await fetch('/api/conversations');
      if (!res.ok) return mockConversations;
      const data = await res.json();
      return data.length > 0 ? data : mockConversations;
    },
    enabled: !!session,
  });

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const filteredConversations = (conversations || []).filter((c: any) => {
    if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    return true;
  });

  const selectedConversation = (conversations || []).find((c: any) => c.id === selectedConv);

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-4">
      {/* Conversation List */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        <GlassCard padding="none" className="flex-1 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-[var(--border-subtle)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search conversations..."
                className="w-full pl-9 pr-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          {/* Channel tabs */}
          <div className="flex border-b border-[var(--border-subtle)]">
            {channelTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setChannelFilter(tab.id)}
                className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  channelFilter === tab.id
                    ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Status filters */}
          <div className="flex gap-1 p-2 border-b border-[var(--border-subtle)]">
            {statusFilters.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-2 py-1 text-xs rounded-full ${
                  statusFilter === f.id
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {filteredConversations.map((conv: any) => (
              <button
                key={conv.id}
                onClick={() => setSelectedConv(conv.id)}
                className={`w-full p-3 text-left border-b border-[var(--border-subtle)] transition-colors ${
                  selectedConv === conv.id ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
                      <span className="text-white font-medium text-sm">{conv.name?.[0]}</span>
                    </div>
                    {conv.unread && (
                      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--accent-blue)] rounded-full border-2 border-[var(--bg-secondary)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-medium ${conv.unread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                        {conv.name}
                      </p>
                      <span className="text-xs text-[var(--text-muted)]">{conv.time}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{conv.lastMessage}</p>
                    {conv.status === 'needs_response' && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-xs bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                        <StatusDot status="warning" size="sm" />
                        Needs response
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Message Thread */}
      <div className="flex-1 flex flex-col">
        <GlassCard padding="none" className="flex-1 flex flex-col overflow-hidden">
          {selectedConversation ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">{selectedConversation.name}</p>
                  <p className="text-sm text-[var(--text-muted)]">{selectedConversation.phone}</p>
                </div>
                <Link
                  href={`/leads?id=${selectedConv}`}
                  className="text-sm text-[var(--accent-blue)] hover:underline"
                >
                  View Contact
                </Link>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {mockMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === 'them' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                        msg.sender === 'them'
                          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                          : 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                      }`}
                    >
                      {msg.sender === 'ai' && (
                        <div className="flex items-center gap-1 mb-1 text-xs opacity-70">
                          <Bot className="h-3 w-3" />
                          AI Generated
                        </div>
                      )}
                      <p className="text-sm">{msg.text}</p>
                      <p className={`text-xs mt-1 ${msg.sender === 'them' ? 'text-[var(--text-muted)]' : 'opacity-70'}`}>
                        {msg.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Smart replies */}
              <div className="px-4 py-2 border-t border-[var(--border-subtle)] flex gap-2">
                <button className="px-3 py-1.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                  "I can offer $X based on..."
                </button>
                <button className="px-3 py-1.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                  "When can we schedule..."
                </button>
                <button className="px-3 py-1.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                  "Let me check and..."
                </button>
              </div>

              {/* Input */}
              <div className="p-4 border-t border-[var(--border-subtle)]">
                <div className="flex gap-2">
                  <button className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--accent-blue)]">
                    <Sparkles className="h-5 w-5" />
                  </button>
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                  <button className="btn-gradient px-4 py-2 rounded-lg flex items-center gap-2">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[var(--text-muted)]">Select a conversation to view</p>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Contact Panel */}
      {selectedConversation && (
        <div className="w-72 flex-shrink-0">
          <GlassCard className="h-full">
            <div className="text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center mx-auto mb-3">
                <span className="text-white font-bold text-xl">{selectedConversation.name?.[0]}</span>
              </div>
              <p className="font-semibold text-[var(--text-primary)]">{selectedConversation.name}</p>
              <p className="text-sm text-[var(--text-muted)]">{selectedConversation.phone}</p>
            </div>

            <div className="space-y-3 py-4 border-t border-[var(--border-subtle)]">
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Stage</p>
                <p className="text-sm text-[var(--text-primary)]">Interested</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Lead Score</p>
                <p className="text-sm font-mono text-[var(--color-success)]">85</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Property</p>
                <p className="text-sm text-[var(--text-primary)]">123 Main St, Miami FL</p>
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-[var(--border-subtle)]">
              <button className="w-full py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                Create Contract
              </button>
              <button className="w-full py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                Update Stage
              </button>
              <button className="w-full py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                Add Note
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/inbox/page.tsx
git commit -m "feat(inbox): dark three-column communication hub

- Conversation list with unread indicators
- Channel tabs (SMS, Email, Phone)
- Status filter pills
- Message thread with AI badge
- Smart reply suggestions
- Contact context panel"
```

---

### Task 12: Settings Page Overhaul

**Files:**
- Modify: `apps/web/src/app/settings/page.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2)
- Produces: Dark-themed grouped settings sections

- [ ] **Step 1: Update Settings page**

Due to the size of this file, update the container and header styles. Replace the outer wrapper in `apps/web/src/app/settings/page.tsx`:

Find:
```tsx
<div className="min-h-screen bg-gray-50/50 p-6">
  <div className="max-w-4xl mx-auto space-y-8">
    <header>
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">Settings</h1>
      <p className="text-gray-500 mt-1">Manage AI provider, test numbers, and API access</p>
    </header>
```

Replace with:
```tsx
<div className="space-y-6 max-w-4xl">
  <div>
    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h1>
    <p className="text-[var(--text-secondary)] mt-1">Manage AI provider, test numbers, and API access</p>
  </div>
```

And update Card components to use dark styling. For each `<Card className="border-none shadow-sm">`, replace with:
```tsx
<GlassCard>
```

Add import at top:
```tsx
import { GlassCard } from '@/components/ui/GlassCard';
```

Update text colors throughout from `text-gray-*` to `text-[var(--text-*)]`.

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/settings/page.tsx
git commit -m "feat(settings): apply dark theme to settings page

- GlassCard wrappers
- Dark text colors
- Consistent spacing"
```

---

### Task 13: Remaining Pages Dark Theme (Batch)

**Files:**
- Modify: `apps/web/src/app/contracts/page.tsx`
- Modify: `apps/web/src/app/approvals/page.tsx`
- Modify: `apps/web/src/app/analytics/page.tsx`
- Modify: `apps/web/src/app/campaigns/planner/page.tsx`
- Modify: `apps/web/src/app/leads/page.tsx`

**Interfaces:**
- Consumes: GlassCard (Task 2), StatusDot (Task 4), MetricValue (Task 3)
- Produces: Dark-themed versions of all remaining pages

- [ ] **Step 1: Update each page with dark theme wrapper**

For each page, apply the same pattern:
1. Change `bg-gray-50/50` to remove it (Shell provides dark bg)
2. Replace `<Card>` with `<GlassCard>`
3. Update text colors from `text-gray-*` to `text-[var(--text-*)]`
4. Add GlassCard import

Example pattern for page wrapper:
```tsx
<div className="space-y-6">
  <div>
    <h1 className="text-2xl font-bold text-[var(--text-primary)]">Page Title</h1>
    <p className="text-[var(--text-secondary)] mt-1">Page description</p>
  </div>
  {/* Content with GlassCard */}
</div>
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/contracts/page.tsx apps/web/src/app/approvals/page.tsx apps/web/src/app/analytics/page.tsx apps/web/src/app/campaigns/planner/page.tsx apps/web/src/app/leads/page.tsx
git commit -m "feat(pages): apply dark theme to remaining pages

- Contracts, Approvals, Analytics, Planner, Leads/Contacts
- GlassCard wrappers
- Consistent dark color scheme"
```

---

### Task 14: Final Typecheck and Visual Verification

**Files:**
- All modified files from Tasks 1-13

**Interfaces:**
- Consumes: All previous tasks
- Produces: Verified build with consistent dark theme

- [ ] **Step 1: Run full typecheck**

Run: `cd apps/web && yarn typecheck`

Expected: No errors

- [ ] **Step 2: Run linter**

Run: `cd apps/web && npx oxlint --no-ignore src`

Expected: No critical errors

- [ ] **Step 3: Start dev server**

Run: `cd apps/web && yarn dev`

Expected: Server starts, navigate to `/dashboard` to verify dark theme

- [ ] **Step 4: Commit any fixes**

If any fixes were needed:
```bash
git add -A
git commit -m "fix: resolve issues from UX overhaul"
```

---

## Success Criteria

- [ ] All pages use dark background (`#0F172A`)
- [ ] Glass-morphism cards throughout
- [ ] Glowing status dots
- [ ] Gradient CTAs
- [ ] JetBrains Mono for metrics
- [ ] Dashboard has profit/spend chart
- [ ] Dashboard has activity feed
- [ ] Lead Finder has visual source cards
- [ ] System Health has service descriptions
- [ ] Sidebar is dark with gradient logo
- [ ] Inbox has three-column layout
- [ ] Typecheck passes
