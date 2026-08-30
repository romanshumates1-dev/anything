'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LeadSourceSelector, type LeadSourceSelection } from '@/components/campaigns/LeadSourceSelector';
import { LeadFinderModal } from '@/components/campaigns/LeadFinderModal';
import {
  AlertTriangle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Rocket,
  Save,
  Clock,
  ShieldCheck,
  DollarSign,
  Search,
  Check,
  FileText,
  Users,
  MessageSquare,
  Settings2,
  Eye,
  Zap,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Info,
  ChevronRight,
  Calendar,
  Target,
  Brain,
  Shield,
  Play,
  RefreshCw,
} from 'lucide-react';

// ============================================================================
// Types & Constants
// ============================================================================

type WizardStep = 'basics' | 'contacts' | 'messages' | 'schedule' | 'review';

interface CampaignForm {
  // Step 1 - Basics
  name: string;
  description: string;
  direction: 'SELLER' | 'BUYER';

  // Step 2 - Contacts
  contactSource: 'csv' | 'paste' | 'crm' | 'lead-finder';
  consentMode: 'unverified' | 'inbound' | 'consented';
  contactListId?: string;
  pastedContacts: string;
  selectedLeadIds?: number[];

  // Step 3 - Messages
  openingMessage: string;
  followUps: Array<{ body: string; delayHours: number }>;
  abVariantsEnabled: boolean;

  // Step 4 - Schedule & Settings
  dailyVolumeMin: number;
  dailyVolumeMax: number;
  durationDays: number;
  startDate: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  timezone: string;
  aiNegotiationEnabled: boolean;
  aiValuationEnabled: boolean;
  resurrectionEnabled: boolean;

  // Compliance & Safety
  dncScrubEnabled: boolean;
  litigatorScrubEnabled: boolean;
  testMode: boolean;
  budgetCap?: number;
  selectedTestPhones: string[];
}

const DEFAULT_FORM: CampaignForm = {
  name: '',
  description: '',
  direction: 'SELLER',
  contactSource: 'csv',
  consentMode: 'unverified',
  pastedContacts: '',
  openingMessage: '',
  followUps: [
    { body: '', delayHours: 24 },
    { body: '', delayHours: 48 },
  ],
  abVariantsEnabled: false,
  dailyVolumeMin: 50,
  dailyVolumeMax: 50,
  durationDays: 7,
  startDate: '',
  sendWindowStart: '09:00',
  sendWindowEnd: '19:00',
  timezone: 'America/New_York',
  aiNegotiationEnabled: true,
  aiValuationEnabled: true,
  resurrectionEnabled: true,
  dncScrubEnabled: true,
  litigatorScrubEnabled: true,
  testMode: false,
  selectedTestPhones: [],
};

const DEFAULT_OPENER =
  "Hi {name}, I came across {address} in {city} and wanted to reach out - would you consider an offer on it? No obligation at all.";

const STEPS: { key: WizardStep; label: string; icon: React.ElementType; description: string }[] = [
  { key: 'basics', label: 'Campaign Basics', icon: FileText, description: 'Name and type' },
  { key: 'contacts', label: 'Select Contacts', icon: Users, description: 'Choose your audience' },
  { key: 'messages', label: 'Messages', icon: MessageSquare, description: 'Craft your outreach' },
  { key: 'schedule', label: 'Schedule', icon: Calendar, description: 'Timing and AI settings' },
  { key: 'review', label: 'Review & Launch', icon: Rocket, description: 'Final checks' },
];

// ============================================================================
// Step Progress Indicator Component
// ============================================================================

function StepIndicator({
  steps,
  currentStep,
  onStepClick,
  completedSteps,
}: {
  steps: typeof STEPS;
  currentStep: WizardStep;
  onStepClick: (step: WizardStep) => void;
  completedSteps: Set<WizardStep>;
}) {
  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="relative">
      {/* Desktop Step Indicator */}
      <div className="hidden md:flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = step.key === currentStep;
          const isCompleted = completedSteps.has(step.key);
          const isClickable = index <= currentIndex || isCompleted;
          const Icon = step.icon;

          return (
            <div key={step.key} className="flex items-center flex-1">
              <button
                onClick={() => isClickable && onStepClick(step.key)}
                disabled={!isClickable}
                className={`
                  relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all duration-300
                  ${isActive ? 'scale-105' : ''}
                  ${isClickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}
                `}
              >
                {/* Step Circle */}
                <div
                  className={`
                    relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300
                    ${
                      isActive
                        ? 'bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] shadow-lg shadow-[var(--accent-blue)]/30'
                        : isCompleted
                        ? 'bg-[var(--color-success)] shadow-lg shadow-[var(--color-success)]/30'
                        : 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]'
                    }
                  `}
                >
                  {isCompleted && !isActive ? (
                    <Check className="h-5 w-5 text-white" />
                  ) : (
                    <Icon className={`h-5 w-5 ${isActive ? 'text-white' : 'text-[var(--text-muted)]'}`} />
                  )}

                  {/* Active pulse ring */}
                  {isActive && (
                    <div className="absolute inset-0 rounded-full bg-[var(--accent-blue)] opacity-30 animate-ping" />
                  )}
                </div>

                {/* Step Label */}
                <div className="text-center">
                  <p
                    className={`text-sm font-medium transition-colors ${
                      isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] hidden lg:block">{step.description}</p>
                </div>
              </button>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="flex-1 h-0.5 mx-2 relative">
                  <div className="absolute inset-0 bg-[var(--bg-tertiary)] rounded-full" />
                  <div
                    className={`
                      absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full
                      transition-all duration-500 ease-out
                    `}
                    style={{ width: index < currentIndex ? '100%' : '0%' }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile Step Indicator */}
      <div className="md:hidden">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-[var(--text-muted)]">
            Step {currentIndex + 1} of {steps.length}
          </span>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {steps[currentIndex].label}
          </span>
        </div>
        <div className="flex gap-1">
          {steps.map((step, index) => (
            <div
              key={step.key}
              className={`
                h-1.5 flex-1 rounded-full transition-all duration-300
                ${
                  index <= currentIndex
                    ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]'
                    : 'bg-[var(--bg-tertiary)]'
                }
              `}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Inline Validation Feedback Component
// ============================================================================

function ValidationFeedback({
  error,
  success,
  info,
}: {
  error?: string;
  success?: string;
  info?: string;
}) {
  if (!error && !success && !info) return null;

  return (
    <div
      className={`
        flex items-start gap-2 mt-2 text-sm animate-fade-in-up
        ${error ? 'text-[var(--color-error)]' : success ? 'text-[var(--color-success)]' : 'text-[var(--text-muted)]'}
      `}
    >
      {error && <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
      {success && <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
      {info && <Info className="h-4 w-4 shrink-0 mt-0.5" />}
      <span>{error || success || info}</span>
    </div>
  );
}

// ============================================================================
// Form Field Wrapper with Label and Help Text
// ============================================================================

function FormField({
  label,
  required,
  helpText,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  helpText?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-[var(--text-primary)]">
          {label}
          {required && <span className="text-[var(--color-error)] ml-1">*</span>}
        </Label>
        {helpText && <span className="text-xs text-[var(--text-muted)]">{helpText}</span>}
      </div>
      {children}
      {error && <ValidationFeedback error={error} />}
    </div>
  );
}

// ============================================================================
// Character Counter Component
// ============================================================================

function CharacterCounter({ current, maxRecommended }: { current: number; maxRecommended: number }) {
  const segments = current <= 160 ? 1 : current <= 320 ? 2 : current <= 480 ? 3 : Math.ceil(current / 160);
  const isOverRecommended = current > maxRecommended;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className={`${isOverRecommended ? 'text-[var(--color-warning)]' : 'text-[var(--text-muted)]'}`}>
        {current} characters
      </span>
      <Badge
        variant="outline"
        className={`
          text-xs transition-colors
          ${
            segments > 1
              ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
          }
        `}
      >
        {segments} segment{segments > 1 ? 's' : ''} = {segments}x cost
      </Badge>
    </div>
  );
}

// ============================================================================
// Step Content Components
// ============================================================================

function StepBasics({
  form,
  setForm,
  errors,
}: {
  form: CampaignForm;
  setForm: React.Dispatch<React.SetStateAction<CampaignForm>>;
  errors: Record<string, string>;
}) {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 mb-4">
          <FileText className="h-8 w-8 text-[var(--accent-blue)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Campaign Basics</h2>
        <p className="text-[var(--text-secondary)]">Give your campaign a name and choose your direction</p>
      </div>

      <GlassCard className="space-y-6">
        <FormField label="Campaign Name" required error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g., Q1 Seller Outreach - Kentucky"
            className={`input-enhanced ${errors.name ? 'input-error' : form.name ? 'input-success' : ''}`}
          />
          {!errors.name && form.name && (
            <ValidationFeedback success="Great name! Clear and descriptive." />
          )}
        </FormField>

        <FormField label="Description" helpText="Optional">
          <Textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Add notes about this campaign's goals or target audience..."
            rows={3}
            className="input-enhanced resize-none"
          />
        </FormField>

        <FormField label="Campaign Direction" required>
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: 'SELLER' as const, label: 'Seller Campaign', description: "We're buying properties", icon: Target },
              { value: 'BUYER' as const, label: 'Buyer Campaign', description: "We're selling properties", icon: Users },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, direction: option.value }))}
                className={`
                  relative p-4 rounded-xl text-left transition-all duration-300
                  ${
                    form.direction === option.value
                      ? 'bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 border-2 border-[var(--accent-blue)] shadow-lg shadow-[var(--accent-blue)]/10'
                      : 'bg-[var(--bg-tertiary)] border-2 border-transparent hover:border-[var(--border-medium)]'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`
                      p-2 rounded-lg transition-colors
                      ${form.direction === option.value ? 'bg-[var(--accent-blue)]/20' : 'bg-[var(--bg-secondary)]'}
                    `}
                  >
                    <option.icon
                      className={`h-5 w-5 ${
                        form.direction === option.value ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'
                      }`}
                    />
                  </div>
                  <div>
                    <p className={`font-medium ${form.direction === option.value ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                      {option.label}
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">{option.description}</p>
                  </div>
                </div>
                {form.direction === option.value && (
                  <div className="absolute top-3 right-3">
                    <CheckCircle2 className="h-5 w-5 text-[var(--accent-blue)]" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </FormField>
      </GlassCard>
    </div>
  );
}

function StepContacts({
  form,
  setForm,
  onOpenLeadFinder,
  selectedListInfo,
}: {
  form: CampaignForm;
  setForm: React.Dispatch<React.SetStateAction<CampaignForm>>;
  onOpenLeadFinder: () => void;
  selectedListInfo: { name: string; count: number } | null;
}) {
  const handleLeadSourceChange = (selection: LeadSourceSelection) => {
    setForm((f) => ({
      ...f,
      contactSource: selection.type,
      contactListId: selection.contactListId,
      pastedContacts: selection.pastedContacts || '',
      selectedLeadIds: selection.selectedLeadIds,
      consentMode: selection.consentMode || 'unverified',
    }));
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-purple)]/20 to-[var(--accent-blue)]/20 mb-4">
          <Users className="h-8 w-8 text-[var(--accent-purple)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Select Your Contacts</h2>
        <p className="text-[var(--text-secondary)]">Choose who you want to reach with this campaign</p>
      </div>

      <GlassCard>
        <LeadSourceSelector
          value={{
            type: form.contactSource,
            contactListId: form.contactListId,
            pastedContacts: form.pastedContacts,
            selectedLeadIds: form.selectedLeadIds,
            consentMode: form.consentMode,
          }}
          onChange={handleLeadSourceChange}
          onOpenLeadFinder={onOpenLeadFinder}
        />

        {selectedListInfo && (
          <div className="mt-4 flex items-center gap-3 p-4 rounded-xl bg-[var(--color-success)]/10 border border-[var(--color-success)]/30">
            <div className="p-2 rounded-lg bg-[var(--color-success)]/20">
              <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
            </div>
            <div>
              <p className="font-medium text-[var(--color-success)]">
                {selectedListInfo.count.toLocaleString()} contacts selected
              </p>
              <p className="text-sm text-[var(--text-secondary)]">From "{selectedListInfo.name}"</p>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Quick tip card */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--accent-blue)]/5 border border-[var(--accent-blue)]/20">
        <Sparkles className="h-5 w-5 text-[var(--accent-blue)] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Pro Tip</p>
          <p className="text-sm text-[var(--text-secondary)]">
            Use the Lead Finder to discover motivated {form.direction === 'SELLER' ? 'sellers' : 'buyers'} based on
            distress signals and public records.
          </p>
        </div>
      </div>
    </div>
  );
}

function StepMessages({
  form,
  setForm,
  errors,
}: {
  form: CampaignForm;
  setForm: React.Dispatch<React.SetStateAction<CampaignForm>>;
  errors: Record<string, string>;
}) {
  const addFollowUp = () => {
    if (form.followUps.length < 5) {
      setForm((f) => ({ ...f, followUps: [...f.followUps, { body: '', delayHours: 24 }] }));
    }
  };

  const removeFollowUp = (index: number) => {
    setForm((f) => ({ ...f, followUps: f.followUps.filter((_, i) => i !== index) }));
  };

  const updateFollowUp = (index: number, field: 'body' | 'delayHours', value: string | number) => {
    setForm((f) => ({
      ...f,
      followUps: f.followUps.map((fu, i) => (i === index ? { ...fu, [field]: value } : fu)),
    }));
  };

  const applyDefaultOpener = () => {
    setForm((f) => ({ ...f, openingMessage: DEFAULT_OPENER }));
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-success)]/20 to-[var(--accent-blue)]/20 mb-4">
          <MessageSquare className="h-8 w-8 text-[var(--color-success)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Craft Your Messages</h2>
        <p className="text-[var(--text-secondary)]">Write compelling outreach that gets responses</p>
      </div>

      <GlassCard className="space-y-6">
        <FormField label="Opening Message" required error={errors.openingMessage}>
          <div className="space-y-3">
            <div className="relative">
              <Textarea
                value={form.openingMessage}
                onChange={(e) => setForm((f) => ({ ...f, openingMessage: e.target.value }))}
                placeholder="Hi {name}, I came across {address} in {city}..."
                rows={4}
                className={`input-enhanced resize-none pr-12 ${errors.openingMessage ? 'input-error' : ''}`}
              />
              {!form.openingMessage && (
                <button
                  onClick={applyDefaultOpener}
                  className="absolute right-2 top-2 p-2 rounded-lg bg-[var(--accent-blue)]/10 hover:bg-[var(--accent-blue)]/20 transition-colors"
                  title="Use smart default"
                >
                  <Sparkles className="h-4 w-4 text-[var(--accent-blue)]" />
                </button>
              )}
            </div>
            <CharacterCounter current={form.openingMessage.length} maxRecommended={160} />
          </div>
        </FormField>

        {/* Merge fields help */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-[var(--text-muted)]">Available merge fields:</span>
          {['{name}', '{address}', '{city}', '{state}'].map((field) => (
            <Badge
              key={field}
              variant="outline"
              className="text-xs bg-[var(--bg-tertiary)] cursor-pointer hover:bg-[var(--accent-blue)]/10 hover:border-[var(--accent-blue)]/30 transition-colors"
              onClick={() => setForm((f) => ({ ...f, openingMessage: f.openingMessage + ' ' + field }))}
            >
              {field}
            </Badge>
          ))}
        </div>
      </GlassCard>

      {/* Follow-ups Section */}
      <GlassCard className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Follow-up Sequence</h3>
            <p className="text-sm text-[var(--text-muted)]">Automatically follow up if no response</p>
          </div>
          {form.followUps.length < 5 && (
            <button onClick={addFollowUp} className="btn-secondary px-4 py-2 rounded-lg text-sm">
              + Add Follow-up
            </button>
          )}
        </div>

        {form.followUps.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-[var(--border-subtle)] rounded-xl">
            <MessageSquare className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-[var(--text-muted)]">No follow-ups configured</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">Add follow-ups to increase response rates</p>
          </div>
        ) : (
          <div className="space-y-4">
            {form.followUps.map((fu, index) => (
              <div
                key={index}
                className="p-4 rounded-xl bg-[var(--bg-primary)]/50 border border-[var(--border-subtle)] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[var(--accent-blue)]/20 flex items-center justify-center">
                      <span className="text-xs font-bold text-[var(--accent-blue)]">{index + 1}</span>
                    </div>
                    <span className="text-sm font-medium text-[var(--text-primary)]">Follow-up {index + 1}</span>
                  </div>
                  <button
                    onClick={() => removeFollowUp(index)}
                    className="p-1.5 rounded-lg hover:bg-[var(--color-error)]/10 text-[var(--text-muted)] hover:text-[var(--color-error)] transition-colors"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>

                <Textarea
                  rows={2}
                  value={fu.body}
                  onChange={(e) => updateFollowUp(index, 'body', e.target.value)}
                  placeholder="Hey {name}, just following up on my message about {address}..."
                  className="input-enhanced resize-none"
                />

                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-[var(--text-muted)]" />
                  <Input
                    type="number"
                    min={1}
                    max={168}
                    value={fu.delayHours}
                    onChange={(e) => updateFollowUp(index, 'delayHours', Number(e.target.value))}
                    className="input-enhanced w-24"
                  />
                  <span className="text-sm text-[var(--text-muted)]">hours after previous message</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function StepSchedule({
  form,
  setForm,
  testPhones,
}: {
  form: CampaignForm;
  setForm: React.Dispatch<React.SetStateAction<CampaignForm>>;
  testPhones: any[] | undefined;
}) {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-warning)]/20 to-[var(--accent-blue)]/20 mb-4">
          <Calendar className="h-8 w-8 text-[var(--color-warning)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Schedule & Settings</h2>
        <p className="text-[var(--text-secondary)]">Configure timing, volume, and AI features</p>
      </div>

      {/* Sending Settings */}
      <GlassCard className="space-y-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-[var(--accent-blue)]" />
          Sending Settings
        </h3>

        <FormField label="Daily Volume" helpText={`${form.dailyVolumeMin}-${form.dailyVolumeMax} messages/day`}>
          <Slider
            min={form.direction === 'SELLER' ? 50 : 50}
            max={form.direction === 'SELLER' ? 5000 : 1000}
            step={50}
            value={[form.dailyVolumeMin, form.dailyVolumeMax]}
            onValueChange={([min, max]) => setForm((f) => ({ ...f, dailyVolumeMin: min, dailyVolumeMax: max }))}
            className="mt-2"
          />
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Maximum: {form.direction === 'SELLER' ? '5,000' : '1,000'} per day
          </p>
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Duration (days)">
            <Input
              type="number"
              min={1}
              max={form.direction === 'SELLER' ? 120 : 30}
              value={form.durationDays}
              onChange={(e) => setForm((f) => ({ ...f, durationDays: Number(e.target.value) }))}
              className="input-enhanced"
            />
          </FormField>

          <FormField label="Start Date">
            <Input
              type="datetime-local"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              className="input-enhanced"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Send Window Start">
            <Input
              type="time"
              value={form.sendWindowStart}
              onChange={(e) => setForm((f) => ({ ...f, sendWindowStart: e.target.value }))}
              className="input-enhanced"
            />
          </FormField>
          <FormField label="Send Window End">
            <Input
              type="time"
              value={form.sendWindowEnd}
              onChange={(e) => setForm((f) => ({ ...f, sendWindowEnd: e.target.value }))}
              className="input-enhanced"
            />
          </FormField>
        </div>

        <div className="p-3 rounded-lg bg-[var(--accent-blue)]/5 border border-[var(--accent-blue)]/20">
          <p className="text-xs text-[var(--text-secondary)]">
            <Info className="h-3 w-3 inline mr-1" />
            TCPA compliance: Messages are only sent between 8am-9pm in the recipient's timezone.
          </p>
        </div>
      </GlassCard>

      {/* AI Features */}
      <GlassCard className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Brain className="h-5 w-5 text-[var(--accent-purple)]" />
          AI Features
        </h3>

        {[
          {
            key: 'aiNegotiationEnabled' as const,
            label: 'AI Negotiation',
            description: 'AI auto-responds to replies and handles negotiations',
            icon: MessageSquare,
          },
          {
            key: 'aiValuationEnabled' as const,
            label: 'AI Valuation Suggestions',
            description: 'Suggest price ranges during negotiation',
            icon: DollarSign,
          },
          {
            key: 'resurrectionEnabled' as const,
            label: 'Resurrection Eligibility',
            description: 'Cold leads may re-enter 30/60/90-day re-engagement',
            icon: RefreshCw,
          },
        ].map((feature) => (
          <div
            key={feature.key}
            className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-primary)]/50 border border-[var(--border-subtle)]"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--accent-purple)]/10">
                <feature.icon className="h-4 w-4 text-[var(--accent-purple)]" />
              </div>
              <div>
                <p className="font-medium text-[var(--text-primary)]">{feature.label}</p>
                <p className="text-sm text-[var(--text-muted)]">{feature.description}</p>
              </div>
            </div>
            <Switch
              checked={form[feature.key]}
              onCheckedChange={(v) => setForm((f) => ({ ...f, [feature.key]: v }))}
            />
          </div>
        ))}
      </GlassCard>

      {/* Test Mode */}
      <GlassCard
        className={`space-y-4 transition-all duration-300 ${
          form.testMode ? 'ring-2 ring-[var(--color-warning)] bg-[var(--color-warning)]/5' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${form.testMode ? 'bg-[var(--color-warning)]/20' : 'bg-[var(--bg-tertiary)]'}`}>
              <Zap className={`h-5 w-5 ${form.testMode ? 'text-[var(--color-warning)]' : 'text-[var(--text-muted)]'}`} />
            </div>
            <div>
              <p className={`font-semibold ${form.testMode ? 'text-[var(--color-warning)]' : 'text-[var(--text-primary)]'}`}>
                Personal Test Mode
              </p>
              <p className="text-sm text-[var(--text-muted)]">Send only to your verified test numbers</p>
            </div>
          </div>
          <Switch checked={form.testMode} onCheckedChange={(v) => setForm((f) => ({ ...f, testMode: v }))} />
        </div>

        {form.testMode && (
          <div className="pt-4 border-t border-[var(--border-subtle)] space-y-3">
            <Label className="text-sm text-[var(--text-secondary)]">Verified Test Numbers</Label>
            <div className="flex flex-wrap gap-2">
              {(testPhones || [])
                .filter((p: any) => p.verified)
                .map((p: any) => (
                  <Badge key={p.id} variant="outline" className="bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                    {p.phone}
                  </Badge>
                ))}
              {(testPhones || []).filter((p: any) => p.verified).length === 0 && (
                <p className="text-sm text-[var(--text-muted)]">No verified test numbers. Add some in Settings.</p>
              )}
            </div>
            <p className="text-xs text-[var(--color-warning)]">
              Test mode: Max 20 msgs/day, max 3 days duration
            </p>
          </div>
        )}
      </GlassCard>

      {/* Budget Cap */}
      <GlassCard className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-[var(--color-success)]" />
          Budget Cap
          <Badge variant="outline" className="text-xs">Optional</Badge>
        </h3>

        <FormField label="Maximum Spend" helpText="Campaign pauses when this limit is reached">
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              type="number"
              className="input-enhanced pl-9"
              placeholder="No limit"
              value={form.budgetCap || ''}
              onChange={(e) => setForm((f) => ({ ...f, budgetCap: e.target.value ? Number(e.target.value) : undefined }))}
            />
          </div>
        </FormField>
      </GlassCard>
    </div>
  );
}

function StepReview({
  form,
  setForm,
  onLaunch,
  onSaveDraft,
  isLaunching,
  showDncConfirm,
  setShowDncConfirm,
  confirmDncOff,
}: {
  form: CampaignForm;
  setForm: React.Dispatch<React.SetStateAction<CampaignForm>>;
  onLaunch: () => void;
  onSaveDraft: () => void;
  isLaunching: boolean;
  showDncConfirm: boolean;
  setShowDncConfirm: (show: boolean) => void;
  confirmDncOff: () => void;
}) {
  const toggleDnc = () => {
    if (form.dncScrubEnabled) {
      setShowDncConfirm(true);
    } else {
      setForm((f) => ({ ...f, dncScrubEnabled: true }));
    }
  };

  const estimatedMessages = form.dailyVolumeMax * form.durationDays;
  const estimatedCost = estimatedMessages * 0.00645;

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-success)]/20 to-[var(--accent-purple)]/20 mb-4">
          <Eye className="h-8 w-8 text-[var(--color-success)]" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Review & Launch</h2>
        <p className="text-[var(--text-secondary)]">Double-check everything before launching</p>
      </div>

      {/* Campaign Summary */}
      <GlassCard className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Campaign Summary</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Name', value: form.name || 'Untitled', icon: FileText },
            { label: 'Direction', value: form.direction, icon: Target },
            { label: 'Duration', value: `${form.durationDays} days`, icon: Calendar },
            { label: 'Daily Volume', value: `${form.dailyVolumeMin}-${form.dailyVolumeMax}`, icon: MessageSquare },
          ].map((item) => (
            <div key={item.label} className="p-3 rounded-xl bg-[var(--bg-primary)]/50 border border-[var(--border-subtle)]">
              <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
                <item.icon className="h-3.5 w-3.5" />
                <span className="text-xs">{item.label}</span>
              </div>
              <p className="font-semibold text-[var(--text-primary)] truncate">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <p className="text-sm text-[var(--text-muted)] mb-1">Opening Message Preview</p>
          <p className="text-[var(--text-primary)] whitespace-pre-wrap">
            {form.openingMessage || DEFAULT_OPENER}
          </p>
        </div>

        {/* Projections */}
        <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-gradient-to-br from-[var(--accent-blue)]/5 to-[var(--accent-purple)]/5 border border-[var(--accent-blue)]/20">
          <div>
            <p className="text-sm text-[var(--text-muted)]">Est. Total Messages</p>
            <p className="text-2xl font-bold text-[var(--accent-blue)]">{estimatedMessages.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-[var(--text-muted)]">Est. Cost</p>
            <p className="text-2xl font-bold text-[var(--accent-purple)]">${estimatedCost.toFixed(2)}</p>
          </div>
        </div>
      </GlassCard>

      {/* Compliance Settings */}
      <GlassCard className="space-y-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Shield className="h-5 w-5 text-[var(--color-success)]" />
          Compliance Settings
        </h3>

        <div className="p-4 rounded-xl bg-[var(--color-success)]/5 border border-[var(--color-success)]/20">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-[var(--color-success)] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--color-success)]">Built-in Protections</p>
              <p className="text-sm text-[var(--text-secondary)]">
                Opt-out enforcement and TCPA quiet hours (8am-9pm) are always enabled and cannot be disabled.
              </p>
            </div>
          </div>
        </div>

        {[
          {
            key: 'dncScrubEnabled' as const,
            label: 'DNC Scrubbing',
            description: form.dncScrubEnabled
              ? 'Contacts will be scrubbed against the Do Not Call registry'
              : 'WARNING: Contacts will NOT be scrubbed (higher liability risk)',
            icon: Shield,
            warning: !form.dncScrubEnabled,
          },
          {
            key: 'litigatorScrubEnabled' as const,
            label: 'Litigator List Scrub',
            description: 'Block known TCPA litigators from receiving messages',
            icon: AlertTriangle,
          },
        ].map((setting) => (
          <div
            key={setting.key}
            className={`
              flex items-center justify-between p-4 rounded-xl border transition-colors
              ${setting.warning ? 'bg-[var(--color-error)]/5 border-[var(--color-error)]/30' : 'bg-[var(--bg-primary)]/50 border-[var(--border-subtle)]'}
            `}
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  setting.warning ? 'bg-[var(--color-error)]/10' : 'bg-[var(--color-success)]/10'
                }`}
              >
                <setting.icon
                  className={`h-4 w-4 ${
                    setting.warning ? 'text-[var(--color-error)]' : 'text-[var(--color-success)]'
                  }`}
                />
              </div>
              <div>
                <p className={`font-medium ${setting.warning ? 'text-[var(--color-error)]' : 'text-[var(--text-primary)]'}`}>
                  {setting.label}
                </p>
                <p className={`text-sm ${setting.warning ? 'text-[var(--color-error)]/80' : 'text-[var(--text-muted)]'}`}>
                  {setting.description}
                </p>
              </div>
            </div>
            <Switch
              checked={form[setting.key]}
              onCheckedChange={setting.key === 'dncScrubEnabled' ? toggleDnc : (v) => setForm((f) => ({ ...f, [setting.key]: v }))}
            />
          </div>
        ))}
      </GlassCard>

      {/* Test Mode Banner */}
      {form.testMode && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
          <Zap className="h-5 w-5 text-[var(--color-warning)]" />
          <div>
            <p className="font-medium text-[var(--color-warning)]">Test Mode Enabled</p>
            <p className="text-sm text-[var(--text-secondary)]">
              This campaign will only send to your verified test numbers.
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={onSaveDraft}
          disabled={isLaunching}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium"
        >
          <Save className="h-5 w-5" />
          Save as Draft
        </button>
        <button
          onClick={onLaunch}
          disabled={isLaunching || !form.name || !form.openingMessage}
          className="btn-gradient flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium disabled:opacity-50"
        >
          {isLaunching ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Launching...
            </>
          ) : (
            <>
              <Rocket className="h-5 w-5" />
              Launch Campaign
            </>
          )}
        </button>
      </div>

      {/* DNC Confirmation Modal */}
      {showDncConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <GlassCard className="max-w-md w-full space-y-4 animate-fade-in-up">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-[var(--color-error)]/10">
                <AlertTriangle className="h-6 w-6 text-[var(--color-error)]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--color-error)]">Disable DNC Scrubbing?</h3>
                <p className="text-sm text-[var(--text-muted)]">This increases your legal liability</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[var(--color-error)]/5 border border-[var(--color-error)]/30">
              <p className="text-sm text-[var(--color-error)]">
                <strong>Legal Risk Warning:</strong> You are about to send SMS to numbers that may be on the National
                Do Not Call Registry. This may violate TCPA and expose you to liability of $500-$1,500 per violation.
              </p>
            </div>

            <p className="text-sm text-[var(--text-secondary)]">
              By clicking "Confirm", you acknowledge that these contacts have an existing business relationship or
              documented consent, and you accept TCPA liability for any resulting violations.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDncConfirm(false)}
                className="btn-secondary flex-1 py-2.5 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={confirmDncOff}
                className="btn-destructive flex-1 py-2.5 rounded-xl"
              >
                I Confirm, Disable DNC
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Wizard Component
// ============================================================================

export default function CampaignWizardPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>('basics');
  const [form, setForm] = useState<CampaignForm>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDncConfirm, setShowDncConfirm] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [showLeadFinder, setShowLeadFinder] = useState(false);
  const [selectedListInfo, setSelectedListInfo] = useState<{ name: string; count: number } | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());

  // Queries
  const { data: testPhones } = useQuery({
    queryKey: ['test-phones'],
    queryFn: async () => {
      const res = await fetch('/api/test-phones');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !session) {
      redirect('/account/signin');
    }
  }, [session, authLoading]);

  // Validation
  const validateStep = useCallback(
    (stepKey: WizardStep): boolean => {
      const newErrors: Record<string, string> = {};

      if (stepKey === 'basics') {
        if (!form.name.trim()) newErrors.name = 'Campaign name is required';
      }

      if (stepKey === 'messages') {
        if (!form.openingMessage.trim()) newErrors.openingMessage = 'Opening message is required';
      }

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [form]
  );

  // Navigation
  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  const goToStep = useCallback(
    (targetStep: WizardStep) => {
      setGlobalError(null);
      setStep(targetStep);
    },
    []
  );

  const nextStep = useCallback(() => {
    if (validateStep(step)) {
      setCompletedSteps((prev) => new Set([...prev, step]));
      if (currentStepIndex < STEPS.length - 1) {
        goToStep(STEPS[currentStepIndex + 1].key);
      }
    }
  }, [step, currentStepIndex, validateStep, goToStep]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      goToStep(STEPS[currentStepIndex - 1].key);
    }
  }, [currentStepIndex, goToStep]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: CampaignForm) => {
      const res = await fetch('/api/outreach/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: data.direction,
          name: data.name,
          description: data.description,
          dailyVolumeMax: data.dailyVolumeMax,
          durationDays: data.durationDays,
          openingMessage: data.openingMessage || DEFAULT_OPENER,
          followUps: data.followUps.filter((f) => f.body.trim()),
          contacts: data.pastedContacts.split('\n').filter(Boolean),
          testMode: data.testMode,
          dncScrubEnabled: data.dncScrubEnabled,
          litigatorScrubEnabled: data.litigatorScrubEnabled,
          aiNegotiationEnabled: data.aiNegotiationEnabled,
          aiValuationEnabled: data.aiValuationEnabled,
          resurrectionEnabled: data.resurrectionEnabled,
          abVariantsEnabled: data.abVariantsEnabled,
          budgetCap: data.budgetCap,
          contactListId: data.contactListId,
          selectedTestPhones: data.selectedTestPhones,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create campaign');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  const saveDraft = () => {
    setGlobalError(null);
    createMutation.mutate(form, {
      onSuccess: () => {
        if (typeof window !== 'undefined') window.location.href = '/campaigns';
      },
      onError: (err) => {
        setGlobalError(err.message);
      },
    });
  };

  const launch = async () => {
    setGlobalError(null);
    try {
      const created = await createMutation.mutateAsync(form);
      if (!created?.id) throw new Error('Campaign was not created');
      const res = await fetch(`/api/outreach/campaigns/${created.id}/start`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to launch campaign');
      }
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      if (typeof window !== 'undefined') window.location.href = '/campaigns';
    } catch (e) {
      setGlobalError((e as Error).message);
    }
  };

  const confirmDncOff = async () => {
    setShowDncConfirm(false);
    setForm((f) => ({ ...f, dncScrubEnabled: false }));

    try {
      await fetch('/api/compliance/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DNC_SCRUB_DISABLED',
          campaignId: form.contactListId || 'new-campaign',
          confirmationText:
            'I confirm these contacts have an existing business relationship or documented consent. I accept TCPA liability for any resulting violations.',
        }),
      });
    } catch (error) {
      console.error('Failed to record DNC audit:', error);
    }
  };

  const handleLeadsSelected = (listId: string, listName: string, leadCount: number) => {
    setForm((f) => ({
      ...f,
      contactSource: 'crm',
      contactListId: listId,
      consentMode: 'unverified',
    }));
    setSelectedListInfo({ name: listName, count: leadCount });
    queryClient.invalidateQueries({ queryKey: ['contact-lists'] });
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
          <p className="text-[var(--text-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <header className="space-y-4">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Campaigns
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">Create Campaign</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              Set up your outreach campaign in a few simple steps
            </p>
          </div>
        </header>

        {/* Step Indicator */}
        <StepIndicator
          steps={STEPS}
          currentStep={step}
          onStepClick={goToStep}
          completedSteps={completedSteps}
        />

        {/* Global Error */}
        {globalError && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 animate-fade-in-up">
            <AlertCircle className="h-5 w-5 text-[var(--color-error)] shrink-0" />
            <p className="text-[var(--color-error)]">{globalError}</p>
          </div>
        )}

        {/* Step Content */}
        <div className="min-h-[500px]">
          {step === 'basics' && <StepBasics form={form} setForm={setForm} errors={errors} />}
          {step === 'contacts' && (
            <StepContacts
              form={form}
              setForm={setForm}
              onOpenLeadFinder={() => setShowLeadFinder(true)}
              selectedListInfo={selectedListInfo}
            />
          )}
          {step === 'messages' && <StepMessages form={form} setForm={setForm} errors={errors} />}
          {step === 'schedule' && <StepSchedule form={form} setForm={setForm} testPhones={testPhones} />}
          {step === 'review' && (
            <StepReview
              form={form}
              setForm={setForm}
              onLaunch={launch}
              onSaveDraft={saveDraft}
              isLaunching={createMutation.isPending}
              showDncConfirm={showDncConfirm}
              setShowDncConfirm={setShowDncConfirm}
              confirmDncOff={confirmDncOff}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        {step !== 'review' && (
          <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
            <button
              onClick={prevStep}
              disabled={currentStepIndex === 0}
              className={`
                flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all
                ${
                  currentStepIndex === 0
                    ? 'text-[var(--text-muted)] cursor-not-allowed'
                    : 'btn-secondary'
                }
              `}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            <div className="flex items-center gap-3">
              {step === 'basics' && (
                <button
                  onClick={() => {
                    if (form.name.trim()) {
                      setForm((f) => ({
                        ...f,
                        testMode: true,
                        openingMessage: f.openingMessage || DEFAULT_OPENER,
                      }));
                      // Quick launch logic here if needed
                    }
                  }}
                  className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-[var(--color-success)] bg-[var(--color-success)]/10 hover:bg-[var(--color-success)]/20 border border-[var(--color-success)]/30 transition-colors"
                >
                  <Zap className="h-4 w-4" />
                  Quick Launch (Test)
                </button>
              )}

              <button
                onClick={nextStep}
                className="btn-gradient flex items-center gap-2 px-6 py-3 rounded-xl font-medium"
              >
                <span>Continue</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Lead Finder Modal */}
        <LeadFinderModal
          open={showLeadFinder}
          onOpenChange={setShowLeadFinder}
          onLeadsSelected={handleLeadsSelected}
        />
      </div>
    </div>
  );
}
