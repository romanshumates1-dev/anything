'use client';

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sparkles,
  Loader2,
  Wand2,
  Copy,
  Check,
  Edit3,
  Save,
  RefreshCw,
  MessageSquare,
  Mail,
  Clock,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
} from 'lucide-react';

interface GeneratedTemplate {
  id: string;
  subject?: string;
  body: string;
  followUps: Array<{ body: string; delayHours: number }>;
  variables: string[];
  channel: string;
  tone: string;
  generationTimeMs: number;
}

interface AITemplateGeneratorProps {
  onUseTemplate: (template: {
    body: string;
    subject?: string;
    followUps: Array<{ body: string; delayHours: number }>;
    variables: string[];
    generationId: string;
  }) => void;
  onSaveTemplate?: (template: GeneratedTemplate) => void;
  defaultChannel?: 'sms' | 'email';
  className?: string;
}

const PROMPT_SUGGESTIONS = [
  'Friendly first message to a property owner about buying their house',
  'Professional outreach to an investor about a new deal opportunity',
  'Follow-up message for someone who showed initial interest',
  'Re-engagement message for a cold lead after 30 days',
  'Empathetic message for a homeowner facing foreclosure',
];

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional', description: 'Business-like and polished' },
  { value: 'friendly', label: 'Friendly', description: 'Warm and conversational' },
  { value: 'direct', label: 'Direct', description: 'Straight to the point' },
  { value: 'empathetic', label: 'Empathetic', description: 'Understanding and compassionate' },
];

export function AITemplateGenerator({
  onUseTemplate,
  onSaveTemplate,
  defaultChannel = 'sms',
  className,
}: AITemplateGeneratorProps) {
  const [prompt, setPrompt] = useState('');
  const [campaignGoal, setCampaignGoal] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [tone, setTone] = useState<string>('professional');
  const [channel, setChannel] = useState<'sms' | 'email'>(defaultChannel);
  const [includeFollowUps, setIncludeFollowUps] = useState(true);
  const [numberOfFollowUps, setNumberOfFollowUps] = useState(2);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [generatedTemplate, setGeneratedTemplate] = useState<GeneratedTemplate | null>(null);
  const [editedBody, setEditedBody] = useState('');
  const [editedSubject, setEditedSubject] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          campaignGoal: campaignGoal || undefined,
          targetAudience: targetAudience || undefined,
          tone,
          channel,
          includeFollowUps,
          numberOfFollowUps,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate template');
      }
      return res.json() as Promise<GeneratedTemplate>;
    },
    onSuccess: (data) => {
      setGeneratedTemplate(data);
      setEditedBody(data.body);
      setEditedSubject(data.subject || '');
      setIsEditing(false);
    },
  });

  const handleGenerate = useCallback(() => {
    if (prompt.trim().length >= 10) {
      generateMutation.mutate();
    }
  }, [prompt, generateMutation]);

  const handleUseTemplate = useCallback(() => {
    if (generatedTemplate) {
      onUseTemplate({
        body: isEditing ? editedBody : generatedTemplate.body,
        subject: channel === 'email' ? (isEditing ? editedSubject : generatedTemplate.subject) : undefined,
        followUps: generatedTemplate.followUps,
        variables: generatedTemplate.variables,
        generationId: generatedTemplate.id,
      });
    }
  }, [generatedTemplate, isEditing, editedBody, editedSubject, channel, onUseTemplate]);

  const handleCopy = useCallback(async () => {
    const textToCopy = isEditing ? editedBody : generatedTemplate?.body || '';
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [isEditing, editedBody, generatedTemplate]);

  const handleSuggestionClick = (suggestion: string) => {
    setPrompt(suggestion);
  };

  const highlightVariables = (text: string) => {
    const parts = text.split(/(\{\{[a-zA-Z]+\}\})/g);
    return parts.map((part, i) => {
      if (part.match(/\{\{[a-zA-Z]+\}\}/)) {
        return (
          <span
            key={i}
            className="px-1.5 py-0.5 rounded bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] font-mono text-sm"
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className={className}>
      {/* Generator Input Section */}
      <GlassCard className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--accent-purple)]/20 to-[var(--accent-blue)]/20">
            <Sparkles className="h-6 w-6 text-[var(--accent-purple)]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI Template Generator</h3>
            <p className="text-sm text-[var(--text-muted)]">Describe what you want and let AI create it</p>
          </div>
        </div>

        {/* Main Prompt Input */}
        <div className="space-y-3">
          <Label className="text-sm font-medium text-[var(--text-primary)]">
            Describe your ideal message
            <span className="text-[var(--color-error)] ml-1">*</span>
          </Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., A friendly first message to a property owner asking if they'd consider selling their home..."
            rows={3}
            className="input-enhanced resize-none"
          />
          {prompt.length > 0 && prompt.length < 10 && (
            <p className="text-xs text-[var(--color-warning)]">Please provide at least 10 characters</p>
          )}
        </div>

        {/* Quick Suggestions */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Lightbulb className="h-3.5 w-3.5" />
            <span>Quick suggestions:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {PROMPT_SUGGESTIONS.map((suggestion, i) => (
              <button
                key={i}
                onClick={() => handleSuggestionClick(suggestion)}
                className="text-xs px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)] hover:bg-[var(--accent-blue)]/10 hover:text-[var(--accent-blue)] text-[var(--text-secondary)] transition-colors border border-[var(--border-subtle)] hover:border-[var(--accent-blue)]/30"
              >
                {suggestion.length > 50 ? suggestion.slice(0, 50) + '...' : suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Channel & Tone Selection */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-[var(--text-secondary)]">Channel</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setChannel('sms')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                  channel === 'sms'
                    ? 'bg-[var(--accent-blue)]/10 border-[var(--accent-blue)] text-[var(--accent-blue)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-medium)]'
                }`}
              >
                <MessageSquare className="h-4 w-4" />
                SMS
              </button>
              <button
                onClick={() => setChannel('email')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${
                  channel === 'email'
                    ? 'bg-[var(--accent-blue)]/10 border-[var(--accent-blue)] text-[var(--accent-blue)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--border-medium)]'
                }`}
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-[var(--text-secondary)]">Tone</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger className="input-enhanced">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div>
                      <p className="font-medium">{opt.label}</p>
                      <p className="text-xs text-[var(--text-muted)]">{opt.description}</p>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Advanced Options Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Advanced options
        </button>

        {/* Advanced Options */}
        {showAdvanced && (
          <div className="space-y-4 pt-2 border-t border-[var(--border-subtle)] animate-fade-in-up">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-[var(--text-secondary)]">Campaign Goal (optional)</Label>
                <Input
                  value={campaignGoal}
                  onChange={(e) => setCampaignGoal(e.target.value)}
                  placeholder="e.g., Get property owners to respond"
                  className="input-enhanced"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-[var(--text-secondary)]">Target Audience (optional)</Label>
                <Input
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  placeholder="e.g., Distressed property owners"
                  className="input-enhanced"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIncludeFollowUps(!includeFollowUps)}
                  className={`w-11 h-6 rounded-full transition-colors relative ${
                    includeFollowUps ? 'bg-[var(--accent-blue)]' : 'bg-[var(--bg-tertiary)]'
                  }`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                      includeFollowUps ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-[var(--text-secondary)]">Include follow-up messages</span>
              </div>

              {includeFollowUps && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--text-muted)]">Number:</span>
                  <Select value={String(numberOfFollowUps)} onValueChange={(v) => setNumberOfFollowUps(Number(v))}>
                    <SelectTrigger className="w-20 input-enhanced">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="3">3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={generateMutation.isPending || prompt.trim().length < 10}
          className="w-full btn-gradient flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generateMutation.isPending ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Generating magic...
            </>
          ) : (
            <>
              <Wand2 className="h-5 w-5" />
              Generate Template
            </>
          )}
        </button>

        {generateMutation.isError && (
          <p className="text-sm text-[var(--color-error)] text-center">
            {generateMutation.error?.message || 'Failed to generate. Please try again.'}
          </p>
        )}
      </GlassCard>

      {/* Generated Template Preview */}
      {generatedTemplate && (
        <GlassCard className="mt-6 space-y-4 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--color-success)]/10">
                <Check className="h-5 w-5 text-[var(--color-success)]" />
              </div>
              <div>
                <h4 className="font-semibold text-[var(--text-primary)]">Generated Template</h4>
                <p className="text-xs text-[var(--text-muted)]">
                  Generated in {generatedTemplate.generationTimeMs}ms
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Regenerate"
              >
                <RefreshCw className={`h-4 w-4 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`p-2 rounded-lg transition-colors ${
                  isEditing
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                title="Edit template"
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                onClick={handleCopy}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <Check className="h-4 w-4 text-[var(--color-success)]" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Email Subject (if applicable) */}
          {channel === 'email' && (
            <div className="space-y-2">
              <Label className="text-sm text-[var(--text-secondary)]">Subject Line</Label>
              {isEditing ? (
                <Input
                  value={editedSubject}
                  onChange={(e) => setEditedSubject(e.target.value)}
                  className="input-enhanced"
                />
              ) : (
                <div className="p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                  <p className="text-[var(--text-primary)]">{generatedTemplate.subject}</p>
                </div>
              )}
            </div>
          )}

          {/* Main Body */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm text-[var(--text-secondary)]">Message Body</Label>
              {!isEditing && (
                <Badge variant="outline" className="text-xs">
                  {(isEditing ? editedBody : generatedTemplate.body).length} chars
                </Badge>
              )}
            </div>
            {isEditing ? (
              <Textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={5}
                className="input-enhanced resize-none"
              />
            ) : (
              <div className="p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                <p className="text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                  {highlightVariables(generatedTemplate.body)}
                </p>
              </div>
            )}
          </div>

          {/* Follow-ups */}
          {generatedTemplate.followUps.length > 0 && (
            <div className="space-y-3">
              <Label className="text-sm text-[var(--text-secondary)]">Follow-up Messages</Label>
              {generatedTemplate.followUps.map((fu, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-[var(--bg-tertiary)]/50 border border-[var(--border-subtle)] space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[var(--accent-purple)]/20 flex items-center justify-center">
                      <span className="text-xs font-bold text-[var(--accent-purple)]">{idx + 1}</span>
                    </div>
                    <span className="text-sm text-[var(--text-muted)]">
                      <Clock className="h-3.5 w-3.5 inline mr-1" />
                      After {fu.delayHours} hours
                    </span>
                  </div>
                  <p className="text-[var(--text-primary)] whitespace-pre-wrap text-sm">
                    {highlightVariables(fu.body)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Variables Used */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--text-muted)]">Variables:</span>
            {generatedTemplate.variables.map((v, i) => (
              <Badge key={i} variant="outline" className="text-xs font-mono bg-[var(--accent-blue)]/5">
                {v}
              </Badge>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleUseTemplate}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium"
            >
              <Check className="h-4 w-4" />
              Use This Template
            </button>
            {onSaveTemplate && (
              <button
                onClick={() => onSaveTemplate(generatedTemplate)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium border border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] transition-colors"
              >
                <Save className="h-4 w-4" />
                Save to Library
              </button>
            )}
          </div>

          {/* Feedback */}
          <div className="flex items-center justify-center gap-4 pt-2 border-t border-[var(--border-subtle)]">
            <span className="text-xs text-[var(--text-muted)]">Was this helpful?</span>
            <button className="p-1.5 rounded-lg hover:bg-[var(--color-success)]/10 text-[var(--text-muted)] hover:text-[var(--color-success)] transition-colors">
              <ThumbsUp className="h-4 w-4" />
            </button>
            <button className="p-1.5 rounded-lg hover:bg-[var(--color-error)]/10 text-[var(--text-muted)] hover:text-[var(--color-error)] transition-colors">
              <ThumbsDown className="h-4 w-4" />
            </button>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
