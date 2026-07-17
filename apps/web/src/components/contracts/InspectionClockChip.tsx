'use client';

/**
 * Phase V-R — inspection-window countdown chip.
 * "Day 4 of 10 — 6 days to assign", color ramp green (> half remaining) →
 * amber (≤ half) → red (≤ 2 days) → gray (expired/assigned). Pure render over
 * the shared clock core; the same math drives the server urgency hooks.
 */
import { clockState } from '@/app/api/utils/inspectionClockCore';

const STYLES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  expired: 'bg-gray-100 text-gray-500 border-gray-200',
  assigned: 'bg-blue-50 text-blue-700 border-blue-200',
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
