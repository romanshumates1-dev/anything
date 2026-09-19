'use client';

import { useState, useCallback } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/badge';
import { AITemplateGenerator } from './AITemplateGenerator';
import { TemplateLibrary } from './TemplateLibrary';
import {
  Sparkles,
  BookOpen,
  PenLine,
  Check,
  ArrowRight,
  Wand2,
} from 'lucide-react';

type TemplateSource = 'ai' | 'library' | 'custom';

interface SelectedTemplate {
  body: string;
  subject?: string;
  followUps: Array<{ body: string; delayHours: number }>;
  variables: string[];
  source: TemplateSource;
  sourceId?: string;
}

interface TemplateSelectorProps {
  onTemplateSelected: (template: SelectedTemplate) => void;
  defaultChannel?: 'sms' | 'email';
  initialBody?: string;
  initialFollowUps?: Array<{ body: string; delayHours: number }>;
  className?: string;
}

const SOURCE_OPTIONS: Array<{
  value: TemplateSource;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
}> = [
  {
    value: 'ai',
    label: 'AI Generator',
    description: 'Describe what you want and let AI create it',
    icon: Sparkles,
    color: 'var(--accent-purple)',
  },
  {
    value: 'library',
    label: 'Template Library',
    description: 'Choose from pre-made or saved templates',
    icon: BookOpen,
    color: 'var(--accent-blue)',
  },
  {
    value: 'custom',
    label: 'Write Custom',
    description: 'Create your own template from scratch',
    icon: PenLine,
    color: 'var(--color-success)',
  },
];

export function TemplateSelector({
  onTemplateSelected,
  defaultChannel = 'sms',
  initialBody = '',
  initialFollowUps = [],
  className,
}: TemplateSelectorProps) {
  const [selectedSource, setSelectedSource] = useState<TemplateSource | null>(null);
  const [hasSelected, setHasSelected] = useState(false);

  // Handle AI-generated template
  const handleAITemplate = useCallback(
    (template: {
      body: string;
      subject?: string;
      followUps: Array<{ body: string; delayHours: number }>;
      variables: string[];
      generationId: string;
    }) => {
      setHasSelected(true);
      onTemplateSelected({
        body: template.body,
        subject: template.subject,
        followUps: template.followUps,
        variables: template.variables,
        source: 'ai',
        sourceId: template.generationId,
      });
    },
    [onTemplateSelected]
  );

  // Handle library template selection
  const handleLibraryTemplate = useCallback(
    (template: {
      body: string;
      subject?: string;
      followUps: Array<{ body: string; delayHours: number }>;
      variables: string[];
      templateId: string;
      source: 'user' | 'library';
    }) => {
      setHasSelected(true);
      onTemplateSelected({
        body: template.body,
        subject: template.subject,
        followUps: template.followUps,
        variables: template.variables,
        source: 'library',
        sourceId: template.templateId,
      });
    },
    [onTemplateSelected]
  );

  // Handle custom template (just mark source as custom)
  const handleCustomTemplate = useCallback(() => {
    setHasSelected(true);
    onTemplateSelected({
      body: initialBody,
      followUps: initialFollowUps,
      variables: ['{{firstName}}', '{{propertyAddress}}'],
      source: 'custom',
    });
  }, [onTemplateSelected, initialBody, initialFollowUps]);

  // If not selected a source yet, show source selection
  if (!selectedSource) {
    return (
      <div className={className}>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-purple)]/20 to-[var(--accent-blue)]/20 mb-4">
            <Wand2 className="h-8 w-8 text-[var(--accent-purple)]" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Create Your Message</h2>
          <p className="text-[var(--text-secondary)]">Choose how you'd like to create your campaign template</p>
        </div>

        <div className="grid gap-4">
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setSelectedSource(option.value);
                if (option.value === 'custom') {
                  handleCustomTemplate();
                }
              }}
              className={`
                relative flex items-start gap-4 p-5 rounded-xl text-left transition-all duration-200
                bg-[var(--bg-secondary)]/50 border-2 border-transparent
                hover:border-[var(--border-medium)] hover:shadow-lg hover:scale-[1.01]
                active:scale-[0.99]
              `}
            >
              <div
                className="p-3 rounded-xl shrink-0"
                style={{ backgroundColor: `${option.color}15` }}
              >
                <option.icon className="h-6 w-6" style={{ color: option.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-[var(--text-primary)]">{option.label}</h3>
                  {option.value === 'ai' && (
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5"
                      style={{
                        backgroundColor: `${option.color}10`,
                        color: option.color,
                        borderColor: `${option.color}30`,
                      }}
                    >
                      Recommended
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-[var(--text-muted)]">{option.description}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-[var(--text-muted)] shrink-0 self-center" />
            </button>
          ))}
        </div>

        {/* Quick tip */}
        <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-[var(--accent-purple)]/5 border border-[var(--accent-purple)]/20">
          <Sparkles className="h-5 w-5 text-[var(--accent-purple)] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Pro Tip</p>
            <p className="text-sm text-[var(--text-secondary)]">
              The AI Generator can create high-converting templates in seconds. Just describe what you want
              and it will craft personalized messages for your campaign.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show the selected source interface
  return (
    <div className={className}>
      {/* Back button */}
      <button
        onClick={() => {
          setSelectedSource(null);
          setHasSelected(false);
        }}
        className="mb-4 flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowRight className="h-4 w-4 rotate-180" />
        <span>Back to options</span>
      </button>

      {/* Source indicator */}
      <div className="flex items-center gap-3 mb-6">
        {SOURCE_OPTIONS.filter((o) => o.value === selectedSource).map((option) => (
          <div key={option.value} className="flex items-center gap-3">
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: `${option.color}15` }}
            >
              <option.icon className="h-5 w-5" style={{ color: option.color }} />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--text-primary)]">{option.label}</h3>
              <p className="text-xs text-[var(--text-muted)]">{option.description}</p>
            </div>
          </div>
        ))}

        {hasSelected && (
          <Badge
            variant="outline"
            className="ml-auto bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30"
          >
            <Check className="h-3 w-3 mr-1" />
            Template Selected
          </Badge>
        )}
      </div>

      {/* AI Generator */}
      {selectedSource === 'ai' && (
        <AITemplateGenerator
          onUseTemplate={handleAITemplate}
          defaultChannel={defaultChannel}
        />
      )}

      {/* Template Library */}
      {selectedSource === 'library' && (
        <TemplateLibrary
          onSelectTemplate={handleLibraryTemplate}
          showUserTemplates={true}
        />
      )}

      {/* Custom (handled by parent, just show confirmation) */}
      {selectedSource === 'custom' && (
        <GlassCard>
          <div className="flex items-center gap-3 p-4">
            <div className="p-2 rounded-lg bg-[var(--color-success)]/10">
              <Check className="h-5 w-5 text-[var(--color-success)]" />
            </div>
            <div>
              <p className="font-medium text-[var(--text-primary)]">Custom template mode</p>
              <p className="text-sm text-[var(--text-muted)]">
                You can now write your own message in the editor below
              </p>
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
