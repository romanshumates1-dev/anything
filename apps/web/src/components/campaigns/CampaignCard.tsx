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
