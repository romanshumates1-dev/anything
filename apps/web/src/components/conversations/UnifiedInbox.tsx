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
