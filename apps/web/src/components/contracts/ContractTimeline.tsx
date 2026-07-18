'use client';

/**
 * Phase P1 — E-Sign event timeline component.
 *
 * Displays the signing lifecycle events (sent → viewed → signed → countersigned)
 * as a vertical timeline on the contract card.
 */
import React from 'react';

export interface TimelineEvent {
  event_type: 'sent' | 'viewed' | 'signed' | 'countersigned';
  created_at: string;
  event_data?: Record<string, any>;
}

interface ContractTimelineProps {
  events: TimelineEvent[];
  currentStatus: string;
}

const EVENT_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  sent: { label: 'Sent for Signature', icon: '📤', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  viewed: { label: 'Viewed by Signer', icon: '👁️', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  signed: { label: 'Signed', icon: '✍️', color: 'text-green-600 bg-green-50 border-green-200' },
  countersigned: { label: 'Countersigned', icon: '🤝', color: 'text-purple-600 bg-purple-50 border-purple-200' },
};

const STATUS_ORDER = ['pending', 'sent', 'viewed', 'signed', 'countersigned'];

export default function ContractTimeline({ events, currentStatus }: ContractTimelineProps) {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-gray-500 mb-3">Signing Timeline</h4>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200" />

        {STATUS_ORDER.filter(s => s !== 'pending').map((status, idx) => {
          const event = events.find(e => e.event_type === status);
          const info = EVENT_LABELS[status];
          const isReached = currentIndex >= STATUS_ORDER.indexOf(status);
          const isActive = currentIndex === STATUS_ORDER.indexOf(status);

          return (
            <div key={status} className="relative flex items-start gap-4 pb-4 last:pb-0">
              {/* Dot */}
              <div className={`relative z-10 mt-1 w-3 h-3 rounded-full border-2 ${
                isActive
                  ? 'bg-blue-500 border-blue-500 ring-2 ring-blue-200'
                  : isReached
                    ? 'bg-green-500 border-green-500'
                    : 'bg-white border-gray-300'
              }`} />

              {/* Content */}
              <div className={`flex-1 min-w-0 ${!isReached ? 'opacity-40' : ''}`}>
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${
                  isActive ? info.color : isReached ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-gray-50 border-gray-100 text-gray-400'
                }`}>
                  <span>{info.icon}</span>
                  <span>{info.label}</span>
                </div>
                {event && (
                  <p className="mt-1 text-xs text-gray-500">
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                )}
                {!event && isReached && (
                  <p className="mt-1 text-xs text-gray-400 italic">Event recorded</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}