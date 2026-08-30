'use client';

import { Check, X, ExternalLink } from 'lucide-react';

interface CompetitorFeature {
  feature: string;
  dealflow: boolean | string;
  competitors: Record<string, boolean | string>;
  tooltip?: string;
}

interface CompetitorComparisonProps {
  features?: CompetitorFeature[];
  competitors?: string[];
  title?: string;
  subtitle?: string;
}

const DEFAULT_COMPETITORS = ['PropStream', 'REsimpli', 'BatchLeads'];

const DEFAULT_FEATURES: CompetitorFeature[] = [
  {
    feature: 'AI-Powered Outreach',
    dealflow: true,
    competitors: { PropStream: false, REsimpli: '$99/mo add-on', BatchLeads: '$89/mo add-on' },
    tooltip: 'Automated AI that writes and sends personalized messages',
  },
  {
    feature: 'AI Negotiation Assistant',
    dealflow: true,
    competitors: { PropStream: false, REsimpli: false, BatchLeads: false },
    tooltip: 'AI handles seller conversations and objections',
  },
  {
    feature: 'Automatic Buyer Matching',
    dealflow: true,
    competitors: { PropStream: false, REsimpli: false, BatchLeads: false },
    tooltip: 'Instantly match deals to your buyer list',
  },
  {
    feature: 'Contract Generation',
    dealflow: true,
    competitors: { PropStream: false, REsimpli: true, BatchLeads: false },
  },
  {
    feature: 'Built-in E-Sign',
    dealflow: true,
    competitors: { PropStream: false, REsimpli: '$15/mo', BatchLeads: false },
  },
  {
    feature: 'SMS & Email Included',
    dealflow: true,
    competitors: { PropStream: false, REsimpli: true, BatchLeads: 'Per-use $' },
  },
  {
    feature: 'Lead Finder',
    dealflow: true,
    competitors: { PropStream: true, REsimpli: false, BatchLeads: true },
  },
  {
    feature: 'Starting Price',
    dealflow: '$29/mo',
    competitors: { PropStream: '$99/mo', REsimpli: '$149/mo', BatchLeads: '$119/mo' },
  },
  {
    feature: 'Free Trial Length',
    dealflow: '14 days',
    competitors: { PropStream: '7 days', REsimpli: '14 days', BatchLeads: '7 days' },
  },
  {
    feature: 'Users Included',
    dealflow: '2-15',
    competitors: { PropStream: '1', REsimpli: '1-10', BatchLeads: '1' },
  },
];

function ValueCell({ value }: { value: boolean | string }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="h-5 w-5 text-green-500 mx-auto" />
    ) : (
      <X className="h-5 w-5 text-gray-300 mx-auto" />
    );
  }

  const isNegative = value.includes('add-on') || value.includes('$') && !value.includes('/mo');
  const isPositive = value.startsWith('$') && parseInt(value.replace(/\D/g, '')) < 50;

  return (
    <span className={`text-sm ${isNegative ? 'text-orange-600' : isPositive ? 'text-green-600 font-semibold' : 'text-gray-600'}`}>
      {value}
    </span>
  );
}

export function CompetitorComparison({
  features = DEFAULT_FEATURES,
  competitors = DEFAULT_COMPETITORS,
  title = 'See How We Compare',
  subtitle = 'Why pay more for less? DealFlow includes AI features others charge extra for.',
}: CompetitorComparisonProps) {
  return (
    <div className="w-full">
      {title && (
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">{title}</h2>
          {subtitle && <p className="text-gray-600">{subtitle}</p>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse bg-white rounded-xl overflow-hidden shadow-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left p-4 font-medium text-gray-600 min-w-[200px]">Feature</th>
              <th className="text-center p-4 min-w-[120px]">
                <div className="flex flex-col items-center">
                  <span className="font-bold text-blue-600">DealFlow AI</span>
                  <span className="text-xs text-blue-500 font-normal">Your choice</span>
                </div>
              </th>
              {competitors.map((comp) => (
                <th key={comp} className="text-center p-4 font-medium text-gray-600 min-w-[120px]">
                  {comp}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {features.map((row, i) => (
              <tr
                key={i}
                className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50/30 transition-colors`}
              >
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-900 font-medium">{row.feature}</span>
                    {row.tooltip && (
                      <span
                        className="text-gray-400 hover:text-gray-600 cursor-help text-xs"
                        title={row.tooltip}
                      >
                        ?
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-4 text-center bg-blue-50/50">
                  <ValueCell value={row.dealflow} />
                </td>
                {competitors.map((comp) => (
                  <td key={comp} className="p-4 text-center">
                    <ValueCell value={row.competitors[comp]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-500">
          Data sourced from public pricing pages.
          <a
            href="https://www.propstream.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-blue-600 hover:underline ml-2"
          >
            View sources <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>
    </div>
  );
}
