'use client';

import {
  Clock,
  TrendingDown,
  Home,
  AlertTriangle,
  Users,
  MessageSquare,
  DollarSign,
  Target,
  Lightbulb,
  ExternalLink,
} from 'lucide-react';

interface IndustryFact {
  id: string;
  stat: string;
  description: string;
  source?: string;
  sourceUrl?: string;
  icon: 'time' | 'decline' | 'housing' | 'warning' | 'users' | 'messages' | 'money' | 'target';
}

interface ReasonWhyCardProps {
  fact: IndustryFact;
  variant?: 'default' | 'compact' | 'highlighted';
  className?: string;
}

/**
 * ReasonWhyCard - Display industry facts and statistics
 *
 * Ethical guidelines:
 * - Only use real, verifiable statistics
 * - Always cite sources
 * - Use recent data (< 2 years old)
 * - Link to original sources when possible
 */

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  time: Clock,
  decline: TrendingDown,
  housing: Home,
  warning: AlertTriangle,
  users: Users,
  messages: MessageSquare,
  money: DollarSign,
  target: Target,
};

export function ReasonWhyCard({
  fact,
  variant = 'default',
  className = '',
}: ReasonWhyCardProps) {
  const Icon = ICONS[fact.icon] || Lightbulb;

  if (variant === 'compact') {
    return (
      <div className={`flex items-start gap-3 ${className}`}>
        <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4 text-[#3B82F6]" />
        </div>
        <div>
          <p className="text-white font-semibold">{fact.stat}</p>
          <p className="text-sm text-slate-400">{fact.description}</p>
        </div>
      </div>
    );
  }

  if (variant === 'highlighted') {
    return (
      <div
        className={`relative rounded-2xl border border-[#3B82F6]/30 bg-gradient-to-br from-[#3B82F6]/10 to-[#8B5CF6]/10 p-6 ${className}`}
      >
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-[#3B82F6]/20">
            <Icon className="h-6 w-6 text-[#3B82F6]" />
          </div>
          <div className="flex-1">
            <p className="text-2xl font-bold text-white mb-2">{fact.stat}</p>
            <p className="text-slate-300 leading-relaxed">{fact.description}</p>
            {fact.source && (
              <p className="text-xs text-slate-500 mt-3 flex items-center gap-1">
                Source: {fact.source}
                {fact.sourceUrl && (
                  <a
                    href={fact.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#3B82F6] hover:underline inline-flex items-center gap-0.5"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div className={`rounded-xl border border-white/10 bg-[#1E293B]/30 p-5 ${className}`}>
      <div className="flex items-start gap-4">
        <div className="p-2 rounded-lg bg-[#3B82F6]/10">
          <Icon className="h-5 w-5 text-[#3B82F6]" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">{fact.stat}</p>
          <p className="text-sm text-slate-400 mt-1">{fact.description}</p>
          {fact.source && (
            <p className="text-xs text-slate-600 mt-2 flex items-center gap-1">
              Source: {fact.source}
              {fact.sourceUrl && (
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#3B82F6]/70 hover:text-[#3B82F6]"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pre-defined industry facts with sources
 * All statistics should be verified and sourced
 */
export const INDUSTRY_FACTS: IndustryFact[] = [
  {
    id: 'time-spent',
    stat: '4-6 hours daily',
    description: 'Average time real estate investors spend on manual outreach and follow-ups with property owners',
    source: 'BiggerPockets 2023 Survey',
    icon: 'time',
  },
  {
    id: 'response-delay',
    stat: '80% conversion drop',
    description: 'Your chance of closing drops by 80% when you take more than 5 minutes to respond',
    source: 'Harvard Business Review',
    sourceUrl: 'https://hbr.org/2011/03/the-short-life-of-online-sales-leads',
    icon: 'decline',
  },
  {
    id: 'housing-shortage',
    stat: '3.8M unit shortage',
    description: 'The US faces a housing shortage of 3.8 million units, creating huge demand for investment properties',
    source: 'Freddie Mac 2024',
    icon: 'housing',
  },
  {
    id: 'follow-up-stats',
    stat: '80% need 5+ messages',
    description: 'Most property owners need at least 5 follow-up messages before they respond, but 44% of investors give up after one',
    source: 'Marketing Donut',
    icon: 'messages',
  },
  {
    id: 'speed-to-lead',
    stat: '7x higher contact rate',
    description: 'Responding within 5 minutes makes you 7x more likely to connect with the property owner',
    source: 'InsideSales.com',
    icon: 'target',
  },
  {
    id: 'distressed-growth',
    stat: '23% annual growth',
    description: 'Opportunities to buy below-market properties from owners who need to sell fast are growing year-over-year',
    source: 'ATTOM Data Solutions',
    icon: 'money',
  },
];

/**
 * IndustryFactsSection - Display multiple facts in a grid
 */
interface IndustryFactsSectionProps {
  facts?: IndustryFact[];
  title?: string;
  subtitle?: string;
  columns?: 2 | 3;
  className?: string;
}

export function IndustryFactsSection({
  facts = INDUSTRY_FACTS.slice(0, 4),
  title = 'Why Speed Matters in Real Estate',
  subtitle = 'Industry research shows that response time is the #1 factor in lead conversion',
  columns = 2,
  className = '',
}: IndustryFactsSectionProps) {
  return (
    <div className={className}>
      {title && (
        <div className="text-center mb-10">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">{title}</h2>
          {subtitle && <p className="text-slate-400 max-w-2xl mx-auto">{subtitle}</p>}
        </div>
      )}
      <div className={`grid md:grid-cols-${columns} gap-4`}>
        {facts.map((fact) => (
          <ReasonWhyCard key={fact.id} fact={fact} />
        ))}
      </div>
    </div>
  );
}

/**
 * ProblemSolutionBlock - Before/After comparison
 */
interface ProblemSolutionBlockProps {
  className?: string;
}

export function ProblemSolutionBlock({ className = '' }: ProblemSolutionBlockProps) {
  const problems = [
    'Spending 4-6 hours daily texting and calling property owners',
    'Missing interested owners because you can\'t respond fast enough',
    'Losing deals to faster competitors',
    'Struggling to track conversations with dozens of property owners',
  ];

  const solutions = [
    'AI sends messages and follows up automatically',
    'Instant responses 24/7, even while you sleep',
    'Beat competitors with responses in under a minute',
    'One dashboard to manage all your conversations',
  ];

  return (
    <div className={`grid md:grid-cols-2 gap-8 ${className}`}>
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-4">Without DealFlow AI</h3>
        <ul className="space-y-3">
          {problems.map((problem, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-red-400 text-xs">x</span>
              </div>
              <span className="text-slate-400">{problem}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
        <h3 className="text-lg font-semibold text-emerald-400 mb-4">With DealFlow AI</h3>
        <ul className="space-y-3">
          {solutions.map((solution, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-emerald-400 text-xs">&#10003;</span>
              </div>
              <span className="text-slate-300">{solution}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
