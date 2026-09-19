'use client';

/**
 * Phase V-R — inspection-window countdown chip.
 * "Day 4 of 10 — 6 days to assign", color ramp green (> half remaining) →
 * amber (≤ half) → red (≤ 2 days) → gray (expired/assigned). Pure render over
 * the shared clock core; the same math drives the server urgency hooks.
 */
import { clockState } from '@/app/api/utils/inspectionClockCore';

const STYLES: Record<string, string> = {
  green: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30',
  amber: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30',
  red: 'bg-[var(--color-error)]/10 text-[var(--color-error)] border-[var(--color-error)]/30',
  expired: 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-subtle)]',
  assigned: 'bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/30',
};

export default function InspectionClockChip({
  createdAt,
  inspectionDays,
  assignedAt,
}: {
  createdAt: string | Date;
  inspectionDays?: number | null;
  assignedAt?: string | Date | null;
}) {
  if (assignedAt) {
    return (
      <span data-testid="inspection-chip" data-stage="assigned" className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES.assigned}`}>
        Assigned ✓
      </span>
    );
  }
  const s = clockState(new Date(createdAt), inspectionDays ?? 10, new Date());
  return (
    <span data-testid="inspection-chip" data-stage={s.stage} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[s.stage]}`}>
      {s.label}
    </span>
  );
}
