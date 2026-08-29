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
