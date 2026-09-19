'use client';

import Link from 'next/link';
import { LucideIcon, FileText, Users, MessageSquare, BarChart, Mail, Phone, Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    href: string;
  };
  secondaryAction?: {
    label: string;
    href: string;
  };
}

const ICON_MAP: Record<string, LucideIcon> = {
  campaigns: Mail,
  leads: Users,
  conversations: MessageSquare,
  analytics: BarChart,
  contracts: FileText,
  calls: Phone,
  inbox: Inbox,
};

export function EmptyState({
  icon: Icon = FileText,
  title,
  description,
  primaryAction,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-[var(--bg-tertiary)] p-4 mb-4">
        <Icon className="h-8 w-8 text-[var(--text-muted)]" />
      </div>
      <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] max-w-md mb-6">{description}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        {primaryAction && (
          <Link
            href={primaryAction.href}
            className="btn-gradient inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold text-white transition-colors min-h-[48px]"
          >
            {primaryAction.label}
          </Link>
        )}
        {secondaryAction && (
          <Link
            href={secondaryAction.href}
            className="inline-flex items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-6 py-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors min-h-[48px]"
          >
            {secondaryAction.label}
          </Link>
        )}
      </div>
    </div>
  );
}

export function getEmptyStateIcon(type: string): LucideIcon {
  return ICON_MAP[type] || FileText;
}
