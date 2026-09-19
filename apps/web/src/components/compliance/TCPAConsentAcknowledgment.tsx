'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Shield,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Phone,
  FileText,
  Clock,
  Ban,
  Building2,
  AlertCircle,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

interface TCPAConsentAcknowledgmentProps {
  onAccept: () => void;
  onDecline?: () => void;
  contactCount?: number;
  consentMode?: 'unverified' | 'inbound' | 'consented';
  className?: string;
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({ title, icon, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          {icon}
          <span className="font-medium text-[var(--text-primary)]">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-5 w-5 text-[var(--text-muted)]" />
        ) : (
          <ChevronDown className="h-5 w-5 text-[var(--text-muted)]" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 bg-[var(--bg-primary)] border-t border-[var(--border-subtle)]">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * TCPA Consent Acknowledgment component shown before launching campaigns.
 * Users must acknowledge their legal responsibility for consent compliance.
 */
export function TCPAConsentAcknowledgment({
  onAccept,
  onDecline,
  contactCount,
  consentMode = 'unverified',
  className = '',
}: TCPAConsentAcknowledgmentProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  const consentModeInfo = {
    unverified: {
      label: 'Unverified Consent',
      color: 'var(--color-warning)',
      description: 'You claim these contacts have consented, but consent has not been verified through the platform.',
      risk: 'Higher liability risk. Ensure you have documented proof of consent.',
    },
    inbound: {
      label: 'Inbound Leads',
      color: 'var(--accent-blue)',
      description: 'These contacts initiated contact through your opt-in forms or website.',
      risk: 'Lower risk, but ensure your opt-in language was compliant.',
    },
    consented: {
      label: 'Verified Consent',
      color: 'var(--color-success)',
      description: 'Consent has been documented and verified through the platform.',
      risk: 'Lowest risk. Maintain consent records.',
    },
  };

  const info = consentModeInfo[consentMode];

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="border-l-4" style={{ borderLeftColor: info.color }}>
        <GlassCard className="rounded-l-none">
          <div className="flex items-start gap-4">
          <div
            className="p-3 rounded-xl shrink-0"
            style={{ backgroundColor: `${info.color}15` }}
          >
            <Shield className="h-6 w-6" style={{ color: info.color }} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              SMS Compliance Acknowledgment
            </h3>
            <p className="text-[var(--text-secondary)] mb-4">
              Before sending SMS messages, you must acknowledge your legal responsibility for compliance
              with federal, state, and carrier requirements.
            </p>

            {/* Consent Mode Badge */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-4"
              style={{ backgroundColor: `${info.color}15`, color: info.color }}
            >
              {consentMode === 'consented' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : consentMode === 'unverified' ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <Info className="h-4 w-4" />
              )}
              {info.label}
              {contactCount && ` - ${contactCount.toLocaleString()} contacts`}
            </div>

            {/* Risk Notice */}
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] mb-6">
              <p className="text-sm text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">Consent Status:</strong> {info.description}
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                <strong>Risk Level:</strong> {info.risk}
              </p>
            </div>

            {/* Collapsible Sections */}
            <div className="space-y-3 mb-6">
              {/* What is TCPA Consent? */}
              <CollapsibleSection
                title="What is TCPA Consent?"
                icon={<FileText className="h-5 w-5 text-[var(--accent-blue)]" />}
                defaultOpen={true}
              >
                <div className="space-y-3 text-sm text-[var(--text-secondary)]">
                  <p>
                    The <strong className="text-[var(--text-primary)]">Telephone Consumer Protection Act (TCPA)</strong> is
                    a federal law that regulates telemarketing calls, auto-dialed calls, pre-recorded calls, text messages,
                    and unsolicited faxes.
                  </p>
                  <p>
                    <strong className="text-[var(--text-primary)]">Why consent is required:</strong> Under TCPA, businesses
                    must obtain <em>prior express written consent</em> before sending marketing text messages. This consent must
                    be documented and clearly state that the recipient agrees to receive SMS communications from your business.
                  </p>
                </div>
              </CollapsibleSection>

              {/* Carrier Requirements */}
              <CollapsibleSection
                title="Carrier Requirements"
                icon={<Phone className="h-5 w-5 text-[var(--accent-purple)]" />}
              >
                <div className="space-y-4 text-sm">
                  {/* AT&T */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-blue)]15 shrink-0">
                      <Building2 className="h-4 w-4 text-[var(--accent-blue)]" />
                    </div>
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">AT&T</p>
                      <p className="text-[var(--text-secondary)]">
                        Requires prior express written consent and 10DLC registration for A2P messaging.
                      </p>
                    </div>
                  </div>

                  {/* T-Mobile */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-pink)]15 shrink-0">
                      <Building2 className="h-4 w-4 text-[var(--accent-pink)]" />
                    </div>
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">T-Mobile</p>
                      <p className="text-[var(--text-secondary)]">
                        Requires brand registration and campaign verification through The Campaign Registry (TCR).
                      </p>
                    </div>
                  </div>

                  {/* Verizon */}
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-[var(--color-error)]15 shrink-0">
                      <Building2 className="h-4 w-4 text-[var(--color-error)]" />
                    </div>
                    <div>
                      <p className="font-medium text-[var(--text-primary)]">Verizon</p>
                      <p className="text-[var(--text-secondary)]">
                        Requires opt-in consent and strict compliance with content guidelines.
                      </p>
                    </div>
                  </div>

                  {/* All Carriers */}
                  <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
                    <p className="font-medium text-[var(--text-primary)] mb-2">All Carriers Require:</p>
                    <ul className="space-y-1.5 text-[var(--text-secondary)]">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0" />
                        STOP/HELP keyword support
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0" />
                        Opt-out processing within 24 hours
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0" />
                        Clear sender identification
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0" />
                        Compliant message content
                      </li>
                    </ul>
                  </div>
                </div>
              </CollapsibleSection>

              {/* Your Responsibilities */}
              <CollapsibleSection
                title="Your Responsibilities"
                icon={<AlertCircle className="h-5 w-5 text-[var(--color-warning)]" />}
              >
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">Obtain consent before adding contacts</strong> -
                      You must have documented prior express written consent from each recipient.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">Honor opt-out requests immediately</strong> -
                      Stop messaging contacts who reply STOP or request removal.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">Keep records of consent for 4+ years</strong> -
                      Maintain proof of consent including date, time, method, and language shown.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">Follow quiet hours (8am-9pm recipient local time)</strong> -
                      Only send messages during permitted hours in the recipient's timezone.
                    </span>
                  </li>
                </ul>
              </CollapsibleSection>

              {/* Contact Sources - Clarifies purchased lists ARE allowed */}
              <CollapsibleSection
                title="Allowed Contact Sources"
                icon={<CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />}
              >
                <div className="space-y-4 text-sm">
                  {/* Opt-In Contacts */}
                  <div className="p-3 rounded-lg bg-[var(--color-success)]10 border border-[var(--color-success)]30">
                    <p className="font-medium text-[var(--color-success)] mb-2 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Opt-In Contacts (Lowest Risk)
                    </p>
                    <ul className="space-y-1 text-[var(--text-secondary)]">
                      <li>• Website form submissions with SMS consent checkbox</li>
                      <li>• Text-to-join campaigns (texted keyword to your number)</li>
                      <li>• Inbound inquiries who requested follow-up</li>
                      <li>• Prior business relationship with written consent</li>
                    </ul>
                  </div>

                  {/* Purchased Lists */}
                  <div className="p-3 rounded-lg bg-[var(--accent-blue)]10 border border-[var(--accent-blue)]30">
                    <p className="font-medium text-[var(--accent-blue)] mb-2 flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Purchased/Rented Lists (Allowed with Documentation)
                    </p>
                    <ul className="space-y-1 text-[var(--text-secondary)]">
                      <li>• Lists with documented Prior Express Written Consent (PEWC)</li>
                      <li>• List provider must have obtained proper consent</li>
                      <li>• Consent language must allow third-party marketing</li>
                      <li>• Use reputable providers with compliance guarantees</li>
                    </ul>
                    <div className="mt-3 p-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
                      <p className="text-xs text-[var(--text-muted)]">
                        <strong className="text-[var(--text-secondary)]">Your responsibility:</strong> Obtain written
                        proof of consent from the list provider. If challenged, you must prove consent existed. The
                        liability falls on YOU, not the list provider.
                      </p>
                    </div>
                  </div>

                  {/* NOT Allowed */}
                  <div className="p-3 rounded-lg bg-[var(--color-error)]10 border border-[var(--color-error)]30">
                    <p className="font-medium text-[var(--color-error)] mb-2 flex items-center gap-2">
                      <Ban className="h-4 w-4" />
                      NOT Allowed
                    </p>
                    <ul className="space-y-1 text-[var(--text-secondary)]">
                      <li>• Scraped phone numbers without consent</li>
                      <li>• Random cold texting without prior consent</li>
                      <li>• Numbers from public directories (for marketing)</li>
                      <li>• Contacts who have opted out or are on DNC lists</li>
                    </ul>
                  </div>
                </div>
              </CollapsibleSection>

              {/* Compliance Built-In */}
              <CollapsibleSection
                title="Compliance Built-In"
                icon={<CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />}
              >
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">Automatic opt-out handling</strong> -
                      STOP keyword responses are processed automatically and contacts are removed from future campaigns.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">DNC registry checking</strong> -
                      Numbers are checked against Do Not Call registries before sending.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">State-specific quiet hours enforcement</strong> -
                      Messages are scheduled according to recipient timezone and state regulations.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">10DLC registration support</strong> -
                      Tools and guidance for registering your brand and campaigns with carriers.
                    </span>
                  </li>
                </ul>
              </CollapsibleSection>

              {/* Penalties for Non-Compliance */}
              <CollapsibleSection
                title="Penalties for Non-Compliance"
                icon={<Ban className="h-5 w-5 text-[var(--color-error)]" />}
              >
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--color-error)]10 border border-[var(--color-error)]30">
                    <AlertTriangle className="h-5 w-5 text-[var(--color-error)] shrink-0 mt-0.5" />
                    <div className="text-[var(--text-secondary)]">
                      <p className="font-medium text-[var(--color-error)] mb-1">Financial Penalties</p>
                      <p><strong>$500 - $1,500 per unsolicited message</strong> under TCPA. Class action lawsuits can result in millions in damages.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Ban className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">Carrier blocking</strong> -
                      Your phone numbers may be blocked by carriers, preventing all SMS delivery.
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <Ban className="h-4 w-4 text-[var(--color-error)] shrink-0 mt-0.5" />
                    <span className="text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">Account suspension</strong> -
                      Repeated violations may result in permanent account termination.
                    </span>
                  </div>
                </div>
              </CollapsibleSection>
            </div>

            {/* Acknowledgment Checkbox */}
            <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--accent-blue)] transition-colors bg-[var(--bg-secondary)]">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1 h-5 w-5 rounded border-[var(--border-medium)] text-[var(--accent-blue)] focus:ring-[var(--accent-blue)]"
              />
              <span className="text-sm text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">I confirm I have obtained proper consent from all contacts
                and will comply with TCPA and carrier requirements.</strong> I understand that I am solely responsible
                for compliance, that I can produce documentation of consent upon request, and that
                violations may result in significant legal liability and account termination.
              </span>
            </label>

            {/* Links */}
            <div className="flex flex-wrap gap-4 mt-4 text-sm">
              <Link
                href="/legal/acceptable-use"
                className="text-[var(--accent-blue)] hover:underline flex items-center gap-1"
              >
                Acceptable Use Policy
                <ExternalLink className="h-3 w-3" />
              </Link>
              <Link
                href="/legal/sms-terms"
                className="text-[var(--accent-blue)] hover:underline flex items-center gap-1"
              >
                SMS Terms
                <ExternalLink className="h-3 w-3" />
              </Link>
              <Link
                href="/trust"
                className="text-[var(--accent-blue)] hover:underline flex items-center gap-1"
              >
                Compliance Center
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
          </div>
        </GlassCard>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        {onDecline && (
          <button
            onClick={onDecline}
            className="flex-1 btn-secondary py-3 rounded-xl font-medium"
          >
            Go Back
          </button>
        )}
        <button
          onClick={onAccept}
          disabled={!acknowledged}
          className="flex-1 btn-gradient py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          I Acknowledge - Continue
        </button>
      </div>
    </div>
  );
}
