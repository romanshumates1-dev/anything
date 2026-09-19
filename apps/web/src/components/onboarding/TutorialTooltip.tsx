'use client';

import { ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HelpCircle, X, ChevronRight, Lightbulb } from 'lucide-react';

interface TutorialTooltipProps {
  title: string;
  content: string;
  learnMoreHref?: string;
  variant?: 'inline' | 'icon' | 'spotlight';
  side?: 'top' | 'right' | 'bottom' | 'left';
  children?: ReactNode;
  className?: string;
}

export function TutorialTooltip({
  title,
  content,
  learnMoreHref,
  variant = 'icon',
  side = 'top',
  children,
  className,
}: TutorialTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Inline variant: wraps children with tooltip
  if (variant === 'inline' && children) {
    return (
      <TooltipProvider>
        <Tooltip open={isOpen} onOpenChange={setIsOpen}>
          <TooltipTrigger asChild>
            <span className={cn('cursor-help border-b border-dashed border-[var(--text-muted)]', className)}>
              {children}
            </span>
          </TooltipTrigger>
          <TooltipContent
            side={side}
            className="max-w-xs bg-[var(--bg-secondary)] border border-[var(--border-medium)] p-3"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-[var(--accent-blue)]" />
                <span className="font-semibold text-[var(--text-primary)] text-sm">{title}</span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{content}</p>
              {learnMoreHref && (
                <a
                  href={learnMoreHref}
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Learn more <ChevronRight className="w-3 h-3" />
                </a>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Spotlight variant: prominent help indicator with animation
  if (variant === 'spotlight') {
    return (
      <TooltipProvider>
        <Tooltip open={isOpen} onOpenChange={setIsOpen}>
          <TooltipTrigger asChild>
            <button
              className={cn(
                'relative p-1.5 rounded-full bg-[var(--accent-blue)]/10 hover:bg-[var(--accent-blue)]/20 transition-colors',
                className
              )}
              aria-label={`Help: ${title}`}
            >
              <HelpCircle className="w-4 h-4 text-[var(--accent-blue)]" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[var(--accent-blue)] rounded-full animate-ping opacity-75" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[var(--accent-blue)] rounded-full" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side={side}
            className="max-w-sm bg-[var(--bg-secondary)] border border-[var(--border-medium)] p-4 shadow-xl"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-[var(--accent-blue)]/10">
                    <Lightbulb className="w-4 h-4 text-[var(--accent-blue)]" />
                  </div>
                  <span className="font-semibold text-[var(--text-primary)] text-sm">{title}</span>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{content}</p>
              {learnMoreHref && (
                <a
                  href={learnMoreHref}
                  className="inline-flex items-center gap-1 text-sm text-[var(--accent-blue)] hover:underline font-medium"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View documentation <ChevronRight className="w-4 h-4" />
                </a>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Default: icon variant - simple question mark icon
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              'p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors',
              className
            )}
            aria-label={`Help: ${title}`}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-xs bg-[var(--bg-secondary)] border border-[var(--border-medium)] p-3"
        >
          <div className="space-y-2">
            <span className="font-semibold text-[var(--text-primary)] text-sm">{title}</span>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{content}</p>
            {learnMoreHref && (
              <a
                href={learnMoreHref}
                className="inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn more <ChevronRight className="w-3 h-3" />
              </a>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Pre-configured tooltips for common features
export const TUTORIAL_TOOLTIPS = {
  pipelineValue: {
    title: 'Pipeline Value',
    content: 'Total estimated value of all deals currently in your pipeline. This includes leads at various stages from initial contact to pending contracts.',
  },
  responseRate: {
    title: 'Response Rate',
    content: 'Percentage of leads who have responded to your outreach messages. A higher rate indicates effective messaging and targeting.',
  },
  leadScore: {
    title: 'Lead Score',
    content: 'AI-calculated score based on property characteristics, owner motivation signals, and response patterns. Higher scores indicate more promising opportunities.',
  },
  campaignThrottle: {
    title: 'Message Throttle',
    content: 'Controls how many messages are sent per minute to avoid carrier blocking and maintain deliverability. Recommended: 10-20 per minute.',
  },
  dailyCap: {
    title: 'Daily Cap',
    content: 'Maximum number of messages sent per day. Helps manage costs and ensures compliance with carrier limits.',
  },
  complianceFooter: {
    title: 'Compliance Footer',
    content: 'Required opt-out instructions automatically added to messages. This is legally required under TCPA regulations.',
  },
  contractEsign: {
    title: 'E-Signature',
    content: 'Legally binding electronic signatures. Recipients can sign contracts directly from their email or SMS link.',
  },
  aiConfidence: {
    title: 'AI Confidence',
    content: 'How confident the AI is in its lead classification. Low confidence leads may need manual review.',
  },
};
