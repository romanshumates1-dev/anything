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
      <div className="rounded-full bg-gray-100 p-4 mb-4">
        <Icon className="h-8 w-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-500 max-w-md mb-6">{description}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        {primaryAction && (
          <Link
            href={primaryAction.href}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors min-h-[48px]"
          >
            {primaryAction.label}
          </Link>
        )}
        {secondaryAction && (
          <Link
            href={secondaryAction.href}
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors min-h-[48px]"
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
