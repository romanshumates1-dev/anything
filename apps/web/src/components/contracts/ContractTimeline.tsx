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
  sent: { label: 'Sent for Signature', icon: '📤', color: 'text-[var(--color-info)] bg-[var(--color-info)]/10 border-[var(--color-info)]/30' },
  viewed: { label: 'Viewed by Signer', icon: '👁️', color: 'text-[var(--color-warning)] bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30' },
  signed: { label: 'Signed', icon: '✍️', color: 'text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30' },
  countersigned: { label: 'Countersigned', icon: '🤝', color: 'text-[var(--accent-purple)] bg-[var(--accent-purple)]/10 border-[var(--accent-purple)]/30' },
};

const STATUS_ORDER = ['pending', 'sent', 'viewed', 'signed', 'countersigned'];

export default function ContractTimeline({ events, currentStatus }: ContractTimelineProps) {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-[var(--text-muted)] mb-3">Signing Timeline</h4>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-[var(--bg-tertiary)]" />

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
                  ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/20'
                  : isReached
                    ? 'bg-[var(--color-success)] border-[var(--color-success)]'
                    : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)]'
              }`} />

              {/* Content */}
              <div className={`flex-1 min-w-0 ${!isReached ? 'opacity-40' : ''}`}>
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${
                  isActive ? info.color : isReached ? 'bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-secondary)]' : 'bg-[var(--bg-tertiary)]/50 border-[var(--border-subtle)]/50 text-[var(--text-muted)]'
                }`}>
                  <span>{info.icon}</span>
                  <span>{info.label}</span>
                </div>
                {event && (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {new Date(event.created_at).toLocaleString()}
                  </p>
                )}
                {!event && isReached && (
                  <p className="mt-1 text-xs text-[var(--text-muted)] italic">Event recorded</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}