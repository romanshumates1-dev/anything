'use client';

import { useState } from 'react';
import { ArrowRight, Quote, ChevronDown } from 'lucide-react';
import Link from 'next/link';

interface CaseStudyMetric {
  label: string;
  before: string;
  after: string;
  improvement?: string;
}

interface CaseStudyData {
  id: string;
  title: string;
  subtitle: string;
  industry?: string;
  location?: string;
  challenge: string;
  solution: string;
  results: string;
  quote?: string;
  personName?: string;
  personRole?: string;
  metrics: CaseStudyMetric[];
  timeframe?: string;
  verified?: boolean;
}

interface CaseStudyCardProps {
  caseStudy: CaseStudyData;
  variant?: 'default' | 'compact' | 'expanded';
  className?: string;
}

/**
 * CaseStudyCard - Display customer success stories
 *
 * Ethical guidelines:
 * - Only use real case studies with customer permission
 * - Include specific, verifiable metrics
 * - Note timeframes for results
 * - Mark if results are atypical
 */
export function CaseStudyCard({
  caseStudy,
  variant = 'default',
  className = '',
}: CaseStudyCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (variant === 'compact') {
    return (
      <div className={`rounded-xl border border-white/10 bg-[#1E293B]/30 p-5 ${className}`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h4 className="font-semibold text-white">{caseStudy.title}</h4>
            <p className="text-sm text-slate-500">
              {caseStudy.location} | {caseStudy.timeframe}
            </p>
          </div>
          {caseStudy.verified && (
            <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full">
              Verified
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {caseStudy.metrics.slice(0, 3).map((metric, i) => (
            <div key={i} className="text-center p-2 rounded-lg bg-white/5">
              <p className="text-lg font-bold text-emerald-400">{metric.after}</p>
              <p className="text-xs text-slate-500">{metric.label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'expanded') {
    return (
      <div className={`rounded-2xl border border-white/10 bg-[#1E293B]/50 overflow-hidden ${className}`}>
        <div className="bg-gradient-to-r from-[#3B82F6]/10 to-[#8B5CF6]/10 p-6 border-b border-white/10">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-white">{caseStudy.title}</h3>
              <p className="text-slate-400 mt-1">{caseStudy.subtitle}</p>
              <div className="flex items-center gap-4 mt-3 text-sm text-slate-500">
                {caseStudy.location && <span>{caseStudy.location}</span>}
                {caseStudy.timeframe && <span>Results in {caseStudy.timeframe}</span>}
              </div>
            </div>
            {caseStudy.verified && (
              <span className="text-xs bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-full border border-emerald-500/20">
                Verified Results
              </span>
            )}
          </div>
        </div>

        <div className="p-6">
          {/* Metrics Before/After */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {caseStudy.metrics.map((metric, i) => (
              <div key={i} className="rounded-xl bg-white/5 p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">{metric.label}</p>
                <div className="flex items-end gap-2">
                  <div>
                    <p className="text-xs text-slate-600">Before</p>
                    <p className="text-lg text-slate-400 line-through">{metric.before}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-600 mb-1" />
                  <div>
                    <p className="text-xs text-emerald-500">After</p>
                    <p className="text-2xl font-bold text-emerald-400">{metric.after}</p>
                  </div>
                </div>
                {metric.improvement && (
                  <p className="text-xs text-emerald-400 mt-2">{metric.improvement}</p>
                )}
              </div>
            ))}
          </div>

          {/* Story sections */}
          <div className="space-y-6">
            <div>
              <h4 className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider mb-2">
                The Challenge
              </h4>
              <p className="text-slate-300 leading-relaxed">{caseStudy.challenge}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider mb-2">
                The Solution
              </h4>
              <p className="text-slate-300 leading-relaxed">{caseStudy.solution}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-emerald-400 uppercase tracking-wider mb-2">
                The Results
              </h4>
              <p className="text-slate-300 leading-relaxed">{caseStudy.results}</p>
            </div>
          </div>

          {/* Quote */}
          {caseStudy.quote && (
            <div className="mt-8 p-6 rounded-xl bg-gradient-to-br from-[#3B82F6]/5 to-[#8B5CF6]/5 border border-white/5">
              <Quote className="h-6 w-6 text-[#3B82F6]/30 mb-3" />
              <p className="text-lg text-slate-200 italic leading-relaxed">
                "{caseStudy.quote}"
              </p>
              {caseStudy.personName && (
                <p className="mt-4 text-sm text-slate-400">
                  <span className="text-white font-medium">{caseStudy.personName}</span>
                  {caseStudy.personRole && `, ${caseStudy.personRole}`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default variant with expand toggle
  return (
    <div className={`rounded-2xl border border-white/10 bg-[#1E293B]/30 overflow-hidden ${className}`}>
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">{caseStudy.title}</h3>
            <p className="text-sm text-slate-400">{caseStudy.subtitle}</p>
          </div>
          {caseStudy.verified && (
            <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full">
              Verified
            </span>
          )}
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {caseStudy.metrics.map((metric, i) => (
            <div key={i} className="text-center p-3 rounded-lg bg-white/5">
              <p className="text-xl font-bold text-emerald-400">{metric.after}</p>
              <p className="text-xs text-slate-500">{metric.label}</p>
            </div>
          ))}
        </div>

        {/* Expandable content */}
        {isExpanded && (
          <div className="pt-4 border-t border-white/10 space-y-4 animate-in fade-in slide-in-from-top-2">
            <div>
              <p className="text-xs text-[#3B82F6] uppercase mb-1">Challenge</p>
              <p className="text-sm text-slate-400">{caseStudy.challenge}</p>
            </div>
            <div>
              <p className="text-xs text-emerald-400 uppercase mb-1">Results</p>
              <p className="text-sm text-slate-300">{caseStudy.results}</p>
            </div>
            {caseStudy.quote && (
              <blockquote className="text-sm text-slate-300 italic border-l-2 border-[#3B82F6]/50 pl-4">
                "{caseStudy.quote}"
                {caseStudy.personName && (
                  <span className="block text-slate-500 mt-1 not-italic">
                    - {caseStudy.personName}
                  </span>
                )}
              </blockquote>
            )}
          </div>
        )}

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-4 flex items-center gap-2 text-sm text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
        >
          {isExpanded ? 'Show less' : 'Read full story'}
          <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}

/**
 * Case studies must come from real, consented customers.
 *
 * WHY THE SAMPLE DATA WAS DELETED (2026-09-30)
 * -------------------------------------------
 * This file previously exported `SAMPLE_CASE_STUDIES`: three invented customer
 * stories ("Marcus Johnson, Atlanta, $32K profit", "Sarah Chen, Phoenix",
 * "David Williams, Houston") with specific quotes, earnings figures and
 * before/after metrics - and the invented Marcus entry was flagged
 * `verified: true`, which asserted a verification that never happened.
 *
 * `CaseStudySection` DEFAULTED to that array and rendered it under the heading
 * "Real Results from Real Investors" with a "Get Results Like These" CTA. The
 * component was not yet mounted on a page, so nothing was published - but it
 * was exported from the marketing barrel and one prop-drop away from shipping
 * fabricated earnings claims to the public.
 *
 * A default is a decision. Defaulting a marketing gallery to invented customer
 * results means the first person to mount it publishes fabrications without
 * intending to. The component now renders an honest empty state instead, and
 * requires real data to be passed in explicitly.
 */
const NO_CASE_STUDIES: CaseStudyData[] = [];

/**
 * CaseStudySection - Display multiple case studies
 */
interface CaseStudySectionProps {
  caseStudies?: CaseStudyData[];
  title?: string;
  subtitle?: string;
  showCTA?: boolean;
  className?: string;
}

export function CaseStudySection({
  caseStudies = NO_CASE_STUDIES,
  title = 'Real Results from Real Investors',
  subtitle = 'See how others are using DealFlow AI to close more deals',
  showCTA = true,
  className = '',
}: CaseStudySectionProps) {
  // With no real customer data to show, the section renders nothing at all.
  // Publishing the heading alone would promise results that do not exist.
  if (caseStudies.length === 0) return null;

  return (
    <div className={className}>
      {title && (
        <div className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">{title}</h2>
          {subtitle && <p className="text-slate-400 max-w-2xl mx-auto">{subtitle}</p>}
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {caseStudies.map((cs) => (
          <CaseStudyCard key={cs.id} caseStudy={cs} />
        ))}
      </div>

      {showCTA && (
        <div className="text-center mt-10">
          <Link
            href="/account/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] px-6 py-3 text-base font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
          >
            Get Results Like These
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-xs text-slate-600 mt-3">
            Results vary. These are real customers but may not represent typical results.
          </p>
        </div>
      )}
    </div>
  );
}
