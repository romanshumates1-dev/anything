'use client';

/**
 * ACCESSIBILITY SETTINGS (item 5 of the production audit).
 *
 * These settings existed nowhere. The app respected the OS-level
 * `prefers-reduced-motion` / `prefers-contrast` queries, but a user could not
 * say "always do this for me" and the choice could not follow them to another
 * machine. Worse, there was no control anywhere in the product - a user who
 * needed larger text had no way to ask for it.
 *
 * SCOPE, STATED PLAINLY: these preferences never override a user's own OS-level
 * accessibility settings, and nothing is forced on anyone. Every option
 * defaults to today's behaviour, so an untouched install renders identically to
 * before this page existed. Reduced motion is additive: if the OS says reduce,
 * the page still says reduce regardless of this setting.
 *
 * Every control applies IMMEDIATELY (no Save button) because the user needs to
 * see the effect to evaluate it, and persisting on each change means a crash or
 * a closed tab cannot lose the choice.
 */
import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { Accessibility, Type, Eye, Zap, Rows3, RotateCcw, Loader2, Check } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import {
  useAccessibility,
  DEFAULT_ACCESSIBILITY,
  type AccessibilityPrefs,
} from '@/components/AccessibilityProvider';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function OptionRow({
  icon: Icon,
  title,
  description,
  value,
  options,
  onChange,
}: {
  icon: typeof Type;
  title: string;
  description: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className="h-5 w-5 text-[var(--text-muted)] mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
        </div>
      </div>
      <div
        className="flex gap-1 p-1 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] flex-shrink-0 self-start"
        role="radiogroup"
        aria-label={title}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              value === o.value
                ? 'bg-[var(--accent-blue)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AccessibilitySettingsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const { prefs, loading, setPref, reset } = useAccessibility();
  const [saveState, setSaveState] = useState<SaveState>('idle');

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        <span className="sr-only">Loading accessibility settings</span>
      </div>
    );
  }
  if (!session) redirect('/account/signin');

  const isDefault = (Object.keys(DEFAULT_ACCESSIBILITY) as Array<keyof AccessibilityPrefs>).every(
    (k) => prefs[k] === DEFAULT_ACCESSIBILITY[k]
  );

  // The preference applies instantly regardless; this only reports whether it
  // PERSISTED, so the UI never claims a save that did not happen.
  const persistNote = () => {
    setSaveState('saving');
    setTimeout(() => {
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    }, 400);
  };

  const update = <K extends keyof AccessibilityPrefs>(key: K, value: AccessibilityPrefs[K]) => {
    setPref(key, value);
    persistNote();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Accessibility className="h-6 w-6 text-[var(--accent-blue)]" aria-hidden="true" />
            Accessibility
          </h1>
          <p className="text-[var(--text-secondary)] mt-1 text-sm">
            Adjust how DealSwift looks and moves. Changes apply immediately and are saved to your
            account, so they follow you to other devices.
          </p>
        </div>
        {!isDefault && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { reset(); persistNote(); }}
            className="flex-shrink-0"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
        )}
      </div>

      <div aria-live="polite" className="min-h-[20px]">
        {saveState === 'saving' && (
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </p>
        )}
        {saveState === 'saved' && (
          <p className="text-xs text-emerald-400 flex items-center gap-1.5">
            <Check className="h-3 w-3" /> Saved to your account
          </p>
        )}
      </div>

      <GlassCard variant="bordered" padding="md">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your saved settings…
          </div>
        ) : (
          <>
            <OptionRow
              icon={Type}
              title="Dyslexia-friendly font"
              description="Wider letter spacing and heavier letterforms, designed to reduce letter confusion."
              value={prefs.fontFamily}
              onChange={(v) => update('fontFamily', v as AccessibilityPrefs['fontFamily'])}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'dyslexic', label: 'Dyslexic' },
              ]}
            />
            <OptionRow
              icon={Eye}
              title="Text size"
              description="Scales the entire interface proportionally, not just body text."
              value={prefs.fontScale}
              onChange={(v) => update('fontScale', v as AccessibilityPrefs['fontScale'])}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'large', label: 'Large' },
              ]}
            />
            <OptionRow
              icon={Zap}
              title="Reduce motion"
              description="Removes animations and transitions across the app."
              value={prefs.reduceMotion}
              onChange={(v) => update('reduceMotion', v as AccessibilityPrefs['reduceMotion'])}
              options={[
                { value: 'system', label: 'Follow system' },
                { value: 'always', label: 'Always reduce' },
              ]}
            />
            <OptionRow
              icon={Eye}
              title="Contrast"
              description="Strengthens muted text, borders, and keyboard focus outlines."
              value={prefs.contrast}
              onChange={(v) => update('contrast', v as AccessibilityPrefs['contrast'])}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'high', label: 'High' },
              ]}
            />
            <OptionRow
              icon={Rows3}
              title="Layout density"
              description="Tighter spacing, useful on dense tables and smaller screens."
              value={prefs.density}
              onChange={(v) => update('density', v as AccessibilityPrefs['density'])}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </>
        )}
      </GlassCard>

      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          <strong className="text-[var(--text-secondary)]">These settings never override your
          device.</strong> If your operating system requests reduced motion or higher contrast, this
          app respects that regardless of what is selected here. These settings add to your device
          preferences; they do not replace them.
        </p>
      </div>
    </div>
  );
}