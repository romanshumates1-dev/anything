'use client';

import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  X,
  RotateCcw,
  Upload,
  Megaphone,
  Mail,
  BarChart3,
  FileText,
  LayoutDashboard,
  ArrowRight,
} from 'lucide-react';

const CHECKLIST_KEY = 'onboarding_checklist';
const CHECKLIST_DISMISSED_KEY = 'onboarding_checklist_dismissed';

export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: React.ElementType;
  actionLabel?: string;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  {
    id: 'explore-dashboard',
    title: 'Explore Your Dashboard',
    description: 'Get familiar with your KPIs, pipeline, and system health',
    href: '/dashboard',
    icon: LayoutDashboard,
    actionLabel: 'View Dashboard',
  },
  {
    id: 'import-leads',
    title: 'Import Your First Leads',
    description: 'Upload a CSV or manually add leads to get started',
    href: '/crm?action=import',
    icon: Upload,
    actionLabel: 'Import Leads',
  },
  {
    id: 'create-campaign',
    title: 'Create a Campaign',
    description: 'Set up your first outreach campaign with AI-powered messaging',
    href: '/campaigns/wizard',
    icon: Megaphone,
    actionLabel: 'Create Campaign',
  },
  {
    id: 'configure-outreach',
    title: 'Configure Outreach Settings',
    description: 'Connect your email and SMS for sending messages',
    href: '/admin?tab=outreach',
    icon: Mail,
    actionLabel: 'Configure',
  },
  {
    id: 'review-analytics',
    title: 'Review Analytics',
    description: 'Learn how to track your campaign performance',
    href: '/analytics',
    icon: BarChart3,
    actionLabel: 'View Analytics',
  },
  {
    id: 'setup-contracts',
    title: 'Set Up Contract Templates',
    description: 'Configure your contract templates for quick deal closing',
    href: '/contracts/templates',
    icon: FileText,
    actionLabel: 'Manage Contracts',
  },
];

interface OnboardingChecklistProps {
  items?: ChecklistItem[];
  variant?: 'card' | 'inline' | 'minimal';
  className?: string;
  onAllComplete?: () => void;
  onItemComplete?: (itemId: string) => void;
  persistKey?: string;
}

export function OnboardingChecklist({
  items = DEFAULT_CHECKLIST,
  variant = 'card',
  className,
  onAllComplete,
  onItemComplete,
  persistKey = CHECKLIST_KEY,
}: OnboardingChecklistProps) {
  const [completedItems, setCompletedItems] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load state from localStorage
  useEffect(() => {
    const savedCompleted = localStorage.getItem(persistKey);
    const savedDismissed = localStorage.getItem(CHECKLIST_DISMISSED_KEY);

    if (savedCompleted) {
      try {
        setCompletedItems(JSON.parse(savedCompleted));
      } catch {
        // Invalid JSON, reset
        localStorage.removeItem(persistKey);
      }
    }

    if (savedDismissed === 'true') {
      setIsDismissed(true);
    }

    setIsLoaded(true);
  }, [persistKey]);

  // Save to localStorage whenever completedItems changes
  useEffect(() => {
    if (isLoaded && completedItems.length > 0) {
      localStorage.setItem(persistKey, JSON.stringify(completedItems));
    }
  }, [completedItems, isLoaded, persistKey]);

  // Also try to save to server
  const syncToServer = useCallback(async (completed: string[]) => {
    try {
      await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_checklist: completed }),
      });
    } catch {
      // Silently fail - localStorage is primary
    }
  }, []);

  const toggleItemComplete = useCallback((itemId: string) => {
    setCompletedItems((prev) => {
      const newCompleted = prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId];

      // Sync to server
      syncToServer(newCompleted);

      // Notify parent
      if (!prev.includes(itemId)) {
        onItemComplete?.(itemId);
      }

      // Check if all complete
      if (newCompleted.length === items.length) {
        onAllComplete?.();
      }

      return newCompleted;
    });
  }, [items.length, onAllComplete, onItemComplete, syncToServer]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    localStorage.setItem(CHECKLIST_DISMISSED_KEY, 'true');
  }, []);

  const handleRestore = useCallback(() => {
    setIsDismissed(false);
    localStorage.removeItem(CHECKLIST_DISMISSED_KEY);
  }, []);

  const resetChecklist = useCallback(() => {
    setCompletedItems([]);
    localStorage.removeItem(persistKey);
    syncToServer([]);
  }, [persistKey, syncToServer]);

  // Don't render until we've loaded from localStorage to prevent hydration mismatch
  if (!isLoaded) return null;

  const completedCount = completedItems.length;
  const totalCount = items.length;
  const progressPercent = (completedCount / totalCount) * 100;
  const isAllComplete = completedCount === totalCount;

  // If dismissed and not all complete, show a minimal restore button
  if (isDismissed && !isAllComplete) {
    return (
      <button
        onClick={handleRestore}
        className={cn(
          'flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors',
          className
        )}
      >
        <RotateCcw className="w-4 h-4" />
        Show setup checklist
      </button>
    );
  }

  // Don't show if all complete and variant is card (will show celebration instead)
  if (isAllComplete && variant === 'card') {
    return (
      <GlassCard className={cn('relative overflow-hidden', className)} padding="md">
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-success)]/5 to-[var(--accent-purple)]/5" />
        <div className="relative flex items-center gap-4">
          <div className="p-3 rounded-xl bg-[var(--color-success)]/10">
            <CheckCircle2 className="w-6 h-6 text-[var(--color-success)]" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Setup Complete!</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              You&apos;ve completed all onboarding steps. You&apos;re ready to close deals!
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={resetChecklist} className="gap-1">
            <RotateCcw className="w-4 h-4" />
            Reset
          </Button>
        </div>
      </GlassCard>
    );
  }

  // Minimal variant - just progress and count
  if (variant === 'minimal') {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--color-success)] rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
          {completedCount}/{totalCount} complete
        </span>
      </div>
    );
  }

  // Inline variant - horizontal list
  if (variant === 'inline') {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">Getting Started</h4>
          <span className="text-xs text-[var(--text-muted)]">{completedCount}/{totalCount}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const isComplete = completedItems.includes(item.id);
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => !isComplete && toggleItemComplete(item.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  isComplete
                    ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--accent-blue)]/10 hover:text-[var(--accent-blue)]'
                )}
              >
                {isComplete ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <Icon className="w-3 h-3" />
                )}
                {item.title}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // Default: card variant
  return (
    <GlassCard className={cn('relative overflow-hidden', className)} padding="none">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20">
            <Sparkles className="w-5 h-5 text-[var(--accent-blue)]" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Getting Started</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {completedCount} of {totalCount} tasks complete
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] transition-colors"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 py-2 bg-[var(--bg-tertiary)]/30">
        <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--color-success)] rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Items list */}
      {isExpanded && (
        <div className="divide-y divide-[var(--border-subtle)]">
          {items.map((item) => {
            const isComplete = completedItems.includes(item.id);
            const Icon = item.icon;

            return (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-4 p-4 transition-colors',
                  isComplete && 'bg-[var(--color-success)]/5'
                )}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleItemComplete(item.id)}
                  className={cn(
                    'flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
                    isComplete
                      ? 'border-[var(--color-success)] bg-[var(--color-success)]'
                      : 'border-[var(--border-medium)] hover:border-[var(--accent-blue)]'
                  )}
                  aria-label={isComplete ? `Mark ${item.title} incomplete` : `Mark ${item.title} complete`}
                >
                  {isComplete && <CheckCircle2 className="w-4 h-4 text-white" />}
                </button>

                {/* Icon */}
                <div className={cn(
                  'p-2 rounded-lg transition-colors',
                  isComplete ? 'bg-[var(--color-success)]/10' : 'bg-[var(--bg-tertiary)]'
                )}>
                  <Icon className={cn(
                    'w-4 h-4',
                    isComplete ? 'text-[var(--color-success)]' : 'text-[var(--text-muted)]'
                  )} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h4 className={cn(
                    'text-sm font-medium',
                    isComplete ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'
                  )}>
                    {item.title}
                  </h4>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {item.description}
                  </p>
                </div>

                {/* Action */}
                {!isComplete && (
                  <Link href={item.href}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-[var(--accent-blue)] hover:text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10"
                      onClick={() => toggleItemComplete(item.id)}
                    >
                      {item.actionLabel || 'Start'}
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

// Utility functions for external use
export function resetOnboardingChecklist() {
  localStorage.removeItem(CHECKLIST_KEY);
  localStorage.removeItem(CHECKLIST_DISMISSED_KEY);
}

export function getChecklistProgress(): { completed: string[]; total: number } {
  if (typeof window === 'undefined') return { completed: [], total: DEFAULT_CHECKLIST.length };

  const saved = localStorage.getItem(CHECKLIST_KEY);
  const completed = saved ? JSON.parse(saved) : [];
  return { completed, total: DEFAULT_CHECKLIST.length };
}

export function isChecklistComplete(): boolean {
  const { completed, total } = getChecklistProgress();
  return completed.length >= total;
}
