'use client';

import { useState, useEffect, useCallback } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { TutorialProgress } from './TutorialProgress';
import { TutorialStep, TutorialStepData } from './TutorialStep';
import {
  LayoutDashboard,
  Upload,
  Megaphone,
  Mail,
  BarChart3,
  FileText,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
  Zap,
} from 'lucide-react';

const ONBOARDING_KEY = 'onboarding_completed';
const TUTORIAL_PROGRESS_KEY = 'tutorial_step_progress';

const tutorialSteps: TutorialStepData[] = [
  {
    id: 'welcome',
    title: 'Welcome to DealFlow AI',
    description:
      'Your AI-powered real estate wholesaling platform. We will walk you through the key features that will help you find motivated sellers, automate outreach, and close more deals.',
    icon: Sparkles,
    details: [
      'AI-powered lead discovery and scoring',
      'Automated multi-channel outreach (SMS + Email)',
      'Contract generation with e-signatures',
      'Real-time analytics and performance tracking',
    ],
    learnMore: [
      {
        title: 'What is wholesaling?',
        content: 'Real estate wholesaling involves finding properties under market value, getting them under contract, and assigning that contract to an end buyer for a fee. DealFlow AI automates the most time-consuming parts of this process.',
      },
      {
        title: 'How does the AI work?',
        content: 'Our AI analyzes property data, owner motivation signals, and market conditions to score leads. It also generates personalized outreach messages and handles initial conversations with potential sellers.',
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Your Dashboard',
    description:
      'The dashboard gives you a complete overview of your wholesaling operation. Monitor your pipeline value, active leads, response rates, and closed deals all in one place.',
    icon: LayoutDashboard,
    highlight: 'Dashboard',
    href: '/dashboard',
    actionLabel: 'View Dashboard',
    details: [
      'Pipeline Value: Total estimated deal value in your funnel',
      'Active Leads: Number of leads currently being worked',
      'Response Rate: Percentage of leads who respond to outreach',
      'Deals This Month: Contracts closed in the current period',
    ],
    learnMore: [
      {
        title: 'Understanding your KPIs',
        content: 'Your key performance indicators help you understand the health of your business. A healthy pipeline should show consistent lead flow, improving response rates, and steady deal closings.',
      },
      {
        title: 'System Health monitoring',
        content: 'The system health panel shows the status of all integrated services including database, AI engine, SMS gateway, and job queue. Green means operational, yellow means degraded performance.',
      },
    ],
  },
  {
    id: 'import-leads',
    title: 'Import Your Leads',
    description:
      'Get your leads into the system quickly. You can upload a CSV file with your existing lead list, or manually add leads one at a time. The system automatically deduplicates and enriches your data.',
    icon: Upload,
    highlight: 'CRM',
    href: '/crm?action=import',
    actionLabel: 'Import Leads',
    details: [
      'CSV Upload: Import thousands of leads at once',
      'Manual Entry: Add individual leads with full details',
      'Auto-Deduplication: Prevents duplicate contacts',
      'Data Enrichment: AI fills in missing property details',
    ],
    learnMore: [
      {
        title: 'CSV format requirements',
        content: 'Your CSV should include columns for name, phone or email, and property address. Additional columns like equity percentage, property type, and tax status will improve lead scoring accuracy.',
      },
      {
        title: 'Lead sources',
        content: 'Great lead sources include tax delinquent lists, pre-foreclosure lists, probate filings, absentee owner lists, and driving for dollars. Each source has different motivation levels.',
      },
    ],
  },
  {
    id: 'create-campaign',
    title: 'Create a Campaign',
    description:
      'Campaigns are automated outreach sequences that contact your leads via SMS and email. Choose from proven templates or create custom messages. The AI personalizes each message for maximum response rates.',
    icon: Megaphone,
    highlight: 'Campaigns',
    href: '/campaigns/wizard',
    actionLabel: 'Create Campaign',
    details: [
      'Template Library: Pre-built high-converting message sequences',
      'Custom Messages: Write your own with AI assistance',
      'Multi-Touch Sequences: Automated follow-up messages',
      'Smart Scheduling: Optimal send times for your market',
    ],
    learnMore: [
      {
        title: 'Message compliance',
        content: 'All messages automatically include required opt-out instructions for TCPA compliance. The system tracks opt-outs and suppresses future messages to those contacts.',
      },
      {
        title: 'A/B testing',
        content: 'Test different message variations to see what resonates with your market. The system will automatically favor the better-performing messages over time.',
      },
    ],
  },
  {
    id: 'configure-outreach',
    title: 'Set Up Outreach',
    description:
      'Connect your communication channels to start sending messages. Configure your email domain for better deliverability and set up SMS with verified phone numbers for 10DLC compliance.',
    icon: Mail,
    highlight: 'Settings',
    href: '/admin?tab=outreach',
    actionLabel: 'Configure Outreach',
    details: [
      'Email Setup: Connect AWS SES for high-volume sending',
      'SMS Setup: Configure Twilio with 10DLC registration',
      'Test Numbers: Verify your own phones for testing',
      'Sending Limits: Set daily caps and throttle rates',
    ],
    learnMore: [
      {
        title: 'What is 10DLC?',
        content: '10DLC (10-digit long code) is a registered phone number system for business SMS. Registration improves deliverability and is required by carriers for commercial messaging.',
      },
      {
        title: 'Email deliverability',
        content: 'Using your own domain with proper SPF, DKIM, and DMARC records ensures your emails reach inboxes instead of spam folders. The system guides you through domain verification.',
      },
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics Overview',
    description:
      'Track your campaign performance with detailed analytics. Monitor message delivery, response rates, lead conversion, and ROI across all your campaigns.',
    icon: BarChart3,
    highlight: 'Analytics',
    href: '/analytics',
    actionLabel: 'View Analytics',
    details: [
      'Campaign Performance: Delivery, opens, and responses',
      'Lead Funnel: Conversion rates at each stage',
      'ROI Tracking: Cost per lead and per deal',
      'Market Insights: Best-performing areas and property types',
    ],
    learnMore: [
      {
        title: 'Key metrics to watch',
        content: 'Focus on response rate (target 5-15%), qualified lead rate (leads showing genuine interest), and cost per deal. These metrics tell you if your campaigns are profitable.',
      },
      {
        title: 'Optimization tips',
        content: 'Use analytics to identify winning message templates, optimal send times, and highest-performing lead sources. Continuously refine your approach based on data.',
      },
    ],
  },
  {
    id: 'contracts',
    title: 'Contract Management',
    description:
      'Generate contracts quickly from templates, send them for e-signature, and track their status. From initial offer to signed deal, manage the entire closing process in one place.',
    icon: FileText,
    highlight: 'Contracts',
    href: '/contracts',
    actionLabel: 'View Contracts',
    details: [
      'Template Library: Purchase agreements and assignments',
      'Auto-Fill: Property and seller info filled automatically',
      'E-Signatures: Legally binding electronic signatures',
      'Status Tracking: Monitor pending and completed contracts',
    ],
    learnMore: [
      {
        title: 'Contract types',
        content: 'The two main contracts are the Purchase Agreement (between you and seller) and the Assignment Agreement (between you and your buyer). Templates are customizable to your state.',
      },
      {
        title: 'E-signature legality',
        content: 'Electronic signatures are legally binding under the ESIGN Act and UETA. Recipients can sign from any device, and all signatures are timestamped and stored securely.',
      },
    ],
  },
];

interface OnboardingTutorialProps {
  onComplete?: () => void;
  forceShow?: boolean;
}

export function OnboardingTutorial({ onComplete, forceShow = false }: OnboardingTutorialProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');

  useEffect(() => {
    // Check if onboarding has been completed
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!completed || forceShow) {
      setIsVisible(true);

      // Load previous progress if any
      const savedProgress = localStorage.getItem(TUTORIAL_PROGRESS_KEY);
      if (savedProgress) {
        try {
          const { step, completed: completedArr } = JSON.parse(savedProgress);
          if (typeof step === 'number' && step < tutorialSteps.length) {
            setCurrentStep(step);
          }
          if (Array.isArray(completedArr)) {
            setCompletedSteps(completedArr);
          }
        } catch {
          // Invalid JSON, start fresh
        }
      }
    }
  }, [forceShow]);

  // Save progress on changes
  useEffect(() => {
    if (isVisible) {
      localStorage.setItem(
        TUTORIAL_PROGRESS_KEY,
        JSON.stringify({ step: currentStep, completed: completedSteps })
      );
    }
  }, [currentStep, completedSteps, isVisible]);

  const completeOnboarding = useCallback(async () => {
    // Save to localStorage
    localStorage.setItem(ONBOARDING_KEY, new Date().toISOString());
    localStorage.removeItem(TUTORIAL_PROGRESS_KEY);

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

    // Mark current step as completed
    if (!completedSteps.includes(currentStep)) {
      setCompletedSteps((prev) => [...prev, currentStep]);
    }

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
  }, [currentStep, isAnimating, completedSteps, completeOnboarding]);

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

  // Quick Start: Jump to Import Leads step (step 2, index 2), then to Campaign creation (step 3, index 3)
  const QUICK_START_STEPS = [0, 2, 3]; // welcome, import-leads, create-campaign
  const isQuickStartStep = QUICK_START_STEPS.includes(currentStep);

  const handleQuickStart = useCallback(() => {
    if (isAnimating) return;

    // Mark current step as completed
    if (!completedSteps.includes(currentStep)) {
      setCompletedSteps((prev) => [...prev, currentStep]);
    }

    // Find next quick start step
    const currentQuickIndex = QUICK_START_STEPS.indexOf(currentStep);
    if (currentQuickIndex < QUICK_START_STEPS.length - 1) {
      const nextStep = QUICK_START_STEPS[currentQuickIndex + 1];
      setIsAnimating(true);
      setSlideDirection('right');
      setTimeout(() => {
        setCurrentStep(nextStep);
        setIsAnimating(false);
      }, 150);
    } else {
      // Completed quick start path
      completeOnboarding();
    }
  }, [currentStep, isAnimating, completedSteps, completeOnboarding]);

  const handleStepClick = useCallback((stepIndex: number) => {
    if (isAnimating || stepIndex === currentStep) return;

    setIsAnimating(true);
    setSlideDirection(stepIndex > currentStep ? 'right' : 'left');
    setTimeout(() => {
      setCurrentStep(stepIndex);
      setIsAnimating(false);
    }, 150);
  }, [currentStep, isAnimating]);

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
      <div className="relative w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        <GlassCard
          variant="elevated"
          padding="none"
          className="overflow-hidden border border-[var(--border-medium)] flex flex-col max-h-[90vh]"
        >
          {/* Header with close button */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
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
          <div className="px-6 pb-4 flex-shrink-0">
            <TutorialProgress
              totalSteps={tutorialSteps.length}
              currentStep={currentStep}
              completedSteps={completedSteps}
              variant="bar"
            />
          </div>

          {/* Content - scrollable */}
          <div className="px-6 pb-4 overflow-y-auto flex-1">
            <TutorialStep
              step={step}
              isAnimating={isAnimating}
              slideDirection={slideDirection}
            />
          </div>

          {/* Step indicators */}
          <div className="py-4 flex-shrink-0">
            <TutorialProgress
              totalSteps={tutorialSteps.length}
              currentStep={currentStep}
              completedSteps={completedSteps}
              variant="dots"
              onStepClick={handleStepClick}
            />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-4 px-6 py-4 bg-[var(--bg-tertiary)]/50 border-t border-[var(--border-subtle)] flex-shrink-0">
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
              {/* Quick Start button - shows on welcome, import-leads, create-campaign steps */}
              {isQuickStartStep && !isLastStep && currentStep !== 3 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleQuickStart}
                  disabled={isAnimating}
                  className="gap-1 border-[var(--accent-blue)]/50 text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10"
                  title="Quick path: Welcome, Import Leads, Create Campaign"
                >
                  <Zap className="w-4 h-4" />
                  Quick Start
                </Button>
              )}
              <Button
                size="sm"
                onClick={isQuickStartStep && currentStep === 3 ? handleQuickStart : handleNext}
                disabled={isAnimating}
                className="gap-1 btn-gradient border-0"
              >
                {isLastStep ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Get Started
                  </>
                ) : currentStep === 3 && isQuickStartStep ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Start Creating
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

// Utility function to reset onboarding (useful for testing or settings)
export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY);
  localStorage.removeItem(TUTORIAL_PROGRESS_KEY);
}

// Utility function to check if onboarding is completed
export function isOnboardingCompleted(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(ONBOARDING_KEY) !== null;
}

// Utility to restart onboarding
export function restartOnboarding() {
  resetOnboarding();
  // Force a page reload to show the tutorial
  window.location.reload();
}
