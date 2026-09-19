"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Users,
  Target,
  Rocket,
  Check,
  X,
  Loader2,
} from "lucide-react";

// Types for questionnaire data
export interface QuestionnaireData {
  experienceLevel: string | null;
  dealsPerMonth: string | null;
  teamSize: string | null;
  primaryMarket: string | null;
  currentTools: string[];
  biggestChallenge: string | null;
  howHeardAboutUs: string | null;
  budgetRange: string | null;
  goals: string;
}

interface SignupQuestionnaireProps {
  onComplete?: () => void;
  onSkip?: () => void;
  redirectTo?: string;
}

// Option configurations
const EXPERIENCE_OPTIONS = [
  { value: "BEGINNER", label: "New to wholesaling", desc: "Just getting started" },
  { value: "INTERMEDIATE", label: "Some experience", desc: "1-10 deals closed" },
  { value: "ADVANCED", label: "Experienced", desc: "10-50 deals closed" },
  { value: "EXPERT", label: "Expert", desc: "50+ deals closed" },
];

const DEALS_OPTIONS = [
  { value: "0", label: "0", desc: "Looking to close my first" },
  { value: "1-2", label: "1-2", desc: "Getting momentum" },
  { value: "3-5", label: "3-5", desc: "Consistent flow" },
  { value: "6-10", label: "6-10", desc: "Strong pipeline" },
  { value: "10+", label: "10+", desc: "High volume" },
];

const TEAM_OPTIONS = [
  { value: "solo", label: "Solo", desc: "Just me" },
  { value: "2-5", label: "2-5", desc: "Small team" },
  { value: "6-10", label: "6-10", desc: "Growing team" },
  { value: "10+", label: "10+", desc: "Large operation" },
];

const MARKET_OPTIONS = [
  { value: "residential", label: "Residential", desc: "Single-family, multi-family" },
  { value: "commercial", label: "Commercial", desc: "Office, retail, industrial" },
  { value: "land", label: "Land", desc: "Raw land, lots" },
  { value: "mixed", label: "Mixed", desc: "Multiple property types" },
];

const TOOLS_OPTIONS = [
  { value: "propstream", label: "PropStream" },
  { value: "batchleads", label: "BatchLeads" },
  { value: "reiskip", label: "REI Skip" },
  { value: "podio", label: "Podio" },
  { value: "salesforce", label: "Salesforce" },
  { value: "hubspot", label: "HubSpot" },
  { value: "follow_up_boss", label: "Follow Up Boss" },
  { value: "spreadsheets", label: "Spreadsheets" },
  { value: "none", label: "None yet" },
];

const CHALLENGE_OPTIONS = [
  { value: "lead_gen", label: "Finding leads", desc: "Need more motivated sellers" },
  { value: "follow_up", label: "Follow-up", desc: "Staying consistent with outreach" },
  { value: "closing", label: "Closing deals", desc: "Converting leads to contracts" },
  { value: "scaling", label: "Scaling", desc: "Handling more volume" },
  { value: "other", label: "Other", desc: "Something else" },
];

const SOURCE_OPTIONS = [
  { value: "google", label: "Google Search" },
  { value: "social", label: "Social Media" },
  { value: "referral", label: "Friend/Colleague" },
  { value: "podcast", label: "Podcast" },
  { value: "youtube", label: "YouTube" },
  { value: "other", label: "Other" },
];

const BUDGET_OPTIONS = [
  { value: "bootstrap", label: "Bootstrapping", desc: "Keeping costs minimal" },
  { value: "50-200", label: "$50-200/mo", desc: "Investing in growth" },
  { value: "200-500", label: "$200-500/mo", desc: "Serious about scaling" },
  { value: "500+", label: "$500+/mo", desc: "Enterprise level" },
];

// Progress indicator component
function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all duration-300 ${
            i === current
              ? "w-8 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6]"
              : i < current
                ? "w-2 bg-[#3B82F6]"
                : "w-2 bg-white/20"
          }`}
        />
      ))}
    </div>
  );
}

// Selection button component
function SelectButton({
  selected,
  onClick,
  children,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative text-left p-4 rounded-xl border transition-all duration-200 ${
        selected
          ? "border-[#3B82F6] bg-[#3B82F6]/10 ring-2 ring-[#3B82F6]/30"
          : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
      }`}
    >
      {selected && (
        <div className="absolute top-3 right-3">
          <Check className="h-4 w-4 text-[#3B82F6]" />
        </div>
      )}
      <div className="font-medium text-white">{children}</div>
      {description && (
        <div className="text-sm text-slate-400 mt-1">{description}</div>
      )}
    </button>
  );
}

// Multi-select chip component
function SelectChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-full border text-sm font-medium transition-all duration-200 ${
        selected
          ? "border-[#3B82F6] bg-[#3B82F6]/20 text-[#3B82F6]"
          : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
      }`}
    >
      {children}
    </button>
  );
}

export function SignupQuestionnaire({
  onComplete,
  onSkip,
  redirectTo = "/dashboard",
}: SignupQuestionnaireProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<QuestionnaireData>({
    experienceLevel: null,
    dealsPerMonth: null,
    teamSize: null,
    primaryMarket: null,
    currentTools: [],
    biggestChallenge: null,
    howHeardAboutUs: null,
    budgetRange: null,
    goals: "",
  });

  const totalSteps = 3;

  const updateData = useCallback(<K extends keyof QuestionnaireData>(
    key: K,
    value: QuestionnaireData[K]
  ) => {
    setData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleTool = useCallback((tool: string) => {
    setData((prev) => {
      const tools = prev.currentTools.includes(tool)
        ? prev.currentTools.filter((t) => t !== tool)
        : [...prev.currentTools, tool];
      return { ...prev, currentTools: tools };
    });
  }, []);

  const handleSubmit = async (isSkipped: boolean) => {
    setSubmitting(true);
    try {
      const response = await fetch("/api/user/questionnaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          isComplete: !isSkipped,
          isSkipped,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save questionnaire");
      }

      if (isSkipped && onSkip) {
        onSkip();
      } else if (onComplete) {
        onComplete();
      }

      router.push(redirectTo);
    } catch (error) {
      console.error("Questionnaire error:", error);
      // Still redirect on error - don't block the user
      router.push(redirectTo);
    }
  };

  const handleNext = () => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      handleSubmit(false);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleSkip = () => {
    handleSubmit(true);
  };

  // Screen icons
  const screenIcons = [Users, Target, Rocket];
  const ScreenIcon = screenIcons[step];

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-[#3B82F6]/5 blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-[#8B5CF6]/5 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
            <span className="text-white font-bold">DF</span>
          </div>
          <span className="text-xl font-semibold text-white">DealFlow AI</span>
        </div>
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="text-slate-400 hover:text-white text-sm font-medium flex items-center gap-1 transition-colors"
        >
          Skip for now
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-xl">
          {/* Progress */}
          <div className="flex flex-col items-center mb-8">
            <ProgressDots current={step} total={totalSteps} />
            <p className="text-slate-400 text-sm mt-4">
              Step {step + 1} of {totalSteps} - Takes less than 2 minutes
            </p>
          </div>

          {/* Content */}
          <div
            key={step}
            className="glass-card p-8 rounded-2xl border border-white/10 bg-[#1E293B]/80 backdrop-blur-sm transition-opacity duration-200"
          >
              {/* Screen icon */}
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-gradient-to-br from-[#3B82F6]/20 to-[#8B5CF6]/20">
                  <ScreenIcon className="h-6 w-6 text-[#3B82F6]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {step === 0 && "Tell us about your experience"}
                    {step === 1 && "Your current situation"}
                    {step === 2 && "Help us personalize your experience"}
                  </h2>
                  <p className="text-slate-400 text-sm">
                    {step === 0 && "So we can customize your onboarding"}
                    {step === 1 && "What tools do you use and what challenges do you face?"}
                    {step === 2 && "Optional - help us serve you better"}
                  </p>
                </div>
              </div>

              {/* Step 0: Experience */}
              {step === 0 && (
                <div className="space-y-6">
                  {/* Experience Level */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Your wholesaling experience
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {EXPERIENCE_OPTIONS.map((opt) => (
                        <SelectButton
                          key={opt.value}
                          selected={data.experienceLevel === opt.value}
                          onClick={() => updateData("experienceLevel", opt.value)}
                          description={opt.desc}
                        >
                          {opt.label}
                        </SelectButton>
                      ))}
                    </div>
                  </div>

                  {/* Deals per month */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Deals closed per month
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {DEALS_OPTIONS.map((opt) => (
                        <SelectButton
                          key={opt.value}
                          selected={data.dealsPerMonth === opt.value}
                          onClick={() => updateData("dealsPerMonth", opt.value)}
                          description={opt.desc}
                        >
                          {opt.label}
                        </SelectButton>
                      ))}
                    </div>
                  </div>

                  {/* Team size */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Team size
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {TEAM_OPTIONS.map((opt) => (
                        <SelectButton
                          key={opt.value}
                          selected={data.teamSize === opt.value}
                          onClick={() => updateData("teamSize", opt.value)}
                          description={opt.desc}
                        >
                          {opt.label}
                        </SelectButton>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1: Current situation */}
              {step === 1 && (
                <div className="space-y-6">
                  {/* Primary market */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Primary market
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {MARKET_OPTIONS.map((opt) => (
                        <SelectButton
                          key={opt.value}
                          selected={data.primaryMarket === opt.value}
                          onClick={() => updateData("primaryMarket", opt.value)}
                          description={opt.desc}
                        >
                          {opt.label}
                        </SelectButton>
                      ))}
                    </div>
                  </div>

                  {/* Tools used */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Tools you currently use (select all that apply)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {TOOLS_OPTIONS.map((opt) => (
                        <SelectChip
                          key={opt.value}
                          selected={data.currentTools.includes(opt.value)}
                          onClick={() => toggleTool(opt.value)}
                        >
                          {opt.label}
                        </SelectChip>
                      ))}
                    </div>
                  </div>

                  {/* Biggest challenge */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Biggest challenge right now
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CHALLENGE_OPTIONS.map((opt) => (
                        <SelectButton
                          key={opt.value}
                          selected={data.biggestChallenge === opt.value}
                          onClick={() => updateData("biggestChallenge", opt.value)}
                          description={opt.desc}
                        >
                          {opt.label}
                        </SelectButton>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Discovery */}
              {step === 2 && (
                <div className="space-y-6">
                  {/* How heard about us */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      How did you hear about us?
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {SOURCE_OPTIONS.map((opt) => (
                        <SelectChip
                          key={opt.value}
                          selected={data.howHeardAboutUs === opt.value}
                          onClick={() => updateData("howHeardAboutUs", opt.value)}
                        >
                          {opt.label}
                        </SelectChip>
                      ))}
                    </div>
                  </div>

                  {/* Budget range */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Monthly software budget
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {BUDGET_OPTIONS.map((opt) => (
                        <SelectButton
                          key={opt.value}
                          selected={data.budgetRange === opt.value}
                          onClick={() => updateData("budgetRange", opt.value)}
                          description={opt.desc}
                        >
                          {opt.label}
                        </SelectButton>
                      ))}
                    </div>
                  </div>

                  {/* Goals */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      What do you hope to achieve with DealFlow? (optional)
                    </label>
                    <textarea
                      value={data.goals}
                      onChange={(e) => updateData("goals", e.target.value)}
                      placeholder="e.g., Close my first deal, scale to 10 deals/month, automate follow-up..."
                      rows={3}
                      maxLength={1000}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-[#3B82F6] focus:ring-1 focus:ring-[#3B82F6] transition-colors resize-none"
                    />
                    <p className="text-xs text-slate-500 mt-1 text-right">
                      {data.goals.length}/1000
                    </p>
                  </div>
                </div>
              )}

              {/* Navigation buttons */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-white/10">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={step === 0 || submitting}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    step === 0
                      ? "text-slate-600 cursor-not-allowed"
                      : "text-slate-300 hover:text-white hover:bg-white/10"
                  }`}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </button>

                <button
                  type="button"
                  onClick={handleNext}
                  disabled={submitting}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-all shadow-lg shadow-blue-500/25 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : step === totalSteps - 1 ? (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Get Started
                    </>
                  ) : (
                    <>
                      Continue
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>

          {/* Value proposition */}
          <p className="text-center text-slate-500 text-sm mt-6">
            Your answers help us personalize your experience and show you the most relevant features.
          </p>
        </div>
      </main>
    </div>
  );
}

export default SignupQuestionnaire;
