'use client';

import { GlassCard } from '@/components/ui/GlassCard';
import { CheckCircle, FileText, MessageSquare, UserPlus, AlertTriangle } from 'lucide-react';

interface ActivityItem {
  id: string;
  type: 'deal' | 'contract' | 'message' | 'lead' | 'alert';
  title: string;
  time: string;
  day: string;
}

const activities: ActivityItem[] = [
  { id: '1', type: 'deal', title: 'Deal closed - 123 Main St ($12,500)', time: '2 hours ago', day: 'Today' },
  { id: '2', type: 'contract', title: 'Contract signed - 456 Oak Ave', time: '4 hours ago', day: 'Today' },
  { id: '3', type: 'message', title: '50 messages sent in Tax Delinquent campaign', time: '5 hours ago', day: 'Today' },
  { id: '4', type: 'lead', title: 'New lead added - 789 Pine Rd', time: '1 day ago', day: 'Yesterday' },
  { id: '5', type: 'message', title: 'Response from John Smith', time: '1 day ago', day: 'Yesterday' },
  { id: '6', type: 'alert', title: 'Contract expiring in 3 days', time: '2 days ago', day: 'Earlier' },
];

const iconMap = {
  deal: { icon: CheckCircle, color: 'text-[var(--color-success)]', bg: 'bg-[var(--color-success)]/10' },
  contract: { icon: FileText, color: 'text-[var(--accent-blue)]', bg: 'bg-[var(--accent-blue)]/10' },
  message: { icon: MessageSquare, color: 'text-[var(--text-muted)]', bg: 'bg-[var(--bg-tertiary)]' },
  lead: { icon: UserPlus, color: 'text-[var(--accent-purple)]', bg: 'bg-[var(--accent-purple)]/10' },
  alert: { icon: AlertTriangle, color: 'text-[var(--color-warning)]', bg: 'bg-[var(--color-warning)]/10' },
};

export function ActivityFeed() {
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.day]) acc[activity.day] = [];
    acc[activity.day].push(activity);
    return acc;
  }, {} as Record<string, ActivityItem[]>);

  return (
    <GlassCard className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Activity</h3>
      <div className="flex-1 overflow-y-auto space-y-4 max-h-80">
        {Object.entries(groupedActivities).map(([day, items]) => (
          <div key={day}>
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2 sticky top-0 bg-[var(--glass-bg)] py-1">
              {day}
            </p>
            <div className="space-y-2">
              {items.map((activity) => {
                const { icon: Icon, color, bg } = iconMap[activity.type];
                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                  >
                    <div className={`p-2 rounded-lg ${bg}`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] truncate">{activity.title}</p>
                      <p className="text-xs text-[var(--text-muted)]">{activity.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
