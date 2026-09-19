'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface TutorialProgressProps {
  totalSteps: number;
  currentStep: number;
  completedSteps: number[];
  variant?: 'dots' | 'bar' | 'numbered';
  onStepClick?: (step: number) => void;
  className?: string;
}

export function TutorialProgress({
  totalSteps,
  currentStep,
  completedSteps,
  variant = 'dots',
  onStepClick,
  className,
}: TutorialProgressProps) {
  const progressPercent = ((currentStep + 1) / totalSteps) * 100;

  if (variant === 'bar') {
    return (
      <div className={cn('space-y-2', className)}>
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Step {currentStep + 1} of {totalSteps}</span>
          <span>{Math.round(progressPercent)}% complete</span>
        </div>
        <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    );
  }

  if (variant === 'numbered') {
    return (
      <div className={cn('flex items-center justify-center gap-2', className)}>
        {Array.from({ length: totalSteps }).map((_, index) => {
          const isComplete = completedSteps.includes(index);
          const isCurrent = index === currentStep;
          const isPast = index < currentStep;

          return (
            <button
              key={index}
              onClick={() => onStepClick?.(index)}
              disabled={!onStepClick}
              className={cn(
                'relative flex items-center justify-center w-8 h-8 rounded-full text-xs font-medium transition-all duration-200',
                isCurrent && 'bg-[var(--accent-blue)] text-white scale-110 shadow-lg shadow-[var(--accent-blue)]/30',
                isComplete && !isCurrent && 'bg-[var(--color-success)] text-white',
                isPast && !isComplete && 'bg-[var(--accent-purple)]/30 text-[var(--accent-purple)]',
                !isCurrent && !isComplete && !isPast && 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
                onStepClick && 'cursor-pointer hover:scale-105'
              )}
              aria-label={`Step ${index + 1}${isComplete ? ' (completed)' : ''}${isCurrent ? ' (current)' : ''}`}
            >
              {isComplete && !isCurrent ? (
                <Check className="w-4 h-4" />
              ) : (
                index + 1
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Default: dots variant
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      {Array.from({ length: totalSteps }).map((_, index) => {
        const isComplete = completedSteps.includes(index);
        const isCurrent = index === currentStep;
        const isPast = index < currentStep;

        return (
          <button
            key={index}
            onClick={() => onStepClick?.(index)}
            disabled={!onStepClick}
            className={cn(
              'relative transition-all duration-300 ease-out rounded-full',
              isCurrent ? 'w-8 h-2.5' : 'w-2.5 h-2.5',
              isCurrent && 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]',
              isComplete && !isCurrent && 'bg-[var(--color-success)]',
              isPast && !isComplete && 'bg-[var(--accent-purple)]',
              !isCurrent && !isComplete && !isPast && 'bg-[var(--bg-tertiary)] hover:bg-[var(--text-muted)]',
              onStepClick && 'cursor-pointer'
            )}
            aria-label={`Step ${index + 1}${isComplete ? ' (completed)' : ''}${isCurrent ? ' (current)' : ''}`}
          />
        );
      })}
    </div>
  );
}
