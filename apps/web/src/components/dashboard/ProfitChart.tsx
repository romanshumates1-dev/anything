'use client';

import { GlassCard } from '@/components/ui/GlassCard';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const data = [
  { month: 'Jan', profit: 12000, spend: 3200 },
  { month: 'Feb', profit: 18000, spend: 4100 },
  { month: 'Mar', profit: 15000, spend: 3800 },
  { month: 'Apr', profit: 22000, spend: 5200 },
  { month: 'May', profit: 28000, spend: 6100 },
  { month: 'Jun', profit: 32000, spend: 7000 },
  { month: 'Jul', profit: 38000, spend: 8200 },
  { month: 'Aug', profit: 45000, spend: 9500 },
];

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: TooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass-card p-3 text-sm">
        <p className="text-[var(--text-primary)] font-medium mb-2">{label}</p>
        <p className="text-[var(--color-success)]">
          Profit: ${payload[0]?.value?.toLocaleString()}
        </p>
        <p className="text-[var(--color-warning)]">
          Spend: ${payload[1]?.value?.toLocaleString()}
        </p>
        <p className="text-[var(--text-secondary)] mt-1 pt-1 border-t border-[var(--border-subtle)]">
          Net: ${((payload[0]?.value || 0) - (payload[1]?.value || 0))?.toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
};

export function ProfitChart() {
  const latestProfit = data[data.length - 1].profit;
  const latestSpend = data[data.length - 1].spend;
  const netProfit = latestProfit - latestSpend;

  return (
    <GlassCard className="h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Monthly P&L</h3>
        <div className="text-right">
          <p className="text-sm text-[var(--text-muted)]">Net this month</p>
          <p className="text-xl font-mono font-semibold text-[var(--color-success)]">
            +${netProfit.toLocaleString()}
          </p>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="month"
              stroke="#64748B"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#64748B"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value / 1000}k`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="profit"
              stroke="#10B981"
              strokeWidth={2}
              fill="url(#profitGradient)"
              name="Profit"
            />
            <Area
              type="monotone"
              dataKey="spend"
              stroke="#F59E0B"
              strokeWidth={2}
              fill="url(#spendGradient)"
              name="Spend"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-6 mt-4 pt-4 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[var(--color-success)]" />
          <span className="text-sm text-[var(--text-secondary)]">Profit</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[var(--color-warning)]" />
          <span className="text-sm text-[var(--text-secondary)]">Credit Spend</span>
        </div>
      </div>
    </GlassCard>
  );
}
