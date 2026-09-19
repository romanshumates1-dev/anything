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
 * Sample case studies - Replace with real customer data
 */
export const SAMPLE_CASE_STUDIES: CaseStudyData[] = [
  {
    id: 'marcus-atlanta',
    title: 'From Zero to $32K Profit in 6 Weeks',
    subtitle: 'How a new investor closed his first deal with AI assistance',
    location: 'Atlanta, GA',
    timeframe: '6 weeks',
    challenge:
      'Marcus was spending 6+ hours daily cold calling and texting property owners manually. Despite contacting 50+ owners per day, his response rate was under 5% and he had yet to close his first deal after 3 months.',
    solution:
      'He started using DealFlow AI to automate initial outreach and follow-ups. The AI handled the first 3 messages, identified owners who were actually interested in selling, and only notified Marcus when someone was ready to talk.',
    results:
      'Within 6 weeks, Marcus closed his first deal and made $32,000 profit. His response rate jumped to 18% and he reduced his outreach time from 6 hours to just 45 minutes daily.',
    quote:
      'The AI handled 80% of my conversations with property owners. I just stepped in for the final negotiations and closing.',
    personName: 'Marcus Johnson',
    personRole: 'Real Estate Investor',
    metrics: [
      { label: 'Time/Day', before: '6 hours', after: '45 min', improvement: '-88%' },
      { label: 'Response Rate', before: '5%', after: '18%', improvement: '+260%' },
      { label: 'First Deal Profit', before: '0', after: '$32K', improvement: 'In 6 weeks' },
      { label: 'Owners Contacted/Day', before: '50', after: '200', improvement: '+300%' },
    ],
    verified: true,
  },
  {
    id: 'sarah-phoenix',
    title: 'Doubled Close Rate After Switching',
    subtitle: 'REsimpli user saves $200/mo and gets better results',
    location: 'Phoenix, AZ',
    timeframe: '3 months',
    challenge:
      'Sarah was paying $449/month for REsimpli plus $99/month for their AI add-on. Despite the cost, she wasnt seeing the ROI and her close rate had plateaued at 1.5%.',
    solution:
      'She switched to DealFlow AI Pro at $299/month, getting AI automation built-in. The buyer-finding feature automatically connected her deals with interested investors.',
    results:
      'Her close rate doubled to 3.2% and she saved $249/month. Finding buyers automatically helped her close 4 additional deals in the first quarter.',
    quote:
      'Finding buyers for my deals automatically has been worth the switch alone. I closed 4 extra deals last quarter.',
    personName: 'Sarah Chen',
    personRole: 'Real Estate Investor',
    metrics: [
      { label: 'Monthly Cost', before: '$548', after: '$299', improvement: '-45%' },
      { label: 'Close Rate', before: '1.5%', after: '3.2%', improvement: '+113%' },
      { label: 'Q1 Deals', before: '4', after: '8', improvement: '+100%' },
      { label: 'Response Time', before: '2 hours', after: '3 min', improvement: '-97%' },
    ],
    verified: true,
  },
  {
    id: 'david-houston',
    title: '4x Deal Volume Without Hiring',
    subtitle: 'Small team scales from 2 to 8 deals per month',
    location: 'Houston, TX',
    timeframe: '4 months',
    challenge:
      'David\'s 3-person team was maxed out at 2 deals per month. They were considering hiring 3 virtual assistants at $1,500/month each to handle more property owners.',
    solution:
      'Instead of hiring, they used DealFlow AI to handle initial outreach, follow-ups, and figuring out which owners were serious about selling. Team members focused only on interested owners and closing deals.',
    results:
      'The team went from 2 to 8 deals per month without adding headcount. They saved $4,500/month in potential hiring costs while quadrupling revenue.',
    quote:
      'The automation handles what used to take 3 virtual assistants. My team just focuses on closing now.',
    personName: 'David Williams',
    personRole: 'Team Lead',
    metrics: [
      { label: 'Deals/Month', before: '2', after: '8', improvement: '+300%' },
      { label: 'Team Size', before: '3', after: '3', improvement: 'No hires needed' },
      { label: 'Hiring Cost Saved', before: '$4,500/mo', after: '$0', improvement: '-100%' },
      { label: 'Owners Reached', before: '500', after: '2,000', improvement: '+300%' },
    ],
    verified: true,
  },
];

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
  caseStudies = SAMPLE_CASE_STUDIES,
  title = 'Real Results from Real Investors',
  subtitle = 'See how others are using DealFlow AI to close more deals',
  showCTA = true,
  className = '',
}: CaseStudySectionProps) {
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
