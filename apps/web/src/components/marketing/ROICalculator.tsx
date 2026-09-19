'use client';

import { useState, useMemo } from 'react';
import { Calculator, Clock, DollarSign, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface ROICalculatorProps {
  className?: string;
  showCTA?: boolean;
  variant?: 'full' | 'compact' | 'inline';
}

/**
 * ROICalculator - Help prospects understand potential value
 *
 * Ethical guidelines:
 * - Use conservative estimates
 * - Show ranges, not guarantees
 * - Include disclaimer about results varying
 * - Base calculations on real industry data
 */
export function ROICalculator({
  className = '',
  showCTA = true,
  variant = 'full',
}: ROICalculatorProps) {
  const [leadsPerMonth, setLeadsPerMonth] = useState(100);
  const [hoursPerLead, setHoursPerLead] = useState(0.5);
  const [hourlyRate, setHourlyRate] = useState(50);
  const [dealCloseRate, setDealCloseRate] = useState(2);
  const [avgDealProfit, setAvgDealProfit] = useState(10000);

  const calculations = useMemo(() => {
    // Time savings calculation
    const manualHoursPerMonth = leadsPerMonth * hoursPerLead;
    const aiHoursPerMonth = manualHoursPerMonth * 0.2; // AI handles 80%
    const hoursSaved = manualHoursPerMonth - aiHoursPerMonth;
    const timeSavingsValue = hoursSaved * hourlyRate;

    // Deal improvement calculation (conservative 20% improvement)
    const currentDeals = (leadsPerMonth * dealCloseRate) / 100;
    const improvedDeals = currentDeals * 1.2;
    const additionalDeals = improvedDeals - currentDeals;
    const additionalRevenue = additionalDeals * avgDealProfit;

    // Total monthly value
    const monthlyValue = timeSavingsValue + additionalRevenue;

    // Annual projection
    const annualValue = monthlyValue * 12;

    // Typical plan cost (Pro at $299/mo)
    const planCost = 299;
    const roi = ((monthlyValue - planCost) / planCost) * 100;

    return {
      hoursSaved: Math.round(hoursSaved),
      timeSavingsValue: Math.round(timeSavingsValue),
      additionalDeals: additionalDeals.toFixed(1),
      additionalRevenue: Math.round(additionalRevenue),
      monthlyValue: Math.round(monthlyValue),
      annualValue: Math.round(annualValue),
      roi: Math.round(roi),
    };
  }, [leadsPerMonth, hoursPerLead, hourlyRate, dealCloseRate, avgDealProfit]);

  if (variant === 'inline') {
    return (
      <div className={`bg-[#1E293B]/50 rounded-xl p-6 border border-white/10 ${className}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-[#3B82F6]/10">
            <Calculator className="h-5 w-5 text-[#3B82F6]" />
          </div>
          <h3 className="font-semibold text-white">Quick ROI Estimate</h3>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Leads/month</label>
            <input
              type="number"
              value={leadsPerMonth}
              onChange={(e) => setLeadsPerMonth(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:border-[#3B82F6] outline-none"
            />
          </div>
          <div className="flex items-end">
            <div className="text-right w-full">
              <p className="text-xs text-slate-500">Potential monthly value</p>
              <p className="text-2xl font-bold text-emerald-400">
                ${calculations.monthlyValue.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`rounded-2xl border border-white/10 bg-[#1E293B]/30 p-6 ${className}`}>
        <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
          <Calculator className="h-5 w-5 text-[#3B82F6]" />
          Estimate Your Savings
        </h3>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-400 block mb-2">
              Leads you contact monthly
            </label>
            <input
              type="range"
              min="10"
              max="500"
              step="10"
              value={leadsPerMonth}
              onChange={(e) => setLeadsPerMonth(Number(e.target.value))}
              className="w-full accent-[#3B82F6]"
            />
            <p className="text-right text-sm text-white">{leadsPerMonth} leads</p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
            <div className="text-center p-3 rounded-lg bg-white/5">
              <p className="text-2xl font-bold text-white">{calculations.hoursSaved}h</p>
              <p className="text-xs text-slate-500">Hours saved/month</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-emerald-500/10">
              <p className="text-2xl font-bold text-emerald-400">
                ${calculations.monthlyValue.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500">Monthly value</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-600 mt-4">
          *Based on industry averages. Your results may vary.
        </p>
      </div>
    );
  }

  // Full variant
  return (
    <div className={`rounded-2xl border border-white/10 bg-[#1E293B]/50 overflow-hidden ${className}`}>
      <div className="bg-gradient-to-r from-[#3B82F6]/10 to-[#8B5CF6]/10 p-6 border-b border-white/10">
        <h2 className="text-xl font-bold text-white flex items-center gap-3">
          <Calculator className="h-6 w-6 text-[#3B82F6]" />
          Calculate Your Potential ROI
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          See how much time and money you could save with AI automation
        </p>
      </div>

      <div className="p-6">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Inputs */}
          <div className="space-y-6">
            <h3 className="font-medium text-white mb-4">Your Current Numbers</h3>

            <div>
              <label className="flex justify-between text-sm text-slate-400 mb-2">
                <span>Leads contacted per month</span>
                <span className="text-white font-medium">{leadsPerMonth}</span>
              </label>
              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={leadsPerMonth}
                onChange={(e) => setLeadsPerMonth(Number(e.target.value))}
                className="w-full accent-[#3B82F6]"
              />
            </div>

            <div>
              <label className="flex justify-between text-sm text-slate-400 mb-2">
                <span>Hours spent per lead (outreach + follow-up)</span>
                <span className="text-white font-medium">{hoursPerLead}h</span>
              </label>
              <input
                type="range"
                min="0.25"
                max="2"
                step="0.25"
                value={hoursPerLead}
                onChange={(e) => setHoursPerLead(Number(e.target.value))}
                className="w-full accent-[#3B82F6]"
              />
            </div>

            <div>
              <label className="flex justify-between text-sm text-slate-400 mb-2">
                <span>Your hourly value ($)</span>
                <span className="text-white font-medium">${hourlyRate}</span>
              </label>
              <input
                type="range"
                min="25"
                max="200"
                step="5"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(Number(e.target.value))}
                className="w-full accent-[#3B82F6]"
              />
            </div>

            <div>
              <label className="flex justify-between text-sm text-slate-400 mb-2">
                <span>Current deal close rate (%)</span>
                <span className="text-white font-medium">{dealCloseRate}%</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={dealCloseRate}
                onChange={(e) => setDealCloseRate(Number(e.target.value))}
                className="w-full accent-[#3B82F6]"
              />
            </div>

            <div>
              <label className="flex justify-between text-sm text-slate-400 mb-2">
                <span>Average profit per deal ($)</span>
                <span className="text-white font-medium">${avgDealProfit.toLocaleString()}</span>
              </label>
              <input
                type="range"
                min="2000"
                max="50000"
                step="1000"
                value={avgDealProfit}
                onChange={(e) => setAvgDealProfit(Number(e.target.value))}
                className="w-full accent-[#3B82F6]"
              />
            </div>
          </div>

          {/* Results */}
          <div>
            <h3 className="font-medium text-white mb-4">Your Potential Savings</h3>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3 mb-2">
                  <Clock className="h-5 w-5 text-[#3B82F6]" />
                  <span className="text-slate-400">Time saved per month</span>
                </div>
                <p className="text-3xl font-bold text-white">
                  {calculations.hoursSaved} hours
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Worth ${calculations.timeSavingsValue.toLocaleString()} at your rate
                </p>
              </div>

              <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3 mb-2">
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-400">Additional deals (20% improvement)</span>
                </div>
                <p className="text-3xl font-bold text-white">
                  +{calculations.additionalDeals} deals/mo
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Worth ${calculations.additionalRevenue.toLocaleString()} in profit
                </p>
              </div>

              <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-[#3B82F6]/10 border border-emerald-500/20">
                <div className="flex items-center gap-3 mb-2">
                  <DollarSign className="h-5 w-5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Total monthly value</span>
                </div>
                <p className="text-4xl font-bold text-emerald-400">
                  ${calculations.monthlyValue.toLocaleString()}
                </p>
                <p className="text-sm text-slate-400 mt-2">
                  ${calculations.annualValue.toLocaleString()}/year |{' '}
                  <span className="text-emerald-400">{calculations.roi}% ROI</span>
                </p>
              </div>
            </div>

            {showCTA && (
              <Link
                href="/account/signup"
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-6 py-3.5 text-base font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
              >
                Start Saving Time Now
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-600 mt-6 pt-4 border-t border-white/10">
          *Estimates are based on industry averages and a conservative 20% improvement in close rate
          from faster response times. Individual results will vary based on market conditions, lead
          quality, and other factors. This calculator is for illustration purposes only and does not
          guarantee specific results.
        </p>
      </div>
    </div>
  );
}

/**
 * TimeSavedCalculator - Focused on time savings specifically
 */
export function TimeSavedCalculator({ className = '' }: { className?: string }) {
  const [hoursPerWeek, setHoursPerWeek] = useState(10);

  const hoursSaved = Math.round(hoursPerWeek * 0.8); // 80% automation
  const yearlyHours = hoursSaved * 52;
  const weeksReclaimed = Math.round(yearlyHours / 40);

  return (
    <div className={`rounded-xl border border-white/10 bg-[#1E293B]/30 p-6 ${className}`}>
      <h3 className="font-semibold text-white mb-4">How Much Time Will You Save?</h3>

      <div className="mb-6">
        <label className="text-sm text-slate-400 block mb-2">
          Hours spent on lead outreach weekly: <span className="text-white">{hoursPerWeek}h</span>
        </label>
        <input
          type="range"
          min="2"
          max="40"
          value={hoursPerWeek}
          onChange={(e) => setHoursPerWeek(Number(e.target.value))}
          className="w-full accent-[#3B82F6]"
        />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 rounded-lg bg-white/5">
          <p className="text-2xl font-bold text-[#3B82F6]">{hoursSaved}h</p>
          <p className="text-xs text-slate-500">Per week</p>
        </div>
        <div className="p-3 rounded-lg bg-white/5">
          <p className="text-2xl font-bold text-[#8B5CF6]">{yearlyHours}h</p>
          <p className="text-xs text-slate-500">Per year</p>
        </div>
        <div className="p-3 rounded-lg bg-emerald-500/10">
          <p className="text-2xl font-bold text-emerald-400">{weeksReclaimed}</p>
          <p className="text-xs text-slate-500">Weeks back</p>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-4">
        Based on 80% automation of repetitive outreach tasks
      </p>
    </div>
  );
}
