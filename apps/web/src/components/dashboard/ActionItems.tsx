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
