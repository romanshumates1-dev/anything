interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
}

function KPICard({ title, value, subtitle }: KPICardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="text-sm font-medium text-gray-600 mb-1">{title}</div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

interface KPIBarProps {
  totalLeads: number;
  activeDeals: number;
  expectedValue: number;
  avgProbability: number;
}

export function KPIBar({ totalLeads, activeDeals, expectedValue, avgProbability }: KPIBarProps) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <KPICard title="Total Leads" value={totalLeads} />
      <KPICard title="Active Deals" value={activeDeals} />
      <KPICard
        title="Expected Value"
        value={`$${Math.round(expectedValue / 100).toLocaleString()}`}
      />
      <KPICard
        title="Avg P(Close)"
        value={`${(avgProbability * 100).toFixed(1)}%`}
      />
    </div>
  );
}
