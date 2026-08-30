'use client';

import { useState } from 'react';
import { FunnelIcon } from '@heroicons/react/24/outline';

interface FilterState {
  status: string[];
  source: string[];
  dateRange: string;
}

interface LeadFiltersProps {
  onFilterChange: (filters: FilterState) => void;
  initialFilters?: Partial<FilterState>;
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'appointment', label: 'Appointment Set' },
  { value: 'negotiating', label: 'Negotiating' },
  { value: 'contract', label: 'Under Contract' },
  { value: 'closed', label: 'Closed' },
  { value: 'lost', label: 'Lost' },
];

const SOURCE_OPTIONS = [
  { value: 'propstream', label: 'PropStream' },
  { value: 'batchleads', label: 'BatchLeads' },
  { value: 'manual', label: 'Manual Entry' },
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
];

const DATE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
];

export function LeadFilters({ onFilterChange, initialFilters }: LeadFiltersProps) {
  const [filters, setFilters] = useState<FilterState>({
    status: initialFilters?.status || [],
    source: initialFilters?.source || [],
    dateRange: initialFilters?.dateRange || 'all',
  });
  const [isOpen, setIsOpen] = useState(false);

  const activeFilterCount =
    filters.status.length +
    filters.source.length +
    (filters.dateRange !== 'all' ? 1 : 0);

  const updateFilters = (newFilters: Partial<FilterState>) => {
    const updated = { ...filters, ...newFilters };
    setFilters(updated);
    onFilterChange(updated);
  };

  const clearFilters = () => {
    const cleared = { status: [], source: [], dateRange: 'all' };
    setFilters(cleared);
    onFilterChange(cleared);
  };

  const toggleArrayFilter = (key: 'status' | 'source', value: string) => {
    const current = filters[key];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    updateFilters({ [key]: updated });
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
      >
        <FunnelIcon className="h-4 w-4" />
        Filters
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center h-5 w-5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
            {activeFilterCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-10 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">Filters</span>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-700">
                Clear all
              </button>
            )}
          </div>

          <div className="p-4 space-y-4">
            {/* Status */}
            <div>
              <label className="text-xs font-medium text-gray-700 uppercase tracking-wider">Status</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleArrayFilter('status', opt.value)}
                    className={`px-2 py-1 text-xs rounded-full border ${
                      filters.status.includes(opt.value)
                        ? 'bg-blue-100 border-blue-300 text-blue-800'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source */}
            <div>
              <label className="text-xs font-medium text-gray-700 uppercase tracking-wider">Source</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => toggleArrayFilter('source', opt.value)}
                    className={`px-2 py-1 text-xs rounded-full border ${
                      filters.source.includes(opt.value)
                        ? 'bg-blue-100 border-blue-300 text-blue-800'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div>
              <label className="text-xs font-medium text-gray-700 uppercase tracking-wider">Date Added</label>
              <select
                value={filters.dateRange}
                onChange={(e) => updateFilters({ dateRange: e.target.value })}
                className="mt-2 block w-full rounded-md border-gray-300 text-sm focus:border-blue-500 focus:ring-blue-500"
              >
                {DATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-4 border-t border-gray-200">
            <button
              onClick={() => setIsOpen(false)}
              className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
