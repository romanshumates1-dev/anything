'use client';

import { useState, useEffect, useCallback } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import {
  LayoutDashboard,
  Megaphone,
  Search,
  FileText,
  BarChart3,
  Users,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
} from 'lucide-react';

const ONBOARDING_KEY = 'onboarding_completed';

interface TutorialStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  highlight?: string;
}

const tutorialSteps: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to DealFlow AI',
    description:
      'Your AI-powered real estate wholesaling platform. Let us show you around the key features that will help you close more deals.',
    icon: Sparkles,
  },
  {
    id: 'dashboard',
    title: 'Your Dashboard',
    description:
      'Get a bird\'s-eye view of your pipeline value, active leads, response rates, and deals. Track your KPIs and system health at a glance.',
    icon: LayoutDashboard,
    highlight: 'Dashboard',
  },
  {
    id: 'campaigns',
    title: 'Campaign Management',
    description:
      'Launch multi-touch outreach campaigns with AI-generated messages. Reach motivated sellers via SMS and email with automated follow-ups.',
    icon: Megaphone,
    highlight: 'Campaigns',
  },
  {
    id: 'lead-finder',
    title: 'Lead Finder',
    description:
      'Discover motivated sellers using our AI-powered lead discovery. Filter by property type, equity, tax status, and more.',
    icon: Search,
    highlight: 'Lead Finder',
  },
  {
    id: 'contracts',
    title: 'Contract Management',
    description:
      'Generate, send, and track contracts with e-signature integration. Manage your deals from offer to close in one place.',
    icon: FileText,
    highlight: 'Contracts',
  },
  {
    id: 'crm',
    title: 'CRM & Pipeline',
    description:
      'Manage your leads through every stage of the deal. Track conversations, schedule follow-ups, and never miss an opportunity.',
    icon: Users,
    highlight: 'CRM',
  },
  {
    id: 'analytics',
    title: 'Analytics & Reports',
    description:
      'Track your performance with detailed analytics. Monitor campaign ROI, conversion rates, and optimize your outreach strategy.',
    icon: BarChart3,
    highlight: 'Analytics',
  },
];

interface OnboardingTutorialProps {
  onComplete?: () => void;
  forceShow?: boolean;
}

export function OnboardingTutorial({ onComplete, forceShow = false }: OnboardingTutorialProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');

  useEffect(() => {
    // Check if onboarding has been completed
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!completed || forceShow) {
      setIsVisible(true);
    }
  }, [forceShow]);

  const completeOnboarding = useCallback(async () => {
    // Save to localStorage
    localStorage.setItem(ONBOARDING_KEY, new Date().toISOString());

    // Optionally save to user profile via API
    try {
      await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_completed: true }),
      });
    } catch {
      // Silently fail - localStorage is the primary storage
    }

    setIsVisible(false);
    onComplete?.();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (isAnimating) return;

    if (currentStep < tutorialSteps.length - 1) {
      setIsAnimating(true);
      setSlideDirection('right');
      setTimeout(() => {
        setCurrentStep((prev) => prev + 1);
        setIsAnimating(false);
      }, 150);
    } else {
      completeOnboarding();
    }
  }, [currentStep, isAnimating, completeOnboarding]);

  const handlePrevious = useCallback(() => {
    if (isAnimating || currentStep === 0) return;

    setIsAnimating(true);
    setSlideDirection('left');
    setTimeout(() => {
      setCurrentStep((prev) => prev - 1);
      setIsAnimating(false);
    }, 150);
  }, [currentStep, isAnimating]);

  const handleSkip = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isVisible) return;

      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrevious();
      } else if (e.key === 'Escape') {
        handleSkip();
      }
    },
    [isVisible, handleNext, handlePrevious, handleSkip]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isVisible) return null;

  const step = tutorialSteps[currentStep];
  const StepIcon = step.icon;
  const isLastStep = currentStep === tutorialSteps.length - 1;
  const isFirstStep = currentStep === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300"
        onClick={handleSkip}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4">
        <GlassCard
          variant="elevated"
          padding="none"
          className="overflow-hidden border border-[var(--border-medium)]"
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)] animate-pulse" />
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                Step {currentStep + 1} of {tutorialSteps.length}
              </span>
            </div>
            <button
              onClick={handleSkip}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              aria-label="Skip tutorial"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="px-6 pb-4">
            <div className="h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full transition-all duration-300 ease-out"
                style={{ width: `${((currentStep + 1) / tutorialSteps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Content */}
          <div
            className={`px-6 pb-4 transition-all duration-150 ease-out ${
              isAnimating
                ? slideDirection === 'right'
                  ? 'opacity-0 translate-x-4'
                  : 'opacity-0 -translate-x-4'
                : 'opacity-100 translate-x-0'
            }`}
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
              {step.highlight && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] text-sm font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
                  Find this in the sidebar: {step.highlight}
                </div>
              )}
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex justify-center gap-2 pb-4">
            {tutorialSteps.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  if (!isAnimating && index !== currentStep) {
                    setIsAnimating(true);
                    setSlideDirection(index > currentStep ? 'right' : 'left');
                    setTimeout(() => {
                      setCurrentStep(index);
                      setIsAnimating(false);
                    }, 150);
                  }
                }}
                className={`w-2 h-2 rounded-full transition-all duration-200 ${
                  index === currentStep
                    ? 'w-6 bg-[var(--accent-blue)]'
                    : index < currentStep
                    ? 'bg-[var(--accent-purple)]'
                    : 'bg-[var(--bg-tertiary)] hover:bg-[var(--text-muted)]'
                }`}
                aria-label={`Go to step ${index + 1}`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 bg-[var(--bg-tertiary)]/50 border-t border-[var(--border-subtle)]">
            <button
              onClick={handleSkip}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Skip tutorial
            </button>

            <div className="flex items-center gap-3">
              {!isFirstStep && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevious}
                  disabled={isAnimating}
                  className="gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleNext}
                disabled={isAnimating}
                className="gap-1 btn-gradient border-0"
              >
                {isLastStep ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Get Started
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </GlassCard>

        {/* Keyboard hint */}
        <div className="mt-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">
            Use arrow keys to navigate, Enter to continue, Esc to skip
          </p>
        </div>
      </div>
    </div>
  );
}

// Utility function to reset onboarding (useful for testing)
export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY);
}

// Utility function to check if onboarding is completed
export function isOnboardingCompleted(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(ONBOARDING_KEY) !== null;
}
