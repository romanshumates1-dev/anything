'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight, ExternalLink, Play } from 'lucide-react';
import Link from 'next/link';

interface LearnMoreItem {
  title: string;
  content: string;
}

export interface TutorialStepData {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  highlight?: string;
  href?: string;
  actionLabel?: string;
  details?: string[];
  learnMore?: LearnMoreItem[];
  videoUrl?: string;
}

interface TutorialStepProps {
  step: TutorialStepData;
  isAnimating?: boolean;
  slideDirection?: 'left' | 'right';
  onAction?: () => void;
  showActionButton?: boolean;
  className?: string;
}

export function TutorialStep({
  step,
  isAnimating = false,
  slideDirection = 'right',
  onAction,
  showActionButton = false,
  className,
}: TutorialStepProps) {
  const [expandedLearnMore, setExpandedLearnMore] = useState<number | null>(null);
  const StepIcon = step.icon;

  return (
    <div
      className={cn(
        'transition-all duration-150 ease-out',
        isAnimating && slideDirection === 'right' && 'opacity-0 translate-x-4',
        isAnimating && slideDirection === 'left' && 'opacity-0 -translate-x-4',
        !isAnimating && 'opacity-100 translate-x-0',
        className
      )}
    >
      {/* Icon */}
      <div className="flex justify-center mb-6">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-2xl blur-xl opacity-40" />
          <div className="relative p-4 rounded-2xl bg-gradient-to-r from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 border border-[var(--border-subtle)]">
            <StepIcon className="w-12 h-12 text-[var(--accent-blue)]" />
          </div>
        </div>
      </div>

      {/* Title and description */}
      <div className="text-center space-y-3">
        <h2 className="text-2xl font-bold text-[var(--text-primary)]">{step.title}</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">{step.description}</p>
      </div>

      {/* Highlight badge - navigation hint */}
      {step.highlight && (
        <div className="flex justify-center mt-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] text-sm font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)] animate-pulse" />
            Find this in the sidebar: {step.highlight}
          </div>
        </div>
      )}

      {/* Video preview (if available) */}
      {step.videoUrl && (
        <div className="mt-6">
          <button
            onClick={() => window.open(step.videoUrl, '_blank')}
            className="w-full p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--accent-blue)]/50 transition-all group flex items-center justify-center gap-3"
          >
            <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10 group-hover:bg-[var(--accent-blue)]/20 transition-colors">
              <Play className="w-5 h-5 text-[var(--accent-blue)]" />
            </div>
            <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
              Watch video tutorial
            </span>
          </button>
        </div>
      )}

      {/* Key details list */}
      {step.details && step.details.length > 0 && (
        <div className="mt-6 space-y-2">
          {step.details.map((detail, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]/50 text-left"
            >
              <div className="w-5 h-5 rounded-full bg-[var(--accent-blue)]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ChevronRight className="w-3 h-3 text-[var(--accent-blue)]" />
              </div>
              <span className="text-sm text-[var(--text-secondary)]">{detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Learn more expandable sections */}
      {step.learnMore && step.learnMore.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Learn More
          </p>
          {step.learnMore.map((item, index) => (
            <div
              key={index}
              className="rounded-lg border border-[var(--border-subtle)] overflow-hidden"
            >
              <button
                onClick={() => setExpandedLearnMore(expandedLearnMore === index ? null : index)}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--bg-tertiary)]/50 transition-colors"
              >
                <span className="text-sm font-medium text-[var(--text-primary)]">{item.title}</span>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-[var(--text-muted)] transition-transform duration-200',
                    expandedLearnMore === index && 'rotate-180'
                  )}
                />
              </button>
              {expandedLearnMore === index && (
                <div className="px-3 pb-3 pt-0">
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {item.content}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Action button */}
      {showActionButton && step.href && (
        <div className="mt-6 flex justify-center">
          <Link href={step.href}>
            <Button
              onClick={onAction}
              className="gap-2 btn-gradient border-0"
            >
              {step.actionLabel || 'Go to ' + step.title}
              <ExternalLink className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
